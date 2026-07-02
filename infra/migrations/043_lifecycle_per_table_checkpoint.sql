-- Lifecycle v2 checkpoint fix: per-table incremental state so batched backfills
-- drain instead of looping forever on the same open rows.

-- 1. Convert lifecycle_refresh_state to a per-table checkpoint.
ALTER TABLE lifecycle_refresh_state
  ADD COLUMN IF NOT EXISTS table_name TEXT NOT NULL DEFAULT 'unknown';

DELETE FROM lifecycle_refresh_state WHERE table_name = 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'lifecycle_refresh_state'::regclass
      AND conname = 'lifecycle_refresh_state_pkey'
  ) THEN
    ALTER TABLE lifecycle_refresh_state
      DROP CONSTRAINT IF EXISTS lifecycle_refresh_state_pkey;
    ALTER TABLE lifecycle_refresh_state
      ADD PRIMARY KEY (symbol, table_name);
  END IF;
END $$;

ALTER TABLE lifecycle_refresh_state
  ALTER COLUMN table_name DROP DEFAULT;

-- 2. Refresh features_zone lifecycle with a per-table checkpoint and
--    guaranteed progress (all candidates are touched, so the checkpoint advances).
CREATE OR REPLACE FUNCTION refresh_zone_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_max_ts TIMESTAMPTZ;
  v_table_name TEXT := 'features_zone';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  WITH candidates AS (
    SELECT z.symbol, z.tf, z.ts, z.top, z.bottom, z.zone_kind, z.direction
    FROM features_zone z
    WHERE z.symbol = p_symbol
      AND z.invalidated_at IS NULL
      AND z.ts >= p_as_of_ts - p_lookback_interval
      AND z.ts <= p_as_of_ts
      AND z.ts > v_from_ts
    ORDER BY z.ts ASC
    LIMIT p_limit
  ),
  first_touches AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts,
      MIN(c.ts) AS first_touch_ts,
      CASE
        WHEN cnd.zone_kind = 'demand' OR
          (cnd.zone_kind NOT IN ('demand','supply') AND COALESCE(cnd.direction,'bullish') = 'bullish')
          THEN LEAST(1, GREATEST(0, MAX((cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0))))
        ELSE LEAST(1, GREATEST(0, MAX((LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0))))
      END AS fill_pct
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts <= p_as_of_ts
      AND c.h >= cnd.bottom
      AND c.l <= cnd.top
    GROUP BY cnd.symbol, cnd.tf, cnd.ts, cnd.top, cnd.bottom, cnd.zone_kind, cnd.direction
  ),
  invalidations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, MIN(c.ts) AS inv_ts
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
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
      COALESCE(ft.symbol, i.symbol) AS symbol,
      COALESCE(ft.tf, i.tf) AS tf,
      COALESCE(ft.ts, i.ts) AS ts,
      ft.first_touch_ts AS first_touch_at,
      ft.fill_pct,
      i.inv_ts AS invalidated_at
    FROM first_touches ft
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
  ),
  upd AS (
    UPDATE features_zone z
    SET
      first_touch_at = c.first_touch_at,
      fill_pct = COALESCE(c.fill_pct, z.fill_pct, 0),
      mitigated_at = COALESCE(c.first_touch_at, z.mitigated_at),
      invalidated_at = c.invalidated_at,
      is_fresh = (c.invalidated_at IS NULL),
      tapped = (c.first_touch_at IS NOT NULL)
    FROM candidates cnd
    LEFT JOIN computed c ON c.symbol = cnd.symbol AND c.tf = cnd.tf AND c.ts = cnd.ts
    WHERE z.symbol = cnd.symbol
      AND z.tf = cnd.tf
      AND z.ts = cnd.ts
    RETURNING z.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 3. Refresh features_order_block lifecycle with per-table checkpoint.
CREATE OR REPLACE FUNCTION refresh_order_block_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_max_ts TIMESTAMPTZ;
  v_table_name TEXT := 'features_order_block';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  WITH candidates AS (
    SELECT ob.symbol, ob.tf, ob.ts, ob.top, ob.bottom, ob.ob_kind
    FROM features_order_block ob
    WHERE ob.symbol = p_symbol
      AND ob.invalidated_at IS NULL
      AND ob.ts >= p_as_of_ts - p_lookback_interval
      AND ob.ts <= p_as_of_ts
      AND ob.ts > v_from_ts
    ORDER BY ob.ts ASC
    LIMIT p_limit
  ),
  first_touches AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts,
      MIN(c.ts) AS first_touch_ts,
      CASE
        WHEN cnd.ob_kind = 'bullish'
          THEN LEAST(1, GREATEST(0, MAX((cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0))))
        ELSE LEAST(1, GREATEST(0, MAX((LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0))))
      END AS fill_pct
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts <= p_as_of_ts
      AND c.h >= cnd.bottom
      AND c.l <= cnd.top
    GROUP BY cnd.symbol, cnd.tf, cnd.ts, cnd.top, cnd.bottom, cnd.ob_kind
  ),
  invalidations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, MIN(c.ts) AS inv_ts
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts <= p_as_of_ts
      AND (
        (cnd.ob_kind = 'bullish' AND c.c < cnd.bottom)
        OR (cnd.ob_kind = 'bearish' AND c.c > cnd.top)
      )
    GROUP BY cnd.symbol, cnd.tf, cnd.ts
  ),
  computed AS (
    SELECT
      COALESCE(ft.symbol, i.symbol) AS symbol,
      COALESCE(ft.tf, i.tf) AS tf,
      COALESCE(ft.ts, i.ts) AS ts,
      ft.first_touch_ts AS first_touch_at,
      ft.fill_pct,
      i.inv_ts AS invalidated_at
    FROM first_touches ft
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
  ),
  upd AS (
    UPDATE features_order_block ob
    SET
      first_touch_at = c.first_touch_at,
      fill_pct = COALESCE(c.fill_pct, ob.fill_pct, 0),
      mitigated_at = COALESCE(c.first_touch_at, ob.mitigated_at),
      invalidated_at = c.invalidated_at,
      is_fresh = (c.invalidated_at IS NULL)
    FROM candidates cnd
    LEFT JOIN computed c ON c.symbol = cnd.symbol AND c.tf = cnd.tf AND c.ts = cnd.ts
    WHERE ob.symbol = cnd.symbol
      AND ob.tf = cnd.tf
      AND ob.ts = cnd.ts
    RETURNING ob.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 4. Refresh features_ifvg lifecycle with per-table checkpoint.
CREATE OR REPLACE FUNCTION refresh_ifvg_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_max_ts TIMESTAMPTZ;
  v_table_name TEXT := 'features_ifvg';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  WITH candidates AS (
    SELECT f.symbol, f.tf, f.ts, f.top, f.bottom, f.direction
    FROM features_ifvg f
    WHERE f.symbol = p_symbol
      AND f.invalidated_at IS NULL
      AND f.ts >= p_as_of_ts - p_lookback_interval
      AND f.ts <= p_as_of_ts
      AND f.ts > v_from_ts
    ORDER BY f.ts ASC
    LIMIT p_limit
  ),
  first_touches AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts,
      MIN(c.ts) AS first_touch_ts,
      CASE
        WHEN cnd.direction = 'bullish'
          THEN LEAST(1, GREATEST(0, MAX((cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0))))
        ELSE LEAST(1, GREATEST(0, MAX((LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0))))
      END AS fill_pct
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts <= p_as_of_ts
      AND c.h >= cnd.bottom
      AND c.l <= cnd.top
    GROUP BY cnd.symbol, cnd.tf, cnd.ts, cnd.top, cnd.bottom, cnd.direction
  ),
  invalidations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, MIN(c.ts) AS inv_ts
    FROM candidates cnd
    JOIN candles_1m c ON c.symbol = cnd.symbol
      AND c.ts > cnd.ts
      AND c.ts <= p_as_of_ts
      AND (
        (opposite_direction(cnd.direction) = 'bullish' AND c.c < cnd.bottom)
        OR (opposite_direction(cnd.direction) = 'bearish' AND c.c > cnd.top)
      )
    GROUP BY cnd.symbol, cnd.tf, cnd.ts
  ),
  computed AS (
    SELECT
      COALESCE(ft.symbol, i.symbol) AS symbol,
      COALESCE(ft.tf, i.tf) AS tf,
      COALESCE(ft.ts, i.ts) AS ts,
      ft.first_touch_ts AS first_touch_at,
      ft.fill_pct,
      i.inv_ts AS invalidated_at
    FROM first_touches ft
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
  ),
  upd AS (
    UPDATE features_ifvg f
    SET
      first_touch_at = c.first_touch_at,
      fill_pct = COALESCE(c.fill_pct, f.fill_pct, 0),
      mitigated_at = COALESCE(c.first_touch_at, f.mitigated_at),
      invalidated_at = c.invalidated_at,
      is_fresh = (c.invalidated_at IS NULL)
    FROM candidates cnd
    LEFT JOIN computed c ON c.symbol = cnd.symbol AND c.tf = cnd.tf AND c.ts = cnd.ts
    WHERE f.symbol = cnd.symbol
      AND f.tf = cnd.tf
      AND f.ts = cnd.ts
    RETURNING f.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 5. Refresh features_sweep lifecycle with per-table checkpoint and guaranteed progress.
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
      mitigated_at = COALESCE(c.mit_ts, s.mitigated_at),
      is_fresh = (c.mit_ts IS NULL AND s.mitigated_at IS NULL)
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

-- 6. Refresh features_structure lifecycle with per-table checkpoint and guaranteed progress.
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
      invalidated_at = COALESCE(c.inv_ts, s.invalidated_at),
      is_fresh = (c.inv_ts IS NULL AND s.invalidated_at IS NULL)
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

-- 7. Wrapper no longer advances a shared checkpoint; each table manages its own.
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

  RETURN QUERY
  SELECT 'features_zone'::TEXT, v_zone
  UNION ALL SELECT 'features_order_block'::TEXT, v_ob
  UNION ALL SELECT 'features_ifvg'::TEXT, v_ifvg
  UNION ALL SELECT 'features_sweep'::TEXT, v_sweep
  UNION ALL SELECT 'features_structure'::TEXT, v_structure;
END;
$$ LANGUAGE plpgsql;
