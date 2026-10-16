-- 0005_customer_auth.sql — customer login (mobile + PIN) + sessions.
-- NOTE: functions/api/auth.js also bootstraps these tables at runtime
-- (CREATE TABLE IF NOT EXISTS), so this migration is belt-and-braces
-- for local `wrangler d1 migrations apply` workflows.

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
CREATE INDEX IF NOT EXISTS idx_orders_phone_last10 ON orders(phone);
