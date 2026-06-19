-- Fix sweep/structure lifecycle refresh functions.
--
-- features_sweep and features_structure do not have an is_fresh column, so the
-- previous optimization migration incorrectly tried to set it. This migration
-- recreates those two functions without touching is_fresh.

-- Refresh features_sweep lifecycle using early-exit index lookups.
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

  WITH candidates AS (
    SELECT s.symbol, s.tf, s.ts, s.direction, s.level
    FROM features_sweep s
    WHERE s.symbol = p_symbol
      AND s.mitigated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
    ORDER BY s.ts DESC
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
          AND (
            (cnd.direction = 'bullish' AND c.c > cnd.level)
            OR (cnd.direction = 'bearish' AND c.c < cnd.level)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS mit_ts
    FROM candidates cnd
  )
  UPDATE features_sweep s
  SET mitigated_at = c.mit_ts
  FROM computed c
  WHERE s.symbol = c.symbol
    AND s.tf = c.tf
    AND s.ts = c.ts
    AND c.mit_ts IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh features_structure lifecycle using early-exit index lookups.
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

  WITH candidates AS (
    SELECT s.symbol, s.tf, s.ts, s.direction, s.level
    FROM features_structure s
    WHERE s.symbol = p_symbol
      AND s.invalidated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
    ORDER BY s.ts DESC
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
          AND (
            (opposite_direction(cnd.direction) = 'bullish' AND c.c > cnd.level)
            OR (opposite_direction(cnd.direction) = 'bearish' AND c.c < cnd.level)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS inv_ts
    FROM candidates cnd
  )
  UPDATE features_structure s
  SET invalidated_at = c.inv_ts
  FROM computed c
  WHERE s.symbol = c.symbol
    AND s.tf = c.tf
    AND s.ts = c.ts
    AND c.inv_ts IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
