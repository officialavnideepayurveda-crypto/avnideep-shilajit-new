-- 0007_prepaid_default.sql — Prepaid is the storefront default.
--
-- 0006 seeded `cod` even though its comment promised Prepaid. Existing
-- databases therefore still open checkout on Full COD / Advance. Move the
-- saved default to Prepaid; all three methods stay enabled and selectable.
-- The admin can change this again at any time.

CREATE TABLE IF NOT EXISTS settings (
  section TEXT NOT NULL DEFAULT 'commission',
  key TEXT NOT NULL,
  value TEXT DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (section, key)
);

INSERT OR IGNORE INTO settings (section, key, value) VALUES
  ('payment', 'default_method', 'prepaid');

UPDATE settings
   SET value = 'prepaid',
       updated_at = CURRENT_TIMESTAMP
 WHERE section = 'payment'
   AND key = 'default_method'
   AND lower(COALESCE(value, '')) IN ('', 'cod', 'full_cod', 'advance', 'advance_cod');
