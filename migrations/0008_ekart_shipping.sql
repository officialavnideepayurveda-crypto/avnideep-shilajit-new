-- 0008_ekart_shipping.sql — Ekart Logistics integration (additive only).
--
-- SAFE BY DEFAULT:
--   * No existing table or column is altered.
--   * Every Ekart setting is seeded DISABLED (enabled = 0, auto_book = 0).
--   * No live shipment can be booked until BOTH the admin setting and the
--     worker secret EKART_LIVE_BOOKING_APPROVED=1 are present. See
--     EKART-INTEGRATION.md.
--
-- The shop's D1 database is the single source of truth. The admin worker
-- (Avnideep-Shilajit-Admin/admin-api-worker) reads and writes these tables.

CREATE TABLE IF NOT EXISTS settings (
  section TEXT NOT NULL DEFAULT 'commission',
  key TEXT NOT NULL,
  value TEXT DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (section, key)
);

-- ---------------------------------------------------------------------------
-- 1. Shipments: exactly one row per website order (UNIQUE order_id) and one
--    AWB per row (UNIQUE awb). `idempotency_key` is derived from the order id
--    and is also UNIQUE, so retries/duplicate requests can never book twice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ekart_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'ekart',
  status TEXT NOT NULL DEFAULT 'pending',
  booking_status TEXT DEFAULT '',
  payment_mode TEXT DEFAULT 'PREPAID',
  awb TEXT UNIQUE,
  ekart_shipment_id TEXT DEFAULT '',
  client_reference_id TEXT DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  request_id TEXT DEFAULT '',
  label_url TEXT DEFAULT '',
  label_generated_at TEXT DEFAULT '',
  cod_amount_paise INTEGER DEFAULT 0,
  declared_value_paise INTEGER DEFAULT 0,
  weight_grams INTEGER DEFAULT 0,
  length_cm REAL DEFAULT 0,
  breadth_cm REAL DEFAULT 0,
  height_cm REAL DEFAULT 0,
  expected_delivery_date TEXT DEFAULT '',
  manifest_id INTEGER DEFAULT 0,
  manifested_at TEXT DEFAULT '',
  booking_started_at TEXT DEFAULT '',
  booked_at TEXT DEFAULT '',
  attempt_count INTEGER DEFAULT 0,
  last_error_code TEXT DEFAULT '',
  last_error_message TEXT DEFAULT '',
  last_http_status INTEGER DEFAULT 0,
  next_retry_at TEXT DEFAULT '',
  last_tracked_at TEXT DEFAULT '',
  last_event_at TEXT DEFAULT '',
  latest_event TEXT DEFAULT '',
  latest_status TEXT DEFAULT '',
  delivered_at TEXT DEFAULT '',
  cancelled_at TEXT DEFAULT '',
  rto_at TEXT DEFAULT '',
  raw_booking_meta TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ekart_ship_status ON ekart_shipments(status);
