-- 0001_bootstrap_tables.sql — create the base tables every later migration
-- indexes or writes to.
--
-- WHY THIS FILE EXISTS (bug fix): the migration directory only ever contained
-- CREATE INDEX statements, so on a FRESH database nothing created `orders`,
-- `leads` or `analytics_events` first and every later migration failed:
--   0002 -> no such table: main.orders
--   0003 -> no such table: main.orders (and main.leads)
--   0004 -> no such table: main.analytics_events
--   0005 -> no such table: main.orders
-- i.e. `wrangler d1 migrations apply` could never provision a new environment.
--
-- These tables are ALSO bootstrapped at runtime (order.js / leads.js), so on an
-- existing database every statement below is a no-op thanks to IF NOT EXISTS.
-- Schemas mirror the runtime ones exactly — keep them in sync:
--   orders           <- functions/api/order.js (ensureOrdersTable / saveToD1)
--   leads            <- functions/api/leads.js
--   analytics_events <- historical functions/api/track.js schema (indexed by 0004)

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  pincode TEXT DEFAULT '',
  address TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'cod',
  amount REAL DEFAULT 0,
  product TEXT DEFAULT 'Avnideep 6Pro Vitality Shilajit Capsules',
  status TEXT DEFAULT 'cod_order',
  source TEXT DEFAULT '',
  page_url TEXT DEFAULT '',
  utr TEXT DEFAULT '',
  payment_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  utm_source TEXT DEFAULT '',
  utm_medium TEXT DEFAULT '',
  utm_campaign TEXT DEFAULT '',
  fbp TEXT DEFAULT '',
  fbc TEXT DEFAULT '',
  razorpay_order_id TEXT DEFAULT '',
  razorpay_payment_id TEXT DEFAULT '',
  razorpay_signature TEXT DEFAULT '',
  payment_status TEXT DEFAULT '',
  payment_captured INTEGER DEFAULT 0,
  webhook_verified INTEGER DEFAULT 0,
  refund_status TEXT DEFAULT '',
  purchase_capi_sent INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  phone TEXT UNIQUE,
  source TEXT DEFAULT 'truecaller',
  ip_address TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  session_id TEXT NOT NULL,
  page_url TEXT DEFAULT '',
  utm_source TEXT DEFAULT '',
  utm_medium TEXT DEFAULT '',
  utm_campaign TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
