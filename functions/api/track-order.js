// ============================================================
// AVNIDEEP SHOP — PUBLIC ORDER TRACKING (mobile number first)
// ------------------------------------------------------------
// A customer enters the 10-digit mobile number used at checkout and
// gets every order placed with that number (latest first), each with
// its live store status and, when the shipment exists, the courier
// AWB / ETA / scan timeline.
//
// An order ID or AWB is OPTIONAL and only narrows the result down.
// Nothing sensitive is ever returned: no name, address, pincode or
// the phone number itself.
//
// The Ekart public-tracking setting is no longer a hard gate. Order
// status always comes from the `orders` table; the setting only
// controls whether we may poll Ekart for a fresh courier scan.
// ============================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Phones are stored inconsistently ("+91 98765 43210", "098765-43210", ...).
// Every comparison uses the last 10 digits only.
function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(-10);
}

const STATUS_LABELS = {
  // Store workflow
  cod_order: "Order placed (COD)",
  pending_collection: "Order placed",
  advance_pending: "Advance payment pending",
  payment_pending: "Payment pending",
  partially_paid: "Advance paid",
  paid: "Payment received",
  payment_received: "Payment received",
  confirmed: "Order confirmed",
  processing: "Processing",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  cancelled_by_customer: "Cancelled",
  returned: "Returned",
  refunded: "Refunded",
  // Courier states
  booked: "Shipment booked",
  manifested: "Picked up by courier",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  exception: "Delivery exception",
  rto: "Returning to origin",
  pending: "Order received",
};

function statusLabel(status) {
  const key = String(status || "").toLowerCase();
  return STATUS_LABELS[key] || (key ? key.replace(/_/g, " ") : "Update");
}

function normalizeDate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" (UTC); make it parseable.
  let candidate = raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(candidate)) {
    candidate = candidate.replace(" ", "T") + "Z";
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(candidate)) {
    candidate += "Z";
  }
  const d = new Date(candidate);
  return isFinite(d.getTime()) ? d.toISOString() : "";
}

async function rateLimited(env, request) {
  if (!env?.RATE_LIMIT_KV) return false;
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const bucket = Math.floor(Date.now() / 60000);
  const key = "track_order:" + ip + ":" + bucket;
  try {
    const seen = parseInt((await env.RATE_LIMIT_KV.get(key)) || "0", 10);
    if (seen >= 12) return true;
    await env.RATE_LIMIT_KV.put(key, String(seen + 1), { expirationTtl: 120 });
  } catch (e) {}
  return false;
}

async function publicTrackingEnabled(env) {
  // Best-effort: a missing settings table or row must never break tracking.
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE section = 'ekart' AND key = 'public_tracking_enabled'"
    ).first();
    return String(row?.value || "") === "1";
  } catch (e) {
    return false;
  }
}

async function refreshFromAdmin(env, awb) {
  if (!env?.EKART_INTERNAL_KEY || !awb) return false;
  const endpoint = env.EKART_INTERNAL_TRACK_URL ||
    "https://avnideep-admin-api.officialavnideepayurveda.workers.dev/api/internal/ekart/track";
  const controller = new AbortController();
  const timer = setTimeout(() => { try { controller.abort(); } catch (e) {} }, 4500);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": env.EKART_INTERNAL_KEY,
      },
      body: JSON.stringify({ awb }),
      signal: controller.signal,
    });
    return res.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const PHONE_SQL = "substr(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(o.phone,''),' ',''),'-',''),'+',''),'(',''),')',''), -10)";

async function loadOrders(env, { phone, orderId, awb }) {
  const clauses = [PHONE_SQL + " = ?"];
  const params = [phone];
  if (orderId) { clauses.push("o.order_id = ? COLLATE NOCASE"); params.push(orderId); }
  if (awb) { clauses.push("s.awb = ? COLLATE NOCASE"); params.push(awb); }

  const sql =
    "SELECT o.order_id, o.phone, o.status, o.created_at, o.payment_method, o.product, o.amount, " +
    "s.id AS shipment_id, s.awb, s.status AS shipment_status, s.latest_status, " +
    "s.latest_event, s.expected_delivery_date, s.booked_at, s.last_tracked_at, " +
    "s.updated_at AS shipment_updated_at " +
    "FROM orders o LEFT JOIN ekart_shipments s ON s.order_id = o.order_id " +
    "WHERE " + clauses.join(" AND ") + " " +
    "ORDER BY o.created_at DESC LIMIT 20";

  try {
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return results || [];
  } catch (err) {
    // The Ekart tables may not exist yet (migration 0008 not applied). Order
    // status still lives in `orders`, so fall back to a shipment-less lookup.
    // An AWB filter cannot be honoured without those tables, so return nothing
    // rather than a wrong order.
    if (awb) return [];
    const plainClauses = [PHONE_SQL + " = ?"];
    const plainParams = [phone];
    if (orderId) { plainClauses.push("o.order_id = ? COLLATE NOCASE"); plainParams.push(orderId); }
    const simple = await env.DB.prepare(
      "SELECT o.order_id, o.phone, o.status, o.created_at, o.payment_method, o.product, o.amount, " +
      "NULL AS shipment_id, NULL AS awb, '' AS shipment_status, '' AS latest_status, '' AS latest_event, " +
      "'' AS expected_delivery_date, '' AS booked_at, '' AS last_tracked_at, '' AS shipment_updated_at " +
      "FROM orders o WHERE " + plainClauses.join(" AND ") +
      " ORDER BY o.created_at DESC LIMIT 20"
    ).bind(...plainParams).all();
    return simple.results || [];
  }
}

