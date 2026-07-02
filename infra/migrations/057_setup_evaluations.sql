-- Migration 046: Setup evaluation snapshots for grade calibration.
-- Records each setup evaluation that matured into a trade so we can compute
-- historical win rate / expectancy per grade.

CREATE TABLE IF NOT EXISTS setup_evaluations (
    id          BIGSERIAL PRIMARY KEY,
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    grade       TEXT NOT NULL,
    direction   TEXT NOT NULL,
    confidence  DOUBLE PRECISION NOT NULL DEFAULT 0,
    entry_zone  JSONB,
    stop_loss   DOUBLE PRECISION,
    take_profit DOUBLE PRECISION,
    risk_reward DOUBLE PRECISION,
    evidence    JSONB,
    warnings    TEXT[],
    block_reasons TEXT[],
    order_id    TEXT,
    outcome     TEXT,
    outcome_r   DOUBLE PRECISION,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_setup_evaluations_symbol_tf
    ON setup_evaluations(symbol, tf, ts DESC);

CREATE INDEX IF NOT EXISTS idx_setup_evaluations_grade
    ON setup_evaluations(grade, outcome);
