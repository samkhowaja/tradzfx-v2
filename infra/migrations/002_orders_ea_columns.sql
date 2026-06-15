-- Migration 002: Add EA-facing columns to orders table
-- Needed for MT5 execution bridge compatibility

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS lot_size DOUBLE PRECISION DEFAULT 0.01,
    ADD COLUMN IF NOT EXISTS risk_reward DOUBLE PRECISION DEFAULT 3.0,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS entry_zone_pips DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS trade_mode TEXT NOT NULL DEFAULT 'paper',
    ADD COLUMN IF NOT EXISTS reject_reason TEXT,
    ADD COLUMN IF NOT EXISTS terminal_key_id TEXT,
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS acked_at TIMESTAMPTZ;

-- Index for fast pending order queries
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_symbol_status ON orders(symbol, status);
