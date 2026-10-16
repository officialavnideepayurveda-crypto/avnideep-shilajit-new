// ============================================================
// AVNIDEEP SHOP — Customer login API (mobile + PIN, partner-style)
// First login creates the account: customer enters mobile → if the
// number is new they set a 4–6 digit PIN, otherwise they enter it.
// Sessions are random tokens in D1 (httpOnly cookie `avn_cust`).
// Best-effort everywhere: auth must NEVER break checkout/order APIs.
// ============================================================

const AUTH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS customers (
    mobile TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    failed_attempts INTEGER DEFAULT 0,
    locked_until INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS customer_sessions (
    token_hash TEXT PRIMARY KEY,
    mobile TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_cust_sessions_mobile ON customer_sessions(mobile);
`;

// BUG FIX — D1's exec()/prepare() runs SQL line-by-line, so any statement that
// spans multiple lines fails with "incomplete input: SQLITE_ERROR". The old
// `env.DB.exec(AUTH_SCHEMA)` therefore ALWAYS failed, `customers` /
// `customer_sessions` were never created, and every check/login/register call
// returned 500. (Same root cause already fixed in _lib/attribution.js.)
// Split the schema into single-line statements and run them one at a time.
const AUTH_SCHEMA_STATEMENTS = AUTH_SCHEMA
  .split("\n")
  .filter((ln) => !ln.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean);

const COOKIE_NAME = "avn_cust";
const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;
const ALLOWED_HOSTS = ["shop.avnideep.in", "avnideep-shilajit-new.pages.dev", "localhost", "127.0.0.1"];

function json(data, status = 200, extraHeaders) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": "*",
  };
  if (extraHeaders) {
    for (const k of Object.keys(extraHeaders)) headers[k] = extraHeaders[k];
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function normalizeMobile(raw) {
  const digits = String(raw || "").replace(/[^0-9]/g, "");
  const m = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(m) ? m : "";
}

function validPin(pin) {
  return /^\d{4,6}$/.test(String(pin || ""));
}

function cleanName(raw) {
  return String(raw || "").replace(/[<>"']/g, "").trim().slice(0, 50);
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
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

function sessionCookie(token, maxAge) {
  let c = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  // Secure only on https (local dev over http must still work)
  c += "; Secure";
  return c;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

function originAllowed(request) {
  try {
    const origin = request.headers.get("Origin") || request.headers.get("Referer") || "";
    if (!origin) return true;
    const host = new URL(origin).hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch (e) {
    return true;
  }
}

async function ensureSchema(env) {
  if (!env?.DB) return false;
  try {
    // Cheap once-only gate (same pattern as orders bootstrap)
    try {
      if ((await env.RATE_LIMIT_KV?.get("d1_schema_auth_v1")) === "1") return true;
    } catch (e) {}
    for (const stmt of AUTH_SCHEMA_STATEMENTS) {
      await env.DB.prepare(stmt).run();
    }
    try { await env.RATE_LIMIT_KV?.put("d1_schema_auth_v1", "1", { expirationTtl: 86400 * 30 }); } catch (e) {}
    return true;
  } catch (e) {
    return false;
  }
}

async function createSession(env, mobile) {
  const token = randomToken();
  const tokenHash = await sha256hex("avn_cust:" + token);
  const expiresAt = Date.now() + SESSION_DAYS * 86400 * 1000;
  await env.DB.prepare(
    "INSERT INTO customer_sessions (token_hash, mobile, expires_at) VALUES (?, ?, ?)"
  ).bind(tokenHash, mobile, expiresAt).run();
  // Opportunistic cleanup of expired sessions (best-effort, tiny table)
  try {
    await env.DB.prepare("DELETE FROM customer_sessions WHERE expires_at < ?").bind(Date.now()).run();
  } catch (e) {}
  return { token, expiresAt };
}

async function readSession(env, request) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token || token.length < 32) return null;
  try {
    const tokenHash = await sha256hex("avn_cust:" + token);
    const row = await env.DB.prepare(
      "SELECT mobile, expires_at FROM customer_sessions WHERE token_hash = ?"
    ).bind(tokenHash).first();
    if (!row || Number(row.expires_at || 0) < Date.now()) return null;
    const cust = await env.DB.prepare(
      "SELECT mobile, name FROM customers WHERE mobile = ?"
    ).bind(row.mobile).first();
    if (!cust) return null;
    // Sliding expiry (best-effort)
    try {
      await env.DB.prepare(
        "UPDATE customer_sessions SET expires_at = ? WHERE token_hash = ?"
      ).bind(Date.now() + SESSION_DAYS * 86400 * 1000, tokenHash).run();
    } catch (e) {}
    return { mobile: cust.mobile, name: cust.name || "" };
  } catch (e) {
    return null;
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!originAllowed(request)) return json({ ok: false, error: "Access denied" }, 403);
    if (!env?.DB) return json({ ok: false, error: "Service unavailable" }, 503);
    await ensureSchema(env);
    const url = new URL(request.url);
    if (url.searchParams.get("action") !== "me") {
      return json({ ok: false, error: "Unknown action" }, 400);
    }
    const sess = await readSession(env, request);
    if (!sess) return json({ ok: true, loggedIn: false });
    return json({ ok: true, loggedIn: true, name: sess.name, mobile: sess.mobile });
  } catch (e) {
    return json({ ok: false, error: "Auth error" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!originAllowed(request)) return json({ ok: false, error: "Access denied" }, 403);
    if (!env?.DB) return json({ ok: false, error: "Service unavailable" }, 503);
    await ensureSchema(env);

    let body = null;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: "Invalid request" }, 400);
    }
    const action = String(body?.action || "");

    // ---------- logout ----------
    if (action === "logout") {
      try {
        const token = getCookie(request, COOKIE_NAME);
        if (token) {
          const tokenHash = await sha256hex("avn_cust:" + token);
          await env.DB.prepare("DELETE FROM customer_sessions WHERE token_hash = ?").bind(tokenHash).run();
        }
      } catch (e) {}
      return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
    }

    // ---------- me (POST variant) ----------
    if (action === "me") {
      const sess = await readSession(env, request);
      if (!sess) return json({ ok: true, loggedIn: false });
      return json({ ok: true, loggedIn: true, name: sess.name, mobile: sess.mobile });
    }

    const mobile = normalizeMobile(body?.mobile);
    if (!mobile) {
      return json({ ok: false, error: "Please enter a valid 10-digit mobile number." }, 400);
    }

    // ---------- check: does this number have a PIN? ----------
    if (action === "check") {
      const cust = await env.DB.prepare(
        "SELECT mobile, name FROM customers WHERE mobile = ?"
      ).bind(mobile).first();
      if (!cust) return json({ ok: true, exists: false });
      return json({ ok: true, exists: true, name: cust.name || "" });
    }

    // ---------- register: first login creates the account ----------
    if (action === "register") {
      const name = cleanName(body?.name);
      const pin = String(body?.pin || "");
      const pin2 = String(body?.pin2 ?? pin);
      if (name.length < 2) return json({ ok: false, error: "Please enter your name." }, 400);
      if (!validPin(pin)) return json({ ok: false, error: "PIN must be 4–6 digits." }, 400);
      if (pin !== pin2) return json({ ok: false, error: "PINs do not match. Please re-enter." }, 400);
      const existing = await env.DB.prepare(
        "SELECT mobile FROM customers WHERE mobile = ?"
      ).bind(mobile).first();
      if (existing) return json({ ok: false, error: "exists" }, 409);
      const salt = randomToken().slice(0, 32);
      const pinHash = await sha256hex(salt + ":" + pin);
      const now = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO customers (mobile, name, pin_hash, pin_salt, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(mobile, name, pinHash, salt, now, now).run();
      const sess = await createSession(env, mobile);
      return json(
        { ok: true, name, mobile },
        200,
        { "Set-Cookie": sessionCookie(sess.token, SESSION_DAYS * 86400) }
      );
    }

    // ---------- login ----------
    if (action === "login") {
      const pin = String(body?.pin || "");
      if (!validPin(pin)) return json({ ok: false, error: "Please enter your 4–6 digit PIN." }, 400);
      const cust = await env.DB.prepare(
        "SELECT mobile, name, pin_hash, pin_salt, failed_attempts, locked_until FROM customers WHERE mobile = ?"
      ).bind(mobile).first();
      if (!cust) return json({ ok: false, error: "not_found" }, 404);
      const now = Date.now();
      if (Number(cust.locked_until || 0) > now) {
        const mins = Math.max(1, Math.ceil((Number(cust.locked_until) - now) / 60000));
        return json({ ok: false, error: `Too many wrong attempts. Try again in ${mins} min.` }, 429);
      }
      const pinHash = await sha256hex(String(cust.pin_salt || "") + ":" + pin);
      if (pinHash !== cust.pin_hash) {
        const fails = Number(cust.failed_attempts || 0) + 1;
        const lockUntil = fails >= MAX_FAILS ? now + LOCK_MS : 0;
        try {
          await env.DB.prepare(
            "UPDATE customers SET failed_attempts = ?, locked_until = ? WHERE mobile = ?"
          ).bind(lockUntil ? 0 : fails, lockUntil, mobile).run();
        } catch (e) {}
        if (lockUntil) {
          return json({ ok: false, error: "Too many wrong attempts. Try again in 10 min." }, 429);
        }
        const left = MAX_FAILS - fails;
        return json({ ok: false, error: `Wrong PIN. ${left} attempt${left === 1 ? "" : "s"} left.` }, 401);
      }
      try {
        await env.DB.prepare(
          "UPDATE customers SET failed_attempts = 0, locked_until = 0, last_login = ? WHERE mobile = ?"
        ).bind(new Date().toISOString(), mobile).run();
      } catch (e) {}
      const sess = await createSession(env, mobile);
      return json(
        { ok: true, name: cust.name || "", mobile },
        200,
        { "Set-Cookie": sessionCookie(sess.token, SESSION_DAYS * 86400) }
      );
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: "Auth error" }, 500);
  }
}
