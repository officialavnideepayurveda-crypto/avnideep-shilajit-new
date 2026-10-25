// ============================================================
// AVNIDEEP PRICING RULE — single source of truth
// ------------------------------------------------------------
// Three payment options per product, all derived from one configurable
// per-product price triple (stored in the D1 `products` table):
//
//   cod      — "Pay on Delivery": the whole COD total.
//   advance  — "Book with ₹X": the (slightly lower) TOTAL when the customer
//              pays a small booking advance online and the rest on delivery.
//   prepaid  — "Pay Online & Save": paid fully online, nothing on delivery.
//
// DEFAULT RULE (when a product has no explicit override, i.e. the legacy
// catalogue): MRP *is* the COD total, prepaid is MRP - 20%, and the advance
// total defaults to the COD total (no booking incentive configured).
//
// The booking advance itself (the rupee amount paid online now) is an
// order-level value (settings.payment.advance_amount, default ₹100) — it is
// NOT multiplied by quantity and is never added on top of the order total.
//
// All arithmetic is done in integer paise. Rupee values are only produced at
// the boundary (UI / legacy DB columns).
// ============================================================

export const PREPAID_DISCOUNT_PCT = 20;
export const DEFAULT_ADVANCE_AMOUNT = 100;

export const PAYMENT_METHODS = Object.freeze(["cod", "advance", "prepaid"]);

// Prepaid is the storefront default: it is the lowest price and the first
// option customers should see on a fresh visit. COD and advance stay enabled.
export const DEFAULT_PAYMENT_METHOD = "prepaid";

