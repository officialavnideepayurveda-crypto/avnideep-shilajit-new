// ============================================================
// AVNIDEEP SHOP — "My Orders" API (logged-in customers only)
// Reads the session cookie (same logic as auth.js), then returns
// the customer's orders matched by mobile number (last 10 digits).
// Never leaks other customers' data; address/pincode are withheld.
// ============================================================

import { corsHeaders } from "./_lib/cors.js";

function json(data, status = 200, request = null, env = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      ...corsHeaders(request, env, "GET, OPTIONS"),
    },
  });
}

function getCookie(request, name) {
  try {
    const header = request.headers.get("Cookie") || "";
    const parts = header.split(";");
    for (const p of parts) {
      const idx = p.indexOf("=");
      if (idx < 0) continue;
      if (p.slice(0, idx).trim() === name) return decodeURIComponent(p.slice(idx + 1).trim());
    }
  } catch (e) {}
  return "";
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readSessionMobile(env, request) {
  try {
    const token = getCookie(request, "avn_cust");
    if (!token || token.length < 32) return "";
    const tokenHash = await sha256hex("avn_cust:" + token);
    const row = await env.DB.prepare(
      "SELECT mobile, expires_at FROM customer_sessions WHERE token_hash = ?"
    ).bind(tokenHash).first();
    if (!row || Number(row.expires_at || 0) < Date.now()) return "";
    return String(row.mobile || "");
  } catch (e) {
    return "";
  }
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env, "GET, OPTIONS"),
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.DB) return json({ ok: false, error: "Service unavailable" }, 503, request, env);
    const mobile = await readSessionMobile(env, request);
    if (!mobile) return json({ ok: false, error: "Please login to view your orders." }, 401, request, env);

    // Phones may be stored with +91/spaces — compare last 10 digits only.
    const res = await env.DB.prepare(
      `SELECT order_id, product, amount, payment_method, status, created_at
       FROM orders
       WHERE substr(REPLACE(REPLACE(REPLACE(IFNULL(phone,''),' ',''),'-',''),'+',''), -10) = ?
       ORDER BY created_at DESC
       LIMIT 20`
    ).bind(mobile).all();

    const orders = (res.results || []).map((r) => ({
      order_id: r.order_id || "",
      product: r.product || "",
      amount: Number(r.amount || 0),
      payment_method: r.payment_method || "cod",
      status: r.status || "",
      created_at: r.created_at || "",
    }));
    return json({ ok: true, mobile, orders }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "Could not load orders" }, 500, request, env);
  }
}
