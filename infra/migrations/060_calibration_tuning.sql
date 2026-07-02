-- Migration 060: Stores calibration-derived tuning recommendations.
-- Populated by packages/analyzerBacktest/scripts/tuneFromCalibration.ts.

CREATE TABLE IF NOT EXISTS calibration_tuning (
    symbol         TEXT NOT NULL,
    tf             TEXT NOT NULL,
    grade          TEXT NOT NULL,
    avg_r          DOUBLE PRECISION NOT NULL DEFAULT 0,
    sample_count   INT NOT NULL DEFAULT 0,
    recommendation TEXT,
    weight_delta   DOUBLE PRECISION NOT NULL DEFAULT 0,
    generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (symbol, tf, grade)
);

CREATE INDEX IF NOT EXISTS idx_calibration_tuning_symbol_tf
    ON calibration_tuning(symbol, tf);