async function loadEvents(env, shipmentIds) {
  const map = new Map();
  if (!shipmentIds.length) return map;
  const placeholders = shipmentIds.map(() => "?").join(",");
  try {
    const { results } = await env.DB.prepare(
      "SELECT shipment_id, mapped_status, status, event_at, location FROM ekart_shipment_events " +
      "WHERE shipment_id IN (" + placeholders + ") ORDER BY event_at DESC, id DESC LIMIT 200"
    ).bind(...shipmentIds).all();
    for (const row of results || []) {
      const id = Number(row.shipment_id);
      if (!map.has(id)) map.set(id, []);
      const status = String(row.mapped_status || row.status || "");
      map.get(id).push({
        status,
        label: statusLabel(status),
        at: normalizeDate(row.event_at),
        location: String(row.location || ""),
      });
    }
  } catch (e) {}
  return map;
}

function buildShipment(order, timeline) {
  if (!order.awb) return null;
  const status = String(order.latest_status || order.shipment_status || "");
  return {
    awb: String(order.awb || ""),
    status,
    status_label: statusLabel(status),
    latest_event: String(order.latest_event || ""),
    expected_delivery_date: normalizeDate(order.expected_delivery_date),
    booked_at: normalizeDate(order.booked_at),
    updated_at: normalizeDate(order.shipment_updated_at || order.last_tracked_at),
    timeline: timeline || [],
  };
}

export async function onRequestPost({ request, env }) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    return json({ ok: false, error: "Tracking is temporarily unavailable" }, 503);
  }
  if (await rateLimited(env, request)) {
    return json({ ok: false, error: "Too many attempts. Please try again in a minute." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const orderId = String(body?.order_id || "").trim().slice(0, 80);
  const awb = String(body?.awb || "").trim().toUpperCase().slice(0, 40);
  const phone = normalizePhone(body?.phone);

  if (!/^[6-9]\d{9}$/.test(phone)) {
    return json({ ok: false, error: "Enter the valid 10-digit mobile number used at checkout." }, 400);
  }
  if (orderId && !/^[A-Za-z0-9_-]{4,80}$/.test(orderId)) {
    return json({ ok: false, error: "Invalid order ID" }, 400);
  }
  if (awb && !/^[A-Z0-9-]{6,40}$/.test(awb)) {
    return json({ ok: false, error: "Invalid AWB" }, 400);
  }

  let orders;
  try {
    orders = await loadOrders(env, { phone, orderId, awb });
  } catch (e) {
    return json({ ok: false, error: "Tracking is temporarily unavailable" }, 503);
  }

  if (!orders.length) {
    return json({
      ok: false,
      error: "No order found for this mobile number." +
        (orderId || awb ? " Check the order ID / AWB, or clear it and search with the mobile number only." : ""),
    }, 404);
  }

  // Ask Ekart for a fresh scan at most once per request, and only for the
  // newest active shipment, so the response stays fast.
  const trackingEnabled = await publicTrackingEnabled(env);
  if (trackingEnabled) {
    const active = ["booked", "manifested", "in_transit", "out_for_delivery", "exception"];
    const target = orders.find((o) => {
      const status = String(o.latest_status || o.shipment_status || "").toLowerCase();
      if (!o.awb || !active.includes(status)) return false;
      const trackedAt = o.last_tracked_at ? new Date(o.last_tracked_at).getTime() : 0;
      return !trackedAt || Date.now() - trackedAt > 3 * 60 * 1000;
    });
    if (target && await refreshFromAdmin(env, target.awb)) {
      try {
        const fresh = await env.DB.prepare(
          "SELECT id AS shipment_id, awb, status AS shipment_status, latest_status, latest_event, " +
          "expected_delivery_date, booked_at, last_tracked_at, updated_at AS shipment_updated_at " +
          "FROM ekart_shipments WHERE order_id = ?"
        ).bind(target.order_id).first();
        if (fresh) Object.assign(target, fresh);
      } catch (e) {}
    }
  }

  const shipmentIds = orders.map((o) => Number(o.shipment_id)).filter((id) => id > 0);
  const events = await loadEvents(env, shipmentIds);

  const payload = orders.map((order) => {
    const shipment = buildShipment(order, events.get(Number(order.shipment_id)) || []);
    return {
      order_id: order.order_id,
      created_at: normalizeDate(order.created_at),
      product: String(order.product || ""),
      amount: Number(order.amount || 0),
      payment_method: String(order.payment_method || ""),
      status: String(order.status || ""),
      status_label: statusLabel(order.status),
      shipment,
      message: shipment
        ? (shipment.timeline.length ? "" : "The shipment is booked. Courier scan updates will appear here.")
        : "Your order is confirmed. Tracking will appear after despatch.",
    };
  });

  const first = payload[0];
  return json({
    ok: true,
    count: payload.length,
    orders: payload,
    // Backwards-compatible single-order mirror (older cached tracking pages).
    order: {
      order_id: first.order_id,
      order_status: first.status,
      order_status_label: first.status_label,
      created_at: first.created_at,
      payment_method: first.payment_method,
    },
    shipment: first.shipment,
    message: first.message,
  });
}
