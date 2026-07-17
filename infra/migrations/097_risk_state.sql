-- Migration 097: Global risk-state serialization point.
--
-- Track B (R-1 / NEW-8): the live pipeline performed risk reads and the order
-- insert as separate pool.query calls, so two concurrent runs could both pass
-- the small-account gate and create overlapping orders. A single locked row in
-- risk_state serializes the critical section so that read-check-write sequence
-- is atomic per scope.

CREATE TABLE IF NOT EXISTS risk_state (
    scope            TEXT PRIMARY KEY,
    daily_pnl        DOUBLE PRECISION NOT NULL DEFAULT 0,
    consecutive_losses INT NOT NULL DEFAULT 0,
    total_active     INT NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the global scope. Live runners acquire this row with FOR UPDATE.
INSERT INTO risk_state (scope) VALUES ('global')
ON CONFLICT (scope) DO NOTHING;
