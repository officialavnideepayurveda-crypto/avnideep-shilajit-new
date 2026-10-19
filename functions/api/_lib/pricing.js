// ============================================================
// AVNIDEEP PRICING RULE — single source of truth
// ------------------------------------------------------------
// Business rule (Oct 2026): a product's MRP *is* its COD price.
// Prepaid gets exactly 20% off that MRP. There is no other
// discount step, so the old "COD = MRP - 10%, prepaid = COD - 10%"
// chain (19% total) is gone — it never matched the catalogue and
// double-counted the discount.
//
// Every surface (PDP pack tables, cart drawer, checkout summary,
// Razorpay amount, /api/order verification, DB rows, admin) must
// derive COD / prepaid from the same MRP through this helper.
// ============================================================

export const PREPAID_DISCOUNT_PCT = 20;

export function pricesFromMrp(mrp) {
  const m = Math.max(0, Math.round(Number(mrp) || 0));
  const prepaid = Math.round((m * (100 - PREPAID_DISCOUNT_PCT)) / 100);
  return { mrp: m, cod: m, prepaid };
}

// Same rule for a whole pack table: [{ mrp }] -> [{ mrp, cod, prepaid }]
export function pricePacks(packs) {
  return (packs || []).map((p) => ({ ...p, ...pricesFromMrp(p && p.mrp) }));
}
