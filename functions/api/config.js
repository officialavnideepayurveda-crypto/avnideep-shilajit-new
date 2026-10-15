// ============================================================
// AVNIDEEP SHOP — Public site config (admin-managed tracking)
// Returns the Meta Pixel ID set in admin panel (settings/tracking).
// Used as fallback if edge HTML rewrite hasn't applied yet.
// ============================================================

const DEFAULT_PIXEL = "1715387275770711";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function onRequestGet({ env }) {
  try {
    let pixel = DEFAULT_PIXEL;
    if (env?.DB) {
      try {
        await env.DB.exec(
          "CREATE TABLE IF NOT EXISTS settings (section TEXT NOT NULL DEFAULT 'commission', key TEXT NOT NULL, value TEXT DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (section, key))"
        );
      } catch (e) {}
      try {
        const row = await env.DB.prepare(
          "SELECT value FROM settings WHERE section = ? AND key = ?"
        ).bind("tracking", "meta_pixel_id").first();
        const v = String(row?.value || "").trim();
        if (/^\d{8,20}$/.test(v)) pixel = v;
      } catch (e) {}
    }
    return json({ ok: true, meta_pixel_id: pixel });
  } catch (e) {
    return json({ ok: true, meta_pixel_id: DEFAULT_PIXEL });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}
