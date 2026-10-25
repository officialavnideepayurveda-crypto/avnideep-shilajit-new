// ============================================================
// AVNIDEEP SHOP — Public payment configuration for checkout
// ------------------------------------------------------------
// Single source of truth is the D1 `settings` table (section 'payment'),
// written by the admin worker. Read here SAME-ORIGIN so checkout never
// depends on a cross-origin admin fetch and can never silently fall back to
// a stale hardcoded payment mode.
//
// Response: { ok, cod_enabled, advance_enabled, prepaid_enabled,
//             default_method, advance_amount, checkout_mode,
//             enabled_methods, source }
//
// A database failure returns 503 { ok:false }. The storefront MUST show a
// retry/error state in that case instead of painting stale prices.
// ============================================================

import { DEFAULT_ADVANCE_AMOUNT, DEFAULT_PAYMENT_METHOD, normalizePaymentConfig } from "./_lib/pricing";

// Used only when the settings table exists but has no payment rows yet (fresh
// install). The admin panel remains the single source of truth once it writes.
const DEFAULTS = {
  cod_enabled: true,
  advance_enabled: true,
  prepaid_enabled: true,
  default_method: DEFAULT_PAYMENT_METHOD,
  advance_amount: DEFAULT_ADVANCE_AMOUNT,
  checkout_mode: "prepaid",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Admin changes must reach the storefront immediately: no edge cache.
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function boolValue(v) {
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export async function onRequestGet({ env }) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    return json({ ok: false, error: "Payment configuration unavailable" }, 503);
  }

  try {
    try {
      await env.DB.exec(
        "CREATE TABLE IF NOT EXISTS settings (section TEXT NOT NULL DEFAULT 'commission', key TEXT NOT NULL, value TEXT DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (section, key))"
      );
    } catch (e) {
      // The table normally exists (admin-created). A CREATE failure is not
      // fatal by itself; the SELECT below decides whether config is usable.
    }

    const res = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE section = 'payment'"
    ).all();
    const rows = (res && res.results) || [];
    if (!rows.length) {
      const cfg = normalizePaymentConfig(DEFAULTS);
      return json({ ok: true, ...cfg, source: "defaults" });
    }

    const raw = {};
    for (const row of rows) {
      const k = String((row && row.key) || "").trim();
      const v = String(row && row.value == null ? "" : row.value).trim();
      if (!k) continue;
      if (k === "advance_amount") {
        const n = Math.round(Number(v));
        if (Number.isFinite(n) && n > 0) raw.advance_amount = n;
      } else if (
        k === "cod_enabled" || k === "advance_enabled" || k === "prepaid_enabled"
      ) {
        raw[k] = boolValue(v);
      } else if (k === "default_method" || k === "checkout_mode") {
        raw[k] = v.toLowerCase();
      }
    }

    const cfg = normalizePaymentConfig(raw);
    return json({ ok: true, ...cfg, source: "db" });
  } catch (e) {
    console.error("PAYMENT_CONFIG_FAILED", String(e && e.message || e).slice(0, 160));
    return json({ ok: false, error: "Payment configuration unavailable" }, 503);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
