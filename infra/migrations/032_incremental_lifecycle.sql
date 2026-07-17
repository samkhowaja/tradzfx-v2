-- Incremental lifecycle refresh.
--
-- The feature engine computes lifecycle columns (mitigated_at, invalidated_at,
-- is_fresh) once, using only the 500-bar window it ran on. Rows are inserted with
-- ON CONFLICT DO NOTHING, so they are never updated afterward. This migration
-- adds batched refresh functions that join open rows against candles_1m and set
-- the lifecycle timestamps incrementally as new candles arrive.
--
-- A small state table tracks the last candle timestamp that was processed per
-- symbol, so each refresh only scans candles since the previous run instead of
-- re-scanning the full lookback window every time.
--
-- Only the most recent p_limit open rows within p_lookback_interval are processed
-- per call. This keeps the refresh fast enough to run after every feature-engine
-- pass. Run the backfill script repeatedly (or with a higher limit) to catch up
-- on historical rows.
--
-- The PIT functions from 026_pit_freshness.sql remain available as a fallback for
-- backtests or edge cases.

-- Track how far each symbol has been processed.
CREATE TABLE IF NOT EXISTS lifecycle_refresh_state (
  symbol TEXT PRIMARY KEY,
  last_processed_ts TIMESTAMPTZ NOT NULL DEFAULT '2000-01-01'::timestamptz
);

-- Helper: opposite direction for invalidation/cross checks.
CREATE OR REPLACE FUNCTION opposite_direction(p_direction TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE
    WHEN p_direction = 'bullish' THEN 'bearish'
    WHEN p_direction = 'bearish' THEN 'bullish'
    ELSE p_direction
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Refresh features_zone lifecycle for one symbol using set-based joins.
CREATE OR REPLACE FUNCTION refresh_zone_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH candidates AS (
    SELECT z.symbol, z.tf, z.ts, z.top, z.bottom, z.zone_kind, z.direction
    FROM features_zone z
    WHERE z.symbol = p_symbol
      AND z.mitigated_at IS NULL
      AND z.invalidated_at IS NULL
      AND z.ts >= p_as_of_ts - p_lookback_interval
      AND z.ts <= p_as_of_ts
    ORDER BY z.ts DESC
    LIMIT p_limit
  ),
  -- Compute fill ratio for 50% threshold check
  zone_fill AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts,
           (LEAST(c.h, cnd.top) - GREATEST(c.l, cnd.bottom)) /
           GREATEST(cnd.top - cnd.bottom, 0.0001) AS fill_ratio,
           c.ts AS candle_ts
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts > v_from_ts
      AND c.ts <= p_as_of_ts
      AND c.h >= cnd.bottom
      AND c.l <= cnd.top
  ),
  mitigations AS (
    SELECT symbol, tf, ts, MIN(candle_ts) AS mit_ts
    FROM zone_fill
    WHERE fill_ratio > 0.5
    GROUP BY symbol, tf, ts
  ),
  invalidations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, MIN(c.ts) AS inv_ts
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts > v_from_ts
      AND c.ts <= p_as_of_ts
      AND (
        (
          CASE
            WHEN cnd.zone_kind = 'demand' THEN 'bullish'
            WHEN cnd.zone_kind = 'supply' THEN 'bearish'
            ELSE COALESCE(cnd.direction, 'bullish')
          END = 'bullish'
          AND c.c < cnd.bottom
        )
        OR
        (
          CASE
            WHEN cnd.zone_kind = 'demand' THEN 'bullish'
            WHEN cnd.zone_kind = 'supply' THEN 'bearish'
            ELSE COALESCE(cnd.direction, 'bullish')
          END = 'bearish'
          AND c.c > cnd.top
        )
      )
    GROUP BY cnd.symbol, cnd.tf, cnd.ts
  ),
  computed AS (
    SELECT
      COALESCE(m.symbol, i.symbol) AS symbol,
      COALESCE(m.tf, i.tf) AS tf,
      COALESCE(m.ts, i.ts) AS ts,
      CASE
        WHEN i.inv_ts IS NOT NULL AND (m.mit_ts IS NULL OR i.inv_ts < m.mit_ts) THEN NULL
        ELSE m.mit_ts
      END AS mitigated_at,
      i.inv_ts AS invalidated_at
    FROM mitigations m
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
  )
  UPDATE features_zone z
  SET
    mitigated_at = c.mitigated_at,
    invalidated_at = c.invalidated_at,
    is_fresh = false,
    tapped = CASE WHEN c.mitigated_at IS NOT NULL THEN true ELSE z.tapped END
  FROM computed c
  WHERE z.symbol = c.symbol
    AND z.tf = c.tf
    AND z.ts = c.ts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh features_order_block lifecycle for one symbol.
