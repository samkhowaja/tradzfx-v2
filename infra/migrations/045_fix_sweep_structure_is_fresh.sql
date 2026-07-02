-- Fix sweep/structure lifecycle functions: these tables do not have an is_fresh column.

CREATE OR REPLACE FUNCTION refresh_sweep_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_max_ts TIMESTAMPTZ;
  v_table_name TEXT := 'features_sweep';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  WITH candidates AS (
    SELECT s.symbol, s.tf, s.ts, s.direction, s.level
    FROM features_sweep s
    WHERE s.symbol = p_symbol
      AND s.mitigated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
      AND s.ts > v_from_ts
    ORDER BY s.ts ASC
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
          AND c.ts <= p_as_of_ts
          AND (
            (cnd.direction = 'bullish' AND c.c > cnd.level)
            OR (cnd.direction = 'bearish' AND c.c < cnd.level)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS mit_ts
    FROM candidates cnd
  ),
  upd AS (
    UPDATE features_sweep s
    SET
      mitigated_at = COALESCE(c.mit_ts, s.mitigated_at)
    FROM candidates cnd
    LEFT JOIN computed c ON c.symbol = cnd.symbol AND c.tf = cnd.tf AND c.ts = cnd.ts
    WHERE s.symbol = cnd.symbol
      AND s.tf = cnd.tf
      AND s.ts = cnd.ts
    RETURNING s.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_structure_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_max_ts TIMESTAMPTZ;
  v_table_name TEXT := 'features_structure';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  WITH candidates AS (
    SELECT s.symbol, s.tf, s.ts, s.direction, s.level
    FROM features_structure s
    WHERE s.symbol = p_symbol
      AND s.invalidated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
      AND s.ts > v_from_ts
    ORDER BY s.ts ASC
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
          AND c.ts <= p_as_of_ts
          AND (
            (opposite_direction(cnd.direction) = 'bullish' AND c.c > cnd.level)
            OR (opposite_direction(cnd.direction) = 'bearish' AND c.c < cnd.level)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS inv_ts
    FROM candidates cnd
  ),
  upd AS (
    UPDATE features_structure s
    SET
      invalidated_at = COALESCE(c.inv_ts, s.invalidated_at)
    FROM candidates cnd
    LEFT JOIN computed c ON c.symbol = cnd.symbol AND c.tf = cnd.tf AND c.ts = cnd.ts
    WHERE s.symbol = cnd.symbol
      AND s.tf = cnd.tf
      AND s.ts = cnd.ts
    RETURNING s.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
