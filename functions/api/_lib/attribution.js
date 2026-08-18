// ============================================================
// AVNIDEEP SHOP — Referral Attribution Lib (Sprint 2)
// PRIMARY attribution runs here, inside the existing order POST
// (order.js), by reading the avnideep_ref cookie set by app.v3.js.
// The order API response shape and existing behavior are untouched.
// Best-effort by design: any failure is logged and NEVER fails the order.
// Uses the shared D1 (avnideep-orders) — same DB as the partner portal.
// ============================================================

// Loose parse: returns the raw cookie value ('' if absent)
export function parseRefCookie(cookieHeader) {
  const m = String(cookieHeader || "").match(/(?:^|;\s*)avnideep_ref=([^;]+)/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).trim();
  } catch (e) {
    return "";
  }
}

// Partner codes are generated as AVN + 6 chars from an unambiguous
// alphabet (no 0/O/1/I/L) — see validation.js generatePartnerCode.
const CODE_RE = /^AVN[A-HJ-KM-NP-Z2-9]{6}$/;
export function isValidPartnerCode(code) {
  return CODE_RE.test(String(code || "").toUpperCase());
}

let bootstrapped = false;

// CRITICAL FIX: D1's runtime exec() parser fails on multi-line / multi-statement
// strings ("incomplete input: SQLITE_ERROR") — the old single exec() below ALWAYS
// failed, so ensureSchema() returned false and recordOrderAttribution silently
// returned { attributed:false, reason:'no_schema' } — referrals never recorded.
// Statements are split and collapsed to single lines, executed individually.
const ATTR_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS referral_attributions (
    order_id TEXT PRIMARY KEY,
    partner_id INTEGER NOT NULL,
    partner_code TEXT NOT NULL,
    customer_mobile TEXT DEFAULT '',
    source TEXT DEFAULT '',
    attributed_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ra_partner ON referral_attributions(partner_id, attributed_at);
  CREATE INDEX IF NOT EXISTS idx_ra_code ON referral_attributions(partner_code);
`;
const ATTR_SCHEMA_STATEMENTS = ATTR_SCHEMA_SQL
  .split("\n")
  .filter((ln) => !ln.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .map((s) => s + ";");

async function ensureSchema(env) {
  if (!env?.DB) return false;
  try {
    if (!bootstrapped) {
      for (const stmt of ATTR_SCHEMA_STATEMENTS) {
        await env.DB.exec(stmt);
      }
      bootstrapped = true;
    }
    return true;
  } catch (e) {
    console.warn("ATTR_SCHEMA_FAILED", String(e.message || e).slice(0, 150));
    return false;
  }
}

// Sprint 2 improvement #2 — partner must be:
//   Approved OR Active  ·  Not Suspended  ·  Commission Enabled  ·  Not Expired
// NOTE: duplicated intentionally in Partners-Portal/_lib/attribution-db.js
// (separate deployments share one D1) — keep both in sync.
export function isPartnerEligible(p) {
  if (!p) return false;
  const status = String(p.status || "");
  if (status !== "approved" && status !== "active") return false;
  if (Number(p.commission_enabled ?? 1) !== 1) return false;
  // WARN-1 FIX: blacklisted partners must NOT receive attribution either
  if (Number(p.blacklisted || 0) === 1) return false;
  if (p.expires_at) {
    let ts = String(p.expires_at).trim().replace(/Z$/, "");
    const exp = new Date(ts.replace(" ", "T") + "Z").getTime();
    if (!isNaN(exp) && exp < Date.now()) return false;
  }
  return true;
}

// WARN-4 FIX: server-side 30-day referral window (ref_set_at = epoch seconds when the
// ref cookie was written by app.v3.js). Absent/0 = legacy cookie, treated as valid.
const REF_WINDOW_SEC = 30 * 86400;
export function isRefFresh(refSetAt) {
  const ts = Number(refSetAt) || 0;
  if (!ts) return true; // legacy cookie without timestamp — backward compatible
  return Math.floor(Date.now() / 1000) - ts <= REF_WINDOW_SEC;
}

// Reads the avnideep_ref_ts cookie (epoch seconds) written alongside avnideep_ref.
export function parseRefTs(cookieHeader) {
  const m = String(cookieHeader || "").match(/(?:^|;\s*)avnideep_ref_ts=([^;]+)/);
  if (!m) return 0;
  const n = parseInt(decodeURIComponent(m[1]), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Primary attribution — called from order.js right after the order row
 * is saved. Validates the ref cookie against the partners table and
 * inserts idempotently (INSERT OR IGNORE). Self-referrals are allowed:
 * commission is gated on the admin marking the order 'delivered'.
 * @returns {Promise<{attributed: boolean, reason?: string}>}
 */
export async function recordOrderAttribution(env, { order_id, ref_code, customer_mobile, source, ref_set_at }) {
  if (!order_id) return { attributed: false, reason: "no_order_id" };
  const code = String(ref_code || "").toUpperCase();
  if (!isValidPartnerCode(code)) return { attributed: false, reason: "bad_code_format" };
  if (!(await ensureSchema(env))) return { attributed: false, reason: "no_schema" };

  try {
    const partner = await env.DB.prepare(
      "SELECT id, partner_code, mobile, status, commission_enabled, expires_at, blacklisted FROM partners WHERE partner_code = ?"
    ).bind(code).first();
    if (!isPartnerEligible(partner)) return { attributed: false, reason: "partner_not_eligible" };

    // WARN-4 FIX: reject stale ref cookies server-side (30-day window)
    if (!isRefFresh(ref_set_at)) return { attributed: false, reason: "ref_expired" };

    // NOTE: self-referral is intentionally NOT blocked here anymore — commission is
    // only created when the admin marks the order 'delivered' (manual approval ON),
    // so the admin retains full control over which orders earn commission.
    const cust = String(customer_mobile || "").replace(/[^0-9]/g, "").slice(-10);

    // Idempotent: duplicate order_id (retry / recovery beacon) is a no-op
    await env.DB.prepare(
      `INSERT OR IGNORE INTO referral_attributions
        (order_id, partner_id, partner_code, customer_mobile, source)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(order_id, partner.id, partner.partner_code, cust, source || "order_cookie").run();

    return { attributed: true, reason: "" };
  } catch (e) {
    console.warn("ATTR_RECORD_FAILED", String(e.message || e).slice(0, 150));
    return { attributed: false, reason: "db_error" };
  }
}