CREATE OR REPLACE FUNCTION refresh_order_block_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH candidates AS (
    SELECT ob.symbol, ob.tf, ob.ts, ob.top, ob.bottom, ob.ob_kind
    FROM features_order_block ob
    WHERE ob.symbol = p_symbol
      AND ob.mitigated_at IS NULL
      AND ob.invalidated_at IS NULL
      AND ob.ts >= p_as_of_ts - p_lookback_interval
      AND ob.ts <= p_as_of_ts
    ORDER BY ob.ts DESC
    LIMIT p_limit
  ),
  mitigations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, MIN(c.ts) AS mit_ts
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts > v_from_ts
      AND c.ts <= p_as_of_ts
      AND c.h >= cnd.bottom
      AND c.l <= cnd.top
    GROUP BY cnd.symbol, cnd.tf, cnd.ts
  ),
  invalidations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, MIN(c.ts) AS inv_ts
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts > v_from_ts
      AND c.ts <= p_as_of_ts
      AND (
        (cnd.ob_kind = 'bullish' AND c.c < cnd.bottom)
        OR (cnd.ob_kind = 'bearish' AND c.c > cnd.top)
      )
    GROUP BY cnd.symbol, cnd.tf, cnd.ts
  ),
  computed AS (
    SELECT
      COALESCE(m.symbol, i.symbol) AS symbol,
      COALESCE(m.tf, i.tf) AS tf,
      COALESCE(m.ts, i.ts) AS ts,
      CASE
        WHEN i.inv_ts IS NOT NULL AND (m.mit_ts IS NULL OR i.inv_ts < m.mit_ts) THEN NULL
        ELSE m.mit_ts
      END AS mitigated_at,
      i.inv_ts AS invalidated_at
    FROM mitigations m
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
  )
  UPDATE features_order_block ob
  SET
    mitigated_at = c.mitigated_at,
    invalidated_at = c.invalidated_at,
    is_fresh = false
  FROM computed c
  WHERE ob.symbol = c.symbol
    AND ob.tf = c.tf
    AND ob.ts = c.ts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh features_ifvg lifecycle for one symbol.
-- iFVG semantics: mitigation = close beyond in iFVG direction (it fails as S/R);
-- invalidation = close beyond the far side (it holds and is confirmed).
CREATE OR REPLACE FUNCTION refresh_ifvg_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH candidates AS (
    SELECT f.symbol, f.tf, f.ts, f.top, f.bottom, f.direction
    FROM features_ifvg f
    WHERE f.symbol = p_symbol
      AND f.mitigated_at IS NULL
      AND f.invalidated_at IS NULL
      AND f.ts >= p_as_of_ts - p_lookback_interval
      AND f.ts <= p_as_of_ts
    ORDER BY f.ts DESC
    LIMIT p_limit
  ),
  mitigations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, MIN(c.ts) AS mit_ts
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts > v_from_ts
      AND c.ts <= p_as_of_ts
      AND (
        (cnd.direction = 'bullish' AND c.c < cnd.bottom)
        OR (cnd.direction = 'bearish' AND c.c > cnd.top)
      )
    GROUP BY cnd.symbol, cnd.tf, cnd.ts
  ),
  invalidations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, MIN(c.ts) AS inv_ts
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts > v_from_ts
      AND c.ts <= p_as_of_ts
      AND (
        (opposite_direction(cnd.direction) = 'bullish' AND c.c < cnd.bottom)
        OR (opposite_direction(cnd.direction) = 'bearish' AND c.c > cnd.top)
      )
    GROUP BY cnd.symbol, cnd.tf, cnd.ts
  ),
  computed AS (
    SELECT
      COALESCE(m.symbol, i.symbol) AS symbol,
      COALESCE(m.tf, i.tf) AS tf,
      COALESCE(m.ts, i.ts) AS ts,
      CASE
        WHEN i.inv_ts IS NOT NULL AND (m.mit_ts IS NULL OR i.inv_ts < m.mit_ts) THEN NULL
        ELSE m.mit_ts
      END AS mitigated_at,
      i.inv_ts AS invalidated_at
    FROM mitigations m
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
  )
  UPDATE features_ifvg f
  SET
    mitigated_at = c.mitigated_at,
    invalidated_at = c.invalidated_at,
    is_fresh = false
  FROM computed c
  WHERE f.symbol = c.symbol
    AND f.tf = c.tf
    AND f.ts = c.ts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh features_sweep lifecycle for one symbol.
