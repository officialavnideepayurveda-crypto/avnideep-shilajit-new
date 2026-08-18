-- ============================================================
-- PRODUCTION QUERY INDEXES (audit-driven) — additive only
-- analytics_events has NO indexes and grows with ad traffic
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type, created_at);

-- Webhook + save-order reconcile orders by razorpay ids
CREATE INDEX IF NOT EXISTS idx_orders_rzr_order ON orders(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_rzr_payment ON orders(razorpay_payment_id);
