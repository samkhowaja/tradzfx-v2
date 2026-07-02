-- Migration 061: Extend calibration_tuning with threshold/win-rate fields used by the live evaluator.

ALTER TABLE calibration_tuning
    ADD COLUMN IF NOT EXISTS threshold_delta DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS win_rate        DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS expectancy      DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS min_trades      INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS applied_at      TIMESTAMPTZ;

-- The live evaluator expects a `tuned_at` column. Rename the older `generated_at` column if present.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'calibration_tuning' AND column_name = 'generated_at'
    ) THEN
        ALTER TABLE calibration_tuning RENAME COLUMN generated_at TO tuned_at;
    END IF;
END $$;

-- Ensure tuned_at exists with a sensible default for future rows.
ALTER TABLE calibration_tuning
    ADD COLUMN IF NOT EXISTS tuned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON TABLE calibration_tuning IS 'Per-symbol/timeframe/grade calibration overrides used by evaluateSetup.';
