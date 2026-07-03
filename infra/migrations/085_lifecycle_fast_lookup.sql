-- Lifecycle fast-lookup migration.
-- Replaces set-based candle joins for zone / order-block / IFVG lifecycle with
-- LATERAL ... LIMIT 1 lookups and adds supporting indexes.
-- Must be applied non-transactionally because it uses CREATE INDEX CONCURRENTLY.

--- statement: idx_zone_lifecycle_scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_features_zone_lifecycle_scan
  ON features_zone (symbol, ts ASC)
  WHERE invalidated_at IS NULL;

--- statement: idx_candles_lifecycle_lookup
-- candles_1m is a hypertable, so CREATE INDEX CONCURRENTLY is not supported.
-- The index is small enough to build with a brief lock in this environment.
CREATE INDEX IF NOT EXISTS idx_candles_1m_lifecycle_lookup
  ON candles_1m (symbol, ts ASC)
  INCLUDE (o, h, l, c);

--- statement: fn_zone_lifecycle
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
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      ft.first_touch_ts,
      CASE WHEN ft.first_touch_ts IS NULL THEN NULL ELSE fp.fill_pct END AS fill_pct,
      inv.inv_ts
    FROM candidates cnd
    LEFT JOIN LATERAL (
      SELECT c.ts AS first_touch_ts
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
        AND c.h >= cnd.bottom
        AND c.l <= cnd.top
      ORDER BY c.ts ASC
      LIMIT 1
    ) ft ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN cnd.zone_kind = 'demand' OR
            (cnd.zone_kind NOT IN ('demand','supply') AND COALESCE(cnd.direction,'bullish') = 'bullish')
            THEN LEAST(1, GREATEST(0, MAX((cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0))))
          ELSE LEAST(1, GREATEST(0, MAX((LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0))))
        END AS fill_pct
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts >= ft.first_touch_ts
        AND c.ts <= p_as_of_ts
        AND c.h >= cnd.bottom
        AND c.l <= cnd.top
    ) fp ON TRUE
    LEFT JOIN LATERAL (
      SELECT c.ts AS inv_ts
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
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
      ORDER BY c.ts ASC
      LIMIT 1
    ) inv ON TRUE
  ),
  upd AS (
    UPDATE features_zone z
    SET
      first_touch_at = c.first_touch_ts,
      fill_pct = COALESCE(c.fill_pct, z.fill_pct, 0),
      mitigated_at = COALESCE(c.first_touch_ts, z.mitigated_at),
      invalidated_at = c.inv_ts,
      is_fresh = (c.inv_ts IS NULL),
      tapped = (c.first_touch_ts IS NOT NULL)
    FROM computed c
    WHERE z.symbol = c.symbol
      AND z.tf = c.tf
      AND z.ts = c.ts
    RETURNING z.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

--- statement: fn_order_block_lifecycle
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
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      ft.first_touch_ts,
      CASE WHEN ft.first_touch_ts IS NULL THEN NULL ELSE fp.fill_pct END AS fill_pct,
      inv.inv_ts
    FROM candidates cnd
    LEFT JOIN LATERAL (
      SELECT c.ts AS first_touch_ts
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
        AND c.h >= cnd.bottom
        AND c.l <= cnd.top
      ORDER BY c.ts ASC
      LIMIT 1
    ) ft ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN cnd.ob_kind = 'bullish'
            THEN LEAST(1, GREATEST(0, MAX((cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0))))
          ELSE LEAST(1, GREATEST(0, MAX((LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0))))
        END AS fill_pct
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts >= ft.first_touch_ts
        AND c.ts <= p_as_of_ts
        AND c.h >= cnd.bottom
        AND c.l <= cnd.top
    ) fp ON TRUE
    LEFT JOIN LATERAL (
      SELECT c.ts AS inv_ts
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
        AND (
          (cnd.ob_kind = 'bullish' AND c.c < cnd.bottom)
          OR (cnd.ob_kind = 'bearish' AND c.c > cnd.top)
        )
      ORDER BY c.ts ASC
      LIMIT 1
    ) inv ON TRUE
  ),
  upd AS (
    UPDATE features_order_block ob
    SET
      first_touch_at = c.first_touch_ts,
      fill_pct = COALESCE(c.fill_pct, ob.fill_pct, 0),
      mitigated_at = COALESCE(c.first_touch_ts, ob.mitigated_at),
      invalidated_at = c.inv_ts,
      is_fresh = (c.inv_ts IS NULL)
    FROM computed c
    WHERE ob.symbol = c.symbol
      AND ob.tf = c.tf
      AND ob.ts = c.ts
    RETURNING ob.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

--- statement: fn_ifvg_lifecycle
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
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      ft.first_touch_ts,
      CASE WHEN ft.first_touch_ts IS NULL THEN NULL ELSE fp.fill_pct END AS fill_pct,
      inv.inv_ts
    FROM candidates cnd
    LEFT JOIN LATERAL (
      SELECT c.ts AS first_touch_ts
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
        AND c.h >= cnd.bottom
        AND c.l <= cnd.top
      ORDER BY c.ts ASC
      LIMIT 1
    ) ft ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN cnd.direction = 'bullish'
            THEN LEAST(1, GREATEST(0, MAX((cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0))))
          ELSE LEAST(1, GREATEST(0, MAX((LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0))))
        END AS fill_pct
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts >= ft.first_touch_ts
        AND c.ts <= p_as_of_ts
        AND c.h >= cnd.bottom
        AND c.l <= cnd.top
    ) fp ON TRUE
    LEFT JOIN LATERAL (
      SELECT c.ts AS inv_ts
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
        AND (
          (opposite_direction(cnd.direction) = 'bullish' AND c.c < cnd.bottom)
          OR (opposite_direction(cnd.direction) = 'bearish' AND c.c > cnd.top)
        )
      ORDER BY c.ts ASC
      LIMIT 1
    ) inv ON TRUE
  ),
  upd AS (
    UPDATE features_ifvg f
    SET
      first_touch_at = c.first_touch_ts,
      fill_pct = COALESCE(c.fill_pct, f.fill_pct, 0),
      mitigated_at = COALESCE(c.first_touch_ts, f.mitigated_at),
      invalidated_at = c.inv_ts,
      is_fresh = (c.inv_ts IS NULL)
    FROM computed c
    WHERE f.symbol = c.symbol
      AND f.tf = c.tf
      AND f.ts = c.ts
    RETURNING f.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
