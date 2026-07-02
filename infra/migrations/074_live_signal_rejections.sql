-- Signal-level rejection log so the dashboard can show why a setup never became an order.
-- This captures gate failures, duplicate/cooldown rejections, and stale-signal drops
-- independently of the orders table.

CREATE TABLE IF NOT EXISTS live_signal_rejection (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    deployment_id   TEXT,
    symbol          TEXT NOT NULL,
    strategy_id     TEXT NOT NULL,
    side            TEXT,
    ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason          TEXT NOT NULL,
    signal_fingerprint TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_signal_rejection_created
    ON live_signal_rejection(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_signal_rejection_symbol
    ON live_signal_rejection(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_signal_rejection_strategy
    ON live_signal_rejection(strategy_id, created_at DESC);
