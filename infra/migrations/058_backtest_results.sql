-- Migration 047: Analyzer backtest results for continuous grade calibration.
-- Stores simulated setup evaluations and their forward outcomes so the grade
-- calibration UI can show stats even when live trade history is thin.

CREATE TABLE IF NOT EXISTS backtest_results (
    id            BIGSERIAL PRIMARY KEY,
    run_id        TEXT NOT NULL,
    symbol        TEXT NOT NULL,
    tf            TEXT NOT NULL,
    ts            TIMESTAMPTZ NOT NULL,
    grade         TEXT NOT NULL,
    direction     TEXT NOT NULL,
    confidence    DOUBLE PRECISION NOT NULL DEFAULT 0,
    entry_zone    JSONB,
    stop_loss     DOUBLE PRECISION,
    take_profit   DOUBLE PRECISION,
    risk_reward   DOUBLE PRECISION,
    outcome       TEXT,
    outcome_r     DOUBLE PRECISION,
    exit_price    DOUBLE PRECISION,
    exit_ts       TIMESTAMPTZ,
    bars_held     INT,
    htf_state     TEXT,
    session_name  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_results_run_id
    ON backtest_results(run_id);

CREATE INDEX IF NOT EXISTS idx_backtest_results_symbol_tf
    ON backtest_results(symbol, tf, ts DESC);

CREATE INDEX IF NOT EXISTS idx_backtest_results_grade
    ON backtest_results(grade, outcome);

CREATE TABLE IF NOT EXISTS backtest_runs (
    id            TEXT PRIMARY KEY,
    symbol        TEXT,
    tf            TEXT,
    start_ts      TIMESTAMPTZ NOT NULL,
    end_ts        TIMESTAMPTZ NOT NULL,
    sample_count  INT NOT NULL DEFAULT 0,
    generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