export function posInt(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Rupees (number or numeric string) -> integer paise. */
export function toPaise(rupees) {
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Integer paise -> rupees. Whole-rupee catalogue prices stay whole. */
export function fromPaise(paise) {
  const n = Number(paise);
  return Number.isFinite(n) ? Math.round(n) / 100 : 0;
}

// explicit: { cod, advance, prepaid } — admin-configured values. Any field that
// is 0/absent is derived from the MRP, so legacy rows keep working unchanged.
export function pricesFromMrp(mrp, explicit) {
  const m = Math.max(0, Math.round(Number(mrp) || 0));
  const e = explicit || {};
  const cod = posInt(e.cod) || m;
  const prepaid = posInt(e.prepaid) || Math.round((m * (100 - PREPAID_DISCOUNT_PCT)) / 100);
  const advance = posInt(e.advance) || cod;
  return { mrp: m, cod, advance, prepaid };
}

// Same rule for a whole pack table: [{ mrp, explicit }] -> [{ mrp, cod, advance, prepaid }]
export function pricePacks(packs) {
  return (packs || []).map((p) => ({ ...p, ...pricesFromMrp(p && p.mrp, p && p.explicit) }));
}

// Normalise a payment-method value onto the three canonical kinds.
export function paymentKind(method) {
  const m = String(method || "").trim().toLowerCase();
  if (m === "prepaid" || m === "prepaid_online" || m === "online") return "prepaid";
  if (m === "advance" || m === "advance_cod" || m === "booking") return "advance";
  if (m === "cod" || m === "full_cod" || m === "cash" || m === "pay_on_delivery") return "cod";
  return "cod";
}

// Split a chosen method's TOTAL into the amount payable online now vs the
// amount still due on delivery. Never double-counts: payNow + payLater === total.
// Returned values are RUPEES for backwards compatibility; splitPaymentPaise is
// the arithmetic source used by the order API.
export function splitPayment(method, total, advanceAmount) {
  const s = splitPaymentPaise(method, total, advanceAmount);
  return { payNow: fromPaise(s.payNowPaise), payLater: fromPaise(s.payLaterPaise) };
}

export function splitPaymentPaise(method, total, advanceAmount) {
  const totalPaise = Math.max(0, toPaise(total));
  const kind = paymentKind(method);
  const advancePaise = posInt(advanceAmount)
    ? toPaise(advanceAmount)
    : toPaise(DEFAULT_ADVANCE_AMOUNT);

  if (kind === "prepaid") {
    return { kind, totalPaise, payNowPaise: totalPaise, payLaterPaise: 0 };
  }
  if (kind === "advance") {
    const payNowPaise = Math.min(advancePaise, totalPaise);
    return { kind, totalPaise, payNowPaise, payLaterPaise: totalPaise - payNowPaise };
  }
  return { kind, totalPaise, payNowPaise: 0, payLaterPaise: totalPaise };
}

// Every order begins in its method's distinct unpaid state:
//   cod     -> pending_collection (nothing is paid online)
//   advance -> advance_pending    (₹X is due online, balance on delivery)
//   prepaid -> payment_pending    (full amount due online, no COD)
export function initialPaymentState(method) {
  const kind = paymentKind(method);
  if (kind === "advance") {
    return { paymentStatus: "advance_pending", orderStatus: "advance_pending" };
  }
  if (kind === "prepaid") {
    return { paymentStatus: "payment_pending", orderStatus: "payment_pending" };
  }
  return { paymentStatus: "pending_collection", orderStatus: "cod_order" };
}

// State after a server-verified online payment.
//   advance -> partially_paid (COD balance still due)
//   prepaid -> paid            (COD balance must be 0)
export function verifiedPaymentState(method, total, advanceAmount) {
  const totalPaise = Math.max(0, toPaise(total));
  const paidPaise = paymentKind(method) === "advance"
    ? Math.min(toPaise(posInt(advanceAmount) ? advanceAmount : DEFAULT_ADVANCE_AMOUNT), totalPaise)
    : totalPaise;
  const codPaise = Math.max(0, totalPaise - paidPaise);
  const kind = paymentKind(method);
  return {
    kind,
    onlinePaidPaise: paidPaise,
    codDuePaise: codPaise,
    paymentStatus: kind === "advance" ? (codPaise > 0 ? "partially_paid" : "paid") : "paid",
    orderStatus: kind === "advance" ? "advance_paid" : "paid",
  };
}

// Canonical public shape of the admin payment configuration. Both the
// storefront endpoint and the order API use this so a missing/garbled key can
// never flip the checkout back to a hardcoded method.
export function normalizePaymentConfig(raw) {
  const src = raw || {};
  const truthy = (v, dflt) => (v === undefined || v === null || v === "" ? dflt : (v === true || v === 1 || v === "1" || v === "true"));
  const cfg = {
    cod_enabled: truthy(src.cod_enabled, true),
    advance_enabled: truthy(src.advance_enabled, true),
    prepaid_enabled: truthy(src.prepaid_enabled, true),
    default_method: String(src.default_method || "").trim().toLowerCase(),
    advance_amount: posInt(src.advance_amount) || DEFAULT_ADVANCE_AMOUNT,
  };
  // Admin panels have used several names for the same three choices. Map them
  // onto the canonical values before falling back to checkout_mode.
  const aliases = {
    full_cod: "cod", cod: "cod", cash: "cod", pay_on_delivery: "cod",
    advance: "advance", advance_cod: "advance", booking: "advance",
    prepaid: "prepaid", prepaid_online: "prepaid", online: "prepaid",
  };
  const wanted = aliases[cfg.default_method];
  if (wanted) cfg.default_method = wanted;
  // Legacy admin saves only checkout_mode ('full_cod' | 'advance'). Honour it
  // for the DEFAULT selection without disabling the other two options.
  if (!["cod", "advance", "prepaid"].includes(cfg.default_method)) {
    const mode = String(src.checkout_mode || "").trim().toLowerCase();
    cfg.default_method = aliases[mode] || DEFAULT_PAYMENT_METHOD;
  }
  // Never allow an all-disabled checkout: fall back to COD, the legally safest
  // option, rather than showing a dead payment screen.
  if (!cfg.cod_enabled && !cfg.advance_enabled && !cfg.prepaid_enabled) {
    cfg.cod_enabled = true;
    cfg.default_method = "cod";
  }
  // A default that cannot be selected falls through to the first enabled
  // method (prepaid first for a fresh config).
  if (!cfg[cfg.default_method + "_enabled"]) {
    cfg.default_method = PAYMENT_METHODS.find((m) => cfg[m + "_enabled"]) || "cod";
  }
  const enabled = PAYMENT_METHODS.filter((m) => cfg[m + "_enabled"]);
  return {
    ...cfg,
    enabled_methods: enabled,
    checkout_mode: cfg.default_method === "cod" ? "full_cod" : cfg.default_method === "prepaid" ? "prepaid" : "advance",
  };
}
