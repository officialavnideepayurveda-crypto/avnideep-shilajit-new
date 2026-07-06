-- Migration 0004: Add purchase_capi_sent column for CAPI idempotency
-- Ensures Purchase CAPI is sent exactly once per order_id
-- Atomic UPDATE with WHERE clause prevents race conditions

ALTER TABLE orders ADD COLUMN purchase_capi_sent INTEGER NOT NULL DEFAULT 0;
