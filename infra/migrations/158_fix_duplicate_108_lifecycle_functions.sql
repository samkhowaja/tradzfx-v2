-- Migration 158: Fix duplicate-108 overwrite — re-create real lifecycle functions
--
-- Problem: Two files numbered 108 exist. `108_add_missing_feature_lifecycle.sql`
-- (real functions with ALTER TABLE + candle scans) is applied first; then
-- `108_missing_feature_lifecycle.sql` (RETURN-0 no-op versions) is applied
-- second and overwrites all six functions. Every call returns 0, the cursor
-- never advances, and lifecycle_refresh_state stays stuck.
--
-- Fix: Re-create all six functions with real implementations. Also reset the
-- lifecycle_refresh_state checkpoint so the next refresh cycle re-scans.

BEGIN;

-- ============================================================
-- features_atr lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_atr_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_atr';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  -- ATR is a dense state feature per bar. No mitigation/invalidation to scan;
  -- just advance the checkpoint to mark freshness up to p_as_of_ts.
  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_spread lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_spread_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_spread';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_zone_retest lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_zone_retest_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_zone_retest';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  -- Zone retest is an event feature. Scan open (non-mitigated, non-invalidated)
  -- retest events within the lookback window for candle intersections.
  WITH candidates AS (
    SELECT zr.symbol, zr.tf, zr.ts, zr.top, zr.bottom, zr.zone_kind, zr.direction
    FROM features_zone_retest zr
    WHERE zr.symbol = p_symbol
      AND zr.mitigated_at IS NULL
      AND zr.invalidated_at IS NULL
      AND zr.ts >= p_as_of_ts - p_lookback_interval
      AND zr.ts <= p_as_of_ts
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
        FROM market.candles_1m_canonical c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts <= p_as_of_ts
          AND c.h >= cnd.bottom
          AND c.l <= cnd.top
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS mit_ts,
      (
        SELECT c.ts
        FROM market.candles_1m_canonical c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts <= p_as_of_ts
          AND (
            (cnd.direction = 'bullish' AND c.c < cnd.bottom)
            OR (cnd.direction = 'bearish' AND c.c > cnd.top)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS inv_ts
    FROM candidates cnd
  ),
  upd AS (
    UPDATE features_zone_retest zr
    SET
      mitigated_at = COALESCE(zr.mitigated_at, c.mit_ts),
      invalidated_at = COALESCE(zr.invalidated_at, c.inv_ts)
    FROM computed c
    WHERE zr.symbol = c.symbol
      AND zr.tf = c.tf
      AND zr.ts = c.ts
      AND (c.mit_ts IS NOT NULL OR c.inv_ts IS NOT NULL)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_candle_pattern lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_candle_pattern_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_candle_pattern';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_pricing lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_pricing_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_pricing';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_displacement lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_displacement_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_displacement';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Reset lifecycle_refresh_state for all 6 tables so the next refresh cycle
-- re-scans them (DELETE is safe — refresh-lifecycle.js also deletes per-symbol
-- on every cycle). The ALTER TABLE / ADD COLUMN / CREATE INDEX statements from
-- the first 108 are idempotent and already applied — no need to repeat them.
DELETE FROM lifecycle_refresh_state
WHERE table_name IN (
  'features_atr',
  'features_spread',
  'features_zone_retest',
  'features_candle_pattern',
  'features_pricing',
  'features_displacement'
);

COMMIT;
