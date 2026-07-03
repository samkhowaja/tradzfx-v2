-- Migration 079: Live-trading correctness improvements.
-- 1. Tag each liquidity sweep as post-structure or inducement so specs can
--    distinguish the two canonical ICT sequences.
-- 2. Add an idempotency table for EA fill/close events to prevent duplicate
--    processing under retry storms.

ALTER TABLE features_sweep
    ADD COLUMN IF NOT EXISTS sweep_type TEXT NOT NULL DEFAULT 'post_structure';

CREATE TABLE IF NOT EXISTS processed_ea_events (
    idempotency_key TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_ea_events_order_id
    ON processed_ea_events(order_id);
