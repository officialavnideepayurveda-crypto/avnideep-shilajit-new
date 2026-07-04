// ============================================================
// AVNIDEEP LEADS API - Cloudflare Function
// Endpoint: POST /api/leads
// Called by TruecallerLogin.jsx after successful verification
// ============================================================

const corsHeaders = (env) => ({
  "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
});

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const phone = String(body.phone || "").replace(/[^0-9]/g, "").slice(-10);
    if (!phone || phone.length < 10) {
      return new Response(
        JSON.stringify({ ok: false, error: "Valid phone number required" }),
        { status: 400, headers: corsHeaders(env) }
      );
    }

    const name = String(body.name || "Truecaller User").trim().slice(0, 100);
    const source = String(body.source || "truecaller").trim().slice(0, 50);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    // Save to D1 once per valid lead event.
    let d1Result = { skipped: true };
    if (env.DB) {
      try {
        await env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT DEFAULT '',
            phone TEXT UNIQUE,
            source TEXT DEFAULT 'truecaller',
            ip_address TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
          )`
        ).run();

        const existing = await env.DB.prepare('SELECT id, name, source, ip_address FROM leads WHERE phone = ?').bind(phone).first();

        if (!existing) {
          await env.DB.prepare(
            `INSERT INTO leads (name, phone, source, ip_address, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
          ).bind(name, phone, source, ip).run();
          d1Result = { ok: true };
        } else if (existing.name !== name || existing.source !== source || existing.ip_address !== ip) {
          await env.DB.prepare(
            `UPDATE leads SET name = ?, source = ?, ip_address = ?, created_at = datetime('now')
             WHERE phone = ?`
          ).bind(name, source, ip, phone).run();
          d1Result = { ok: true, note: "updated" };
        } else {
          d1Result = { ok: true, note: "unchanged" };
        }
      } catch (e) {
        d1Result = { ok: false, error: String(e.message || e).slice(0, 100) };
      }
    }

    return new Response(
      JSON.stringify({ ok: true, message: "Lead saved", lead: { name, phone, source } }),
      { status: 200, headers: corsHeaders(env) }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message || "Server error" }),
      { status: 500, headers: corsHeaders(env) }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