-- Sweep mitigation = price later closes beyond the swept level in the sweep direction.
CREATE OR REPLACE FUNCTION refresh_sweep_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH computed AS (
    SELECT s.symbol, s.tf, s.ts, MIN(c.ts) AS mit_ts
    FROM features_sweep s
    JOIN candles_1m c ON c.symbol = s.symbol
      AND c.ts > s.ts
      AND c.ts > v_from_ts
      AND c.ts <= p_as_of_ts
      AND (
        (s.direction = 'bullish' AND c.c > s.level)
        OR (s.direction = 'bearish' AND c.c < s.level)
      )
    WHERE s.symbol = p_symbol
      AND s.mitigated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
    GROUP BY s.symbol, s.tf, s.ts
    LIMIT p_limit
  )
  UPDATE features_sweep s
  SET mitigated_at = c.mit_ts
  FROM computed c
  WHERE s.symbol = c.symbol
    AND s.tf = c.tf
    AND s.ts = c.ts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh features_structure lifecycle for one symbol.
-- Structure invalidation = price closes beyond the broken level in the opposite direction.
CREATE OR REPLACE FUNCTION refresh_structure_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH computed AS (
    SELECT s.symbol, s.tf, s.ts, MIN(c.ts) AS inv_ts
    FROM features_structure s
    JOIN candles_1m c ON c.symbol = s.symbol
      AND c.ts > s.ts
      AND c.ts > v_from_ts
      AND c.ts <= p_as_of_ts
      AND (
        (opposite_direction(s.direction) = 'bullish' AND c.c > s.level)
        OR (opposite_direction(s.direction) = 'bearish' AND c.c < s.level)
      )
    WHERE s.symbol = p_symbol
      AND s.invalidated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
    GROUP BY s.symbol, s.tf, s.ts
    LIMIT p_limit
  )
  UPDATE features_structure s
  SET invalidated_at = c.inv_ts
  FROM computed c
  WHERE s.symbol = c.symbol
    AND s.tf = c.tf
    AND s.ts = c.ts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh all lifecycle tables for one symbol and advance the checkpoint.
CREATE OR REPLACE FUNCTION refresh_lifecycle_for_symbol(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS TABLE (
  table_name TEXT,
  rows_updated INT
) AS $$
DECLARE
  v_zone INT;
  v_ob INT;
  v_ifvg INT;
  v_sweep INT;
  v_structure INT;
BEGIN
  v_zone := refresh_zone_lifecycle(p_symbol, p_as_of_ts, p_lookback_interval, p_limit);
  v_ob := refresh_order_block_lifecycle(p_symbol, p_as_of_ts, p_lookback_interval, p_limit);
  v_ifvg := refresh_ifvg_lifecycle(p_symbol, p_as_of_ts, p_lookback_interval, p_limit);
  v_sweep := refresh_sweep_lifecycle(p_symbol, p_as_of_ts, p_lookback_interval, p_limit);
  v_structure := refresh_structure_lifecycle(p_symbol, p_as_of_ts, p_lookback_interval, p_limit);

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol;

  RETURN QUERY
  SELECT 'features_zone'::TEXT, v_zone
  UNION ALL SELECT 'features_order_block'::TEXT, v_ob
  UNION ALL SELECT 'features_ifvg'::TEXT, v_ifvg
  UNION ALL SELECT 'features_sweep'::TEXT, v_sweep
  UNION ALL SELECT 'features_structure'::TEXT, v_structure;
END;
$$ LANGUAGE plpgsql;
