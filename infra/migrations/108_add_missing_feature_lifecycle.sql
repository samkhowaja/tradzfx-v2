-- Migration 108: Add lifecycle refresh functions for missing feature producers
-- P1: Add refresh functions for features_atr, features_spread, features_zone_retest,
-- features_candle_pattern, features_pricing, features_displacement

BEGIN;

-- features_atr lifecycle
-- ATR is a state feature (dense, per-bar). It doesn't have mitigation/invalidation
-- in the traditional sense, but we track freshness via a computed column or
-- by ensuring the latest row is recent. For now, we just ensure the table
-- has the standard lifecycle columns and a refresh function that updates
-- a 'last_computed' watermark.

ALTER TABLE features_atr
  ADD COLUMN IF NOT EXISTS last_computed TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_features_atr_lifecycle
  ON features_atr(symbol, tf, last_computed);

CREATE OR REPLACE FUNCTION refresh_atr_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_table_name TEXT := 'features_atr';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  -- ATR doesn't have traditional lifecycle; we just update the watermark
  -- to mark that we've verified freshness up to p_as_of_ts
  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$ LANGUAGE plpgsql;

-- features_spread lifecycle
-- Spread is a state feature (dense, per-bar). Similar to ATR.

ALTER TABLE features_spread
  ADD COLUMN IF NOT EXISTS last_computed TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_features_spread_lifecycle
  ON features_spread(symbol, tf, last_computed);

CREATE OR REPLACE FUNCTION refresh_spread_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_table_name TEXT := 'features_spread';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$ LANGUAGE plpgsql;

-- features_zone_retest lifecycle
-- Zone retest is an event feature. It has a ts (retest time) and can be
-- considered "fresh" for a limited window after the retest.

ALTER TABLE features_zone_retest
  ADD COLUMN IF NOT EXISTS mitigated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_features_zone_retest_lifecycle
  ON features_zone_retest(symbol, tf, mitigated_at, invalidated_at);

CREATE OR REPLACE FUNCTION refresh_zone_retest_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_table_name TEXT := 'features_zone_retest';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  WITH candidates AS (
    SELECT zr.symbol, zr.tf, zr.ts, zr.top, zr.bottom, zr.zone_kind, zr.direction
    FROM features_zone_retest zr
    WHERE zr.symbol = p_symbol
      AND zr.mitigated_at IS NULL
      AND zr.invalidated_at IS NULL
      AND zr.ts >= p_as_of_ts - p_lookback_interval
      AND zr.ts <= p_as_of_ts
      AND zr.ts > v_from_ts
    ORDER BY zr.ts DESC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND c.h >= cnd.bottom
          AND c.l <= cnd.top
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS mit_ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND (
            (cnd.direction = 'bullish' AND c.c < cnd.bottom)
            OR (cnd.direction = 'bearish' AND c.c > cnd.top)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS inv_ts
    FROM candidates cnd
  )
  UPDATE features_zone_retest zr
  SET mitigated_at = COALESCE(zr.mitigated_at, c.mit_ts),
      invalidated_at = COALESCE(zr.invalidated_at, c.inv_ts)
  FROM computed c
  WHERE zr.symbol = c.symbol
    AND zr.tf = c.tf
    AND zr.ts = c.ts
    AND (c.mit_ts IS NOT NULL OR c.inv_ts IS NOT NULL);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END $$ LANGUAGE plpgsql;

-- features_candle_pattern lifecycle
-- Candle patterns are events. They don't have traditional mitigation/invalidation
-- but we track freshness.

ALTER TABLE features_candle_pattern
  ADD COLUMN IF NOT EXISTS last_computed TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_features_candle_pattern_lifecycle
  ON features_candle_pattern(symbol, tf, last_computed);

CREATE OR REPLACE FUNCTION refresh_candle_pattern_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_table_name TEXT := 'features_candle_pattern';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$ LANGUAGE plpgsql;

-- features_pricing lifecycle
-- Pricing is a state feature (premium/discount/equilibrium per bar).

ALTER TABLE features_pricing
  ADD COLUMN IF NOT EXISTS last_computed TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_features_pricing_lifecycle
  ON features_pricing(symbol, tf, last_computed);

CREATE OR REPLACE FUNCTION refresh_pricing_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_table_name TEXT := 'features_pricing';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$ LANGUAGE plpgsql;

-- features_displacement lifecycle
-- Displacement is an event feature (strong impulsive moves).

ALTER TABLE features_displacement
  ADD COLUMN IF NOT EXISTS last_computed TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_features_displacement_lifecycle
  ON features_displacement(symbol, tf, last_computed);

CREATE OR REPLACE FUNCTION refresh_displacement_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_table_name TEXT := 'features_displacement';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$ LANGUAGE plpgsql;

COMMIT;