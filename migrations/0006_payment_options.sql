-- 0006_payment_options.sql — three payment options end-to-end.
--
-- Adds the columns needed to keep COD, booking-advance and prepaid orders
-- distinct, and seeds the admin payment settings ONLY when they are absent
-- (INSERT OR IGNORE never overwrites what the admin panel has saved).
--
-- All statements are additive and safe on existing databases.

-- ---------------------------------------------------------------------------
-- 1. Order payment state (paise columns are the authoritative arithmetic;
--    the rupee columns remain for backwards compatibility with the admin).
-- ---------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN advance_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN cod_due REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN online_due_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN online_paid_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN amount_paise INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN online_due_paise INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN online_paid_paise INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN cod_due_paise INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN pricing_snapshot TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN config_snapshot TEXT DEFAULT '';

-- Existing COD orders stay exactly as they are. Their payment status is
-- normalised only when it is blank so the admin can distinguish them.
UPDATE orders
   SET payment_status = 'pending_collection'
 WHERE (payment_method IS NULL OR payment_method = '' OR payment_method = 'cod')
   AND (payment_status IS NULL OR payment_status = '');

-- ---------------------------------------------------------------------------
-- 2. Admin payment settings (single source of truth for the storefront).
--    All three options are enabled; the default is Prepaid (lowest price).
--    The admin panel may change any of these; this seed only fills gaps.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  section TEXT NOT NULL DEFAULT 'commission',
  key TEXT NOT NULL,
  value TEXT DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (section, key)
);

INSERT OR IGNORE INTO settings (section, key, value) VALUES
  ('payment', 'cod_enabled', '1'),
  ('payment', 'advance_enabled', '1'),
  ('payment', 'prepaid_enabled', '1'),
  ('payment', 'advance_amount', '100'),
  ('payment', 'default_method', 'prepaid');

-- ---------------------------------------------------------------------------
-- 3. Configured per-product price triples. Only zero/blank values are filled;
--    an admin-configured price is never overwritten.
--    Ensure the table exists first: on a database provisioned only by the
--    migration chain (products.js also bootstraps it at runtime) the UPDATEs
--    below would otherwise abort the migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT DEFAULT '',
  price_prepaid INTEGER DEFAULT 0,
  price_cod INTEGER DEFAULT 0,
  price_advance INTEGER DEFAULT 0,
  mrp INTEGER DEFAULT 0,
  in_stock INTEGER DEFAULT 1,
  stock_qty INTEGER DEFAULT 100,
  image_url TEXT DEFAULT '',
  badge TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

UPDATE products SET price_cod = 1250, mrp = 1250
 WHERE id = 'shilajit' AND (price_cod IS NULL OR price_cod = 0);
UPDATE products SET price_advance = 1200
 WHERE id = 'shilajit' AND (price_advance IS NULL OR price_advance = 0);
UPDATE products SET price_prepaid = 1000
 WHERE id = 'shilajit' AND (price_prepaid IS NULL OR price_prepaid = 0);

UPDATE products SET price_cod = 349, mrp = 349
 WHERE id = 'oil' AND (price_cod IS NULL OR price_cod = 0);
UPDATE products SET price_advance = 320
 WHERE id = 'oil' AND (price_advance IS NULL OR price_advance = 0);
UPDATE products SET price_prepaid = 299
 WHERE id = 'oil' AND (price_prepaid IS NULL OR price_prepaid = 0);

-- Keep the base shilajit MRP consistent with its single-pack selling price.
UPDATE products SET mrp = 1250
 WHERE id = 'shilajit' AND (mrp IS NULL OR mrp = 0 OR mrp > 1250);

CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order ON orders(razorpay_order_id);
