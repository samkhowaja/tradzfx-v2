-- Lifecycle v2: split first touch from mitigation, compute fill_pct, and
-- switch PIT freshness to the already-maintained lifecycle columns.

-- 1. Add first_touch_at (and fill_pct where missing) to lifecycle tables.
ALTER TABLE features_zone
  ADD COLUMN IF NOT EXISTS first_touch_at TIMESTAMPTZ;

ALTER TABLE features_order_block
  ADD COLUMN IF NOT EXISTS first_touch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fill_pct DOUBLE PRECISION DEFAULT 0;

ALTER TABLE features_ifvg
  ADD COLUMN IF NOT EXISTS first_touch_at TIMESTAMPTZ;

-- 2. Update refresh functions to populate first_touch_at, fill_pct, and
-- keep mitigated_at populated for backward compatibility.

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
      AND z.invalidated_at IS NULL
      AND z.ts >= p_as_of_ts - p_lookback_interval
      AND z.ts <= p_as_of_ts
    ORDER BY z.ts DESC
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
      AND c.ts > v_from_ts
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
      COALESCE(ft.symbol, i.symbol) AS symbol,
      COALESCE(ft.tf, i.tf) AS tf,
      COALESCE(ft.ts, i.ts) AS ts,
      ft.first_touch_ts AS first_touch_at,
      ft.fill_pct,
      i.inv_ts AS invalidated_at
    FROM first_touches ft
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
  )
  UPDATE features_zone z
  SET
    first_touch_at = c.first_touch_at,
    fill_pct = COALESCE(c.fill_pct, z.fill_pct, 0),
    mitigated_at = COALESCE(c.first_touch_at, z.mitigated_at),
    invalidated_at = c.invalidated_at,
    is_fresh = (c.invalidated_at IS NULL),
    tapped = (c.first_touch_at IS NOT NULL)
  FROM computed c
  WHERE z.symbol = c.symbol
    AND z.tf = c.tf
    AND z.ts = c.ts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

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
      AND ob.invalidated_at IS NULL
      AND ob.ts >= p_as_of_ts - p_lookback_interval
      AND ob.ts <= p_as_of_ts
    ORDER BY ob.ts DESC
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
      AND c.ts > v_from_ts
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
      COALESCE(ft.symbol, i.symbol) AS symbol,
      COALESCE(ft.tf, i.tf) AS tf,
      COALESCE(ft.ts, i.ts) AS ts,
      ft.first_touch_ts AS first_touch_at,
      ft.fill_pct,
      i.inv_ts AS invalidated_at
    FROM first_touches ft
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
  )
  UPDATE features_order_block ob
  SET
    first_touch_at = c.first_touch_at,
    fill_pct = COALESCE(c.fill_pct, ob.fill_pct, 0),
    mitigated_at = COALESCE(c.first_touch_at, ob.mitigated_at),
    invalidated_at = c.invalidated_at,
    is_fresh = (c.invalidated_at IS NULL)
  FROM computed c
  WHERE ob.symbol = c.symbol
    AND ob.tf = c.tf
    AND ob.ts = c.ts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

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
      AND f.invalidated_at IS NULL
      AND f.ts >= p_as_of_ts - p_lookback_interval
      AND f.ts <= p_as_of_ts
    ORDER BY f.ts DESC
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
      AND c.ts > v_from_ts
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
      COALESCE(ft.symbol, i.symbol) AS symbol,
      COALESCE(ft.tf, i.tf) AS tf,
      COALESCE(ft.ts, i.ts) AS ts,
      ft.first_touch_ts AS first_touch_at,
      ft.fill_pct,
      i.inv_ts AS invalidated_at
    FROM first_touches ft
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
  )
  UPDATE features_ifvg f
  SET
    first_touch_at = c.first_touch_at,
    fill_pct = COALESCE(c.fill_pct, f.fill_pct, 0),
    mitigated_at = COALESCE(c.first_touch_at, f.mitigated_at),
    invalidated_at = c.invalidated_at,
    is_fresh = (c.invalidated_at IS NULL)
  FROM computed c
  WHERE f.symbol = c.symbol
    AND f.tf = c.tf
    AND f.ts = c.ts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 3. Covering indexes for fast PIT lookups using lifecycle columns.
CREATE INDEX IF NOT EXISTS idx_features_zone_pit_cover
  ON features_zone(symbol, tf, ts DESC)
  INCLUDE (zone_kind, fill_pct, top, bottom, strength_score, first_touch_at, mitigated_at, invalidated_at);

CREATE INDEX IF NOT EXISTS idx_features_structure_pit_cover
  ON features_structure(symbol, tf, ts DESC)
  INCLUDE (event_type, direction, level, invalidated_at);

CREATE INDEX IF NOT EXISTS idx_features_pricing_pit_cover
  ON features_pricing(symbol, tf, ts DESC)
  INCLUDE (position);

CREATE INDEX IF NOT EXISTS idx_features_order_block_pit_cover
  ON features_order_block(symbol, tf, ts DESC)
  INCLUDE (ob_kind, top, bottom, strength_score, first_touch_at, mitigated_at, invalidated_at);

CREATE INDEX IF NOT EXISTS idx_features_ifvg_pit_cover
  ON features_ifvg(symbol, tf, ts DESC)
  INCLUDE (direction, top, bottom, strength_score, first_touch_at, mitigated_at, invalidated_at);
