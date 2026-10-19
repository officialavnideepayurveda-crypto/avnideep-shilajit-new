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

// BUG FIX — same D1 line-by-line SQL limitation as auth.js/_lib/attribution.js:
// PRODUCT_SCHEMA spans multiple lines, so `DB.exec(PRODUCT_SCHEMA)` always threw
// "incomplete input: SQLITE_ERROR" (silently swallowed below). On any database
// that didn't already have a `products` table (created by the admin worker), the
// following SELECT threw "no such table" and /api/products returned 500.
const PRODUCT_SCHEMA_STATEMENTS = PRODUCT_SCHEMA
  .split("\n")
  .filter((ln) => !ln.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean);

// Bootstrap once per isolate (same pattern as leads.js / order.js) so we don't
// issue a DDL write on every catalog request.
let productsSchemaBootstrapped = false;

async function ensureProductsTable(env) {
  if (productsSchemaBootstrapped) return;
  for (const stmt of PRODUCT_SCHEMA_STATEMENTS) {
    await env.DB.prepare(stmt).run();
  }
  productsSchemaBootstrapped = true;
}

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

import { pricesFromMrp } from './_lib/pricing';

export async function onRequestGet({ env }) {
  try {
    if (!env?.DB) return json({ ok: false, error: "DB unavailable" }, 500);
    try { await ensureProductsTable(env); } catch (e) {}
    const res = await env.DB.prepare(
      "SELECT * FROM products WHERE active = 1 ORDER BY sort_order ASC, id ASC"
    ).all();
    const products = (res.results || []).map((r) => {
      // PRICING RULE: a product's MRP *is* its COD price and prepaid is MRP - 20%.
      // Derived here (not read from the legacy price_cod / price_prepaid columns)
      // so every storefront surface gets the same pair for the same MRP.
      const mrp = Number(r.mrp || 0);
      const stored = pricesFromMrp(Number(r.price_cod || 0) || Number(r.price_prepaid || 0));
      const price = mrp > 0 ? pricesFromMrp(mrp) : stored;
      return {
      id: r.id,
      name: r.name,
      sku: r.sku || "",
      price_prepaid: price.prepaid,
      price_cod: price.cod,
      mrp: price.mrp,
      in_stock: Number(r.in_stock ?? 1),
      stock_qty: Number(r.stock_qty ?? 0),
      out_of_stock: Number(r.in_stock ?? 1) !== 1 || Number(r.stock_qty ?? 0) <= 0,
      image_url: r.image_url || "",
      badge: r.badge || "",
      };
    });
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