CREATE INDEX IF NOT EXISTS idx_ekart_ship_awb ON ekart_shipments(awb);
CREATE INDEX IF NOT EXISTS idx_ekart_ship_retry ON ekart_shipments(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_ekart_ship_tracked ON ekart_shipments(last_tracked_at);
CREATE INDEX IF NOT EXISTS idx_ekart_ship_manifest ON ekart_shipments(manifest_id);

-- ---------------------------------------------------------------------------
-- 2. Immutable event timeline. dedupe_key is UNIQUE so webhook redelivery and
--    repeated polling are idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ekart_shipment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL,
  order_id TEXT DEFAULT '',
  awb TEXT DEFAULT '',
  event_code TEXT DEFAULT '',
  status TEXT DEFAULT '',
  mapped_status TEXT DEFAULT '',
  event_at TEXT DEFAULT '',
  location TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  source TEXT DEFAULT '',
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ekart_event_shipment ON ekart_shipment_events(shipment_id, event_at);
CREATE INDEX IF NOT EXISTS idx_ekart_event_awb ON ekart_shipment_events(awb, event_at);
CREATE INDEX IF NOT EXISTS idx_ekart_event_order ON ekart_shipment_events(order_id, event_at);

-- ---------------------------------------------------------------------------
-- 3. AWB pool. Ekart Elite accounts commonly receive pre-allocated AWBs.
--    A row is claimed atomically (status available -> reserved) before the
--    create-shipment call; it is never reused. If Ekart confirms that
--    merchant-generated AWBs are permitted, awb_mode=generated may be enabled.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ekart_awb_pool (
  awb TEXT PRIMARY KEY,
  payment_mode TEXT DEFAULT 'ANY',
  status TEXT DEFAULT 'available',
  reserved_order_id TEXT DEFAULT '',
  used_at TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ekart_awb_status ON ekart_awb_pool(status, payment_mode);

-- ---------------------------------------------------------------------------
-- 4. Local despatch manifests. Ekart's B2C documentation does not publish a
--    manifest API; pickup is normally a standing arrangement. These rows are
--    OUR despatch sheet, not an Ekart-confirmed manifest.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ekart_manifests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_date TEXT NOT NULL,
  manifest_code TEXT NOT NULL UNIQUE,
  shipment_count INTEGER DEFAULT 0,
  total_cod_paise INTEGER DEFAULT 0,
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 5. Small D1-backed fixed-window limiter (the admin worker has no KV binding).
--    Used for the public webhook and the internal tracking endpoint.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ekart_rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- 6. Pincode -> city/state cache. Orders store only a free-text address and a
--    pincode; Ekart's create API requires city and state. This is filled from
--    the same postalpincode/zippopotam lookup the storefront already uses.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ekart_pincode_cache (
  pincode TEXT PRIMARY KEY,
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- 7. Audit log (same shape the admin worker already uses). Kept here so a
--    fresh database can accept Ekart audit rows even before the admin worker
--    bootstraps its own schema.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT DEFAULT '',
  actor_id TEXT DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  details TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 8. Settings. INSERT OR IGNORE never overwrites an admin-saved value.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO settings (section, key, value) VALUES
  ('ekart', 'enabled', '0'),
  ('ekart', 'auto_book', '0'),
  ('ekart', 'mode', 'sandbox'),
  ('ekart', 'service_code', 'REGULAR'),
  ('ekart', 'delivery_type', 'SMALL'),
  ('ekart', 'awb_mode', 'preallocated'),
  ('ekart', 'track_payload_style', 'auto'),
  ('ekart', 'source_location_code', ''),
  ('ekart', 'source_name', 'Avnideep Ayurveda'),
  ('ekart', 'source_address1', ''),
  ('ekart', 'source_address2', ''),
  ('ekart', 'source_city', ''),
  ('ekart', 'source_state', ''),
  ('ekart', 'source_pincode', ''),
  ('ekart', 'source_phone', ''),
  ('ekart', 'source_email', 'support@avnideepayurveda.in'),
  ('ekart', 'return_same_as_source', '1'),
  ('ekart', 'return_name', ''),
  ('ekart', 'return_address1', ''),
  ('ekart', 'return_address2', ''),
  ('ekart', 'return_city', ''),
  ('ekart', 'return_state', ''),
  ('ekart', 'return_pincode', ''),
  ('ekart', 'return_phone', ''),
  ('ekart', 'default_weight_kg', '0.5'),
  ('ekart', 'default_length_cm', '20'),
  ('ekart', 'default_breadth_cm', '15'),
  ('ekart', 'default_height_cm', '5'),
  ('ekart', 'max_cod_amount', '50000'),
  ('ekart', 'blocked_pincodes', ''),
  ('ekart', 'test_awb', ''),
  ('ekart', 'tracking_cache_minutes', '15'),
  ('ekart', 'poll_batch_size', '25'),
  ('ekart', 'public_tracking_enabled', '0'),
  ('ekart', 'webhook_enabled', '0'),
  ('ekart', 'webhook_require_hmac', '0'),
  ('ekart', 'label_note', ''),
  ('ekart', 'retry_max_attempts', '6'),
  ('ekart', 'manifest_prefix', 'AVN');
