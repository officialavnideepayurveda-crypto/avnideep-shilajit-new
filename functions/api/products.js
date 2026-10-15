// ============================================================
// AVNIDEEP SHOP — Public catalog API (admin-managed products)
// Reads the shared D1 (products table, created by admin worker).
// Cached 5 min at edge. powers stock badges + cart prices.
// ============================================================

const PRODUCT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT DEFAULT '',
    price_prepaid INTEGER DEFAULT 0,
    price_cod INTEGER DEFAULT 0,
    mrp INTEGER DEFAULT 0,
    in_stock INTEGER DEFAULT 1,
    stock_qty INTEGER DEFAULT 100,
    image_url TEXT DEFAULT '',
    badge TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

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
    if (!env?.DB) return json({ ok: false, error: "DB unavailable" }, 500);
    try { await env.DB.exec(PRODUCT_SCHEMA); } catch (e) {}
    const res = await env.DB.prepare(
      "SELECT * FROM products WHERE active = 1 ORDER BY sort_order ASC, id ASC"
    ).all();
    const products = (res.results || []).map((r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku || "",
      price_prepaid: Number(r.price_prepaid || 0),
      price_cod: Number(r.price_cod || 0),
      mrp: Number(r.mrp || 0),
      in_stock: Number(r.in_stock ?? 1),
      stock_qty: Number(r.stock_qty ?? 0),
      out_of_stock: Number(r.in_stock ?? 1) !== 1 || Number(r.stock_qty ?? 0) <= 0,
      image_url: r.image_url || "",
      badge: r.badge || "",
    }));
    return json({ ok: true, products });
  } catch (e) {
    return json({ ok: false, error: "Catalog error" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}
