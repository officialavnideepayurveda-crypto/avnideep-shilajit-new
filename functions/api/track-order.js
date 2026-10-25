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

function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(-10);
}

function statusLabel(status) {
  const map = {
    pending: "Order received",
    confirmed: "Order confirmed",
    processing: "Processing",
    booked: "Shipment booked",
    in_transit: "In transit",
    out_for_delivery: "Out for delivery",
    delivered: "Delivered",
    exception: "Delivery exception",
    rto: "Returning to origin",
    cancelled: "Cancelled",
    returned: "Returned",
  };
  const key = String(status || "").toLowerCase();
  return map[key] || (key ? key.replace(/_/g, " ") : "Update");
}

function normalizeDate(value) {
  if (!value) return "";
  const d = new Date(value);
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

  if ((!orderId && !awb) || !/^[6-9]\d{9}$/.test(phone)) {
    return json({ ok: false, error: "Enter your order ID or AWB and the 10-digit phone number used at checkout." }, 400);
  }
  if (orderId && !/^[A-Za-z0-9_-]{4,80}$/.test(orderId)) {
    return json({ ok: false, error: "Invalid order ID" }, 400);
  }
  if (awb && !/^[A-Z0-9-]{6,40}$/.test(awb)) {
    return json({ ok: false, error: "Invalid AWB" }, 400);
  }

  let trackingEnabled = false;
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE section = 'ekart' AND key = 'public_tracking_enabled'"
    ).first();
    trackingEnabled = String(row?.value || "") === "1";
  } catch (e) {
    return json({ ok: false, error: "Tracking is temporarily unavailable" }, 503);
  }
  if (!trackingEnabled) {
    return json({ ok: false, error: "Online tracking is not available yet. Please contact support." }, 503);
  }

  const clauses = [];
  const params = [];
  if (orderId) { clauses.push("o.order_id = ? COLLATE NOCASE"); params.push(orderId); }
  if (awb) { clauses.push("s.awb = ? COLLATE NOCASE"); params.push(awb); }
  const where = clauses.join(" AND ");

  let order;
  try {
    order = await env.DB.prepare(
      "SELECT o.order_id, o.phone, o.status, o.created_at, o.payment_method, " +
      "s.id AS shipment_id, s.awb, s.status AS shipment_status, s.latest_status, " +
      "s.latest_event, s.expected_delivery_date, s.booked_at, s.last_tracked_at, " +
      "s.updated_at AS shipment_updated_at " +
      "FROM orders o LEFT JOIN ekart_shipments s ON s.order_id = o.order_id " +
      "WHERE " + where + " LIMIT 1"
    ).bind(...params).first();
  } catch (e) {
    return json({ ok: false, error: "Tracking is temporarily unavailable" }, 503);
  }

  if (!order || normalizePhone(order.phone) !== phone) {
    return json({ ok: false, error: "No matching order found. Check the order ID/AWB and phone number." }, 404);
  }

  const activeShipment = ["booked", "in_transit", "out_for_delivery", "exception"].includes(
    String(order.latest_status || order.shipment_status || "")
  );
  const stale = !order.last_tracked_at || (Date.now() - new Date(order.last_tracked_at).getTime() > 3 * 60 * 1000);
  if (order.awb && activeShipment && stale) {
    const refreshed = await refreshFromAdmin(env, order.awb);
    if (refreshed) {
      try {
        const fresh = await env.DB.prepare(
          "SELECT id AS shipment_id, awb, status AS shipment_status, latest_status, latest_event, " +
          "expected_delivery_date, booked_at, last_tracked_at, updated_at AS shipment_updated_at " +
          "FROM ekart_shipments WHERE order_id = ?"
        ).bind(order.order_id).first();
        if (fresh) order = { ...order, ...fresh };
      } catch (e) {}
    }
  }

  const shipmentStatus = String(order.latest_status || order.shipment_status || "");
  let timeline = [];
  if (order.shipment_id) {
    try {
      const { results } = await env.DB.prepare(
        "SELECT mapped_status, status, event_at, location FROM ekart_shipment_events " +
        "WHERE shipment_id = ? ORDER BY event_at DESC, id DESC LIMIT 20"
      ).bind(order.shipment_id).all();
      timeline = (results || []).map((row) => {
        const status = String(row.mapped_status || row.status || "");
        return {
          status,
          label: statusLabel(status),
          at: normalizeDate(row.event_at),
          location: String(row.location || ""),
        };
      });
    } catch (e) {}
  }

  return json({
    ok: true,
    order: {
      order_id: order.order_id,
      order_status: String(order.status || ""),
      order_status_label: statusLabel(order.status),
      created_at: normalizeDate(order.created_at),
      payment_method: String(order.payment_method || ""),
    },
    shipment: order.awb ? {
      awb: String(order.awb || ""),
      status: shipmentStatus,
      status_label: statusLabel(shipmentStatus),
      latest_event: String(order.latest_event || ""),
      expected_delivery_date: normalizeDate(order.expected_delivery_date),
      booked_at: normalizeDate(order.booked_at),
      updated_at: normalizeDate(order.shipment_updated_at || order.last_tracked_at),
      timeline,
    } : null,
    message: order.awb ? "" : "Your order is confirmed. A tracking number will appear after despatch.",
  });
}
