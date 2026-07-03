-- 090_consolidate_moving_average.sql
-- Consolidate EMA/SMA cross features into features_moving_average.
-- Cross rows are stored alongside per-period MA rows using the new
-- fast_period / slow_period / direction / fast_value / slow_value columns.

BEGIN;

-- Add cross-specific columns to the unified moving-average table.
ALTER TABLE features_moving_average
    ADD COLUMN IF NOT EXISTS fast_period INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS slow_period INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS direction TEXT,
    ADD COLUMN IF NOT EXISTS fast_value DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS slow_value DOUBLE PRECISION;

-- The old primary key (symbol, tf, ts, ma_type, period) cannot distinguish
-- cross rows (which share ma_type/period sentinels). Replace it with a key
-- that includes fast_period and slow_period.
ALTER TABLE features_moving_average
    DROP CONSTRAINT IF EXISTS features_moving_average_pkey;

ALTER TABLE features_moving_average
    ADD PRIMARY KEY (symbol, tf, ts, ma_type, period, fast_period, slow_period);

-- Index for cross lookups.
CREATE INDEX IF NOT EXISTS idx_features_moving_average_cross_lookup
    ON features_moving_average (symbol, tf, ts DESC, ma_type, fast_period, slow_period);

-- Migrate any existing EMA/SMA cross rows into the unified table.
INSERT INTO features_moving_average
    (symbol, tf, ts, ma_type, period, value, fast_period, slow_period, direction, fast_value, slow_value, engine_ver, input_hash)
SELECT symbol, tf, ts, 'ema_cross', 0, 0, fast_period, slow_period, direction, fast_value, slow_value, engine_ver, input_hash
FROM features_ema_cross
ON CONFLICT (symbol, tf, ts, ma_type, period, fast_period, slow_period) DO NOTHING;

INSERT INTO features_moving_average
    (symbol, tf, ts, ma_type, period, value, fast_period, slow_period, direction, fast_value, slow_value, engine_ver, input_hash)
SELECT symbol, tf, ts, 'sma_cross', 0, 0, fast_period, slow_period, direction, fast_value, slow_value, engine_ver, input_hash
FROM features_sma_cross
ON CONFLICT (symbol, tf, ts, ma_type, period, fast_period, slow_period) DO NOTHING;

-- Drop the old standalone cross tables.
DROP TABLE IF EXISTS features_ema_cross;
DROP TABLE IF EXISTS features_sma_cross;

COMMIT;
