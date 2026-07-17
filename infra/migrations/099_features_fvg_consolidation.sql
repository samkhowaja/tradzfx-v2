-- Migration 099: Consolidate features_fvg into features_zone
--
-- The standalone features_fvg table is retired. FVGs are already emitted by
-- features_zone with zone_kind = 'fvg', so this migration:
--
--   1. Re-defines refresh_zone_lifecycle() so FVGs are invalidated when price
--      closes inside the gap (classic FVG semantics), not when price closes
--      beyond the distal edge.
--   2. Migrates any rows still present in features_fvg but missing from
--      features_zone.
--   3. Recomputes invalidated_at / is_fresh for FVG zones in the recent 30-day
--      window (covers the bounded lookbacks used by all FVG signal-source
--      strategies). Older rows are refreshed incrementally by the engine.
--   4. Backs up and drops the features_fvg table.
--
-- This migration is intentionally reversible during the deploy window: the
-- features_fvg_backup table can be restored if anything goes wrong.

-- Remove any old 4-argument overload left over from pre-097 migrations so the
-- 6-argument version below is unambiguous.
DROP FUNCTION IF EXISTS refresh_zone_lifecycle(text, timestamp with time zone, interval, integer);

-- ---------------------------------------------------------------------------
-- 1. Update refresh_zone_lifecycle to use close-inside-gap invalidation for FVGs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refresh_zone_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000,
  p_tf TEXT DEFAULT NULL,
  p_ignore_checkpoint BOOLEAN DEFAULT FALSE
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT := 0;
  v_max_ts TIMESTAMPTZ;
  v_table_name TEXT := 'features_zone';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name)
  VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  IF p_ignore_checkpoint THEN
    v_from_ts := p_as_of_ts - p_lookback_interval;
  ELSE
    SELECT COALESCE(
      GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval),
      p_as_of_ts - p_lookback_interval
    )
    INTO v_from_ts
    FROM lifecycle_refresh_state
    WHERE symbol = p_symbol AND table_name = v_table_name;
  END IF;

  -- Full lifecycle update: first touch, fill %, mitigation, invalidation, freshness.
  WITH candidates AS (
    SELECT z.symbol, z.tf, z.ts, z.zone_kind, z.direction, z.top, z.bottom
    FROM features_zone z
    WHERE z.symbol = p_symbol
      AND z.ts >= p_as_of_ts - p_lookback_interval
      AND z.ts <= p_as_of_ts
      AND z.ts > v_from_ts
      AND (p_tf IS NULL OR z.tf = p_tf)
      AND (
        z.invalidated_at IS NULL
        OR z.invalidated_at > p_as_of_ts - p_lookback_interval
      )
    ORDER BY z.ts ASC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      cnd.zone_kind,
      cnd.direction,
      cnd.top,
      cnd.bottom,
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
          WHEN COALESCE(cnd.direction, CASE WHEN cnd.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END) = 'bullish'
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
          -- Classic FVG invalidation: first close inside the gap.
          (
            cnd.zone_kind = 'fvg'
            AND c.c >= cnd.bottom
            AND c.c <= cnd.top
          )
          OR
          -- Supply/demand invalidation: close beyond the distal edge.
          (
            COALESCE(cnd.direction, CASE WHEN cnd.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END) = 'bullish'
            AND c.c < cnd.bottom
            AND cnd.zone_kind <> 'fvg'
          )
          OR
          (
            COALESCE(cnd.direction, CASE WHEN cnd.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END) = 'bearish'
            AND c.c > cnd.top
            AND cnd.zone_kind <> 'fvg'
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
      AND z.zone_kind = c.zone_kind
      AND z.direction = c.direction
      AND z.top = c.top
      AND z.bottom = c.bottom
    RETURNING z.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  -- Touch / retest counters for the same candidate window, bounded by invalidation.
  WITH candidates AS (
    SELECT z.symbol, z.tf, z.ts, z.zone_kind, z.direction, z.top, z.bottom, z.invalidated_at
    FROM features_zone z
    WHERE z.symbol = p_symbol
      AND z.ts >= p_as_of_ts - p_lookback_interval
      AND z.ts <= p_as_of_ts
      AND z.ts > v_from_ts
      AND (p_tf IS NULL OR z.tf = p_tf)
      AND (
        z.invalidated_at IS NULL
        OR z.invalidated_at > p_as_of_ts - p_lookback_interval
      )
    ORDER BY z.ts ASC
    LIMIT p_limit
  ),
  first_touches AS (
    SELECT
      cnd.*,
      (SELECT c.ts
       FROM candles_1m c
       WHERE c.symbol = cnd.symbol
         AND c.ts > cnd.ts
         AND c.ts <= p_as_of_ts
         AND c.h >= cnd.bottom
         AND c.l <= cnd.top
       ORDER BY c.ts ASC
       LIMIT 1) AS first_touch_ts
    FROM candidates cnd
  ),
  touches AS (
    SELECT
      ft.symbol, ft.tf, ft.ts, ft.zone_kind, ft.direction, ft.top, ft.bottom,
      COUNT(*) FILTER (
        WHERE c.ts > ft.ts
          AND c.ts <= COALESCE(ft.invalidated_at, p_as_of_ts)
      )::INT AS touch_count,
      COUNT(*) FILTER (
        WHERE c.ts > ft.first_touch_ts
          AND c.ts <= COALESCE(ft.invalidated_at, p_as_of_ts)
      )::INT AS retest_count
    FROM first_touches ft
    LEFT JOIN LATERAL (
      SELECT c.ts
      FROM candles_1m c
      WHERE c.symbol = ft.symbol
        AND c.ts > ft.ts
        AND c.ts <= COALESCE(ft.invalidated_at, p_as_of_ts)
        AND c.h >= ft.bottom
        AND c.l <= ft.top
      ORDER BY c.ts ASC
    ) c ON TRUE
    GROUP BY ft.symbol, ft.tf, ft.ts, ft.zone_kind, ft.direction, ft.top, ft.bottom
  )
  UPDATE features_zone z
  SET touch_count = COALESCE(t.touch_count, 0),
      retest_count = COALESCE(t.retest_count, 0)
  FROM touches t
  WHERE z.symbol = t.symbol
    AND z.tf = t.tf
    AND z.ts = t.ts
    AND z.zone_kind = t.zone_kind
    AND z.direction = t.direction
    AND z.top = t.top
    AND z.bottom = t.bottom;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. Migrate any features_fvg rows not already present in features_zone
-- ---------------------------------------------------------------------------

INSERT INTO features_zone (
  symbol,
  tf,
  ts,
  zone_kind,
  direction,
  top,
  bottom,
  fill_pct,
  tapped,
  age_bars,
  is_fresh,
  engine_ver,
  input_hash
)
SELECT
  f.symbol,
  f.tf,
  f.ts,
  'fvg',
  COALESCE(f.direction, 'bullish'),
  f.top,
  f.bottom,
  0,
  false,
  f.age_bars,
  true,
  'migrated',
  'migrated'
FROM features_fvg f
WHERE NOT EXISTS (
  SELECT 1
  FROM features_zone z
  WHERE z.symbol = f.symbol
    AND z.tf = f.tf
    AND z.ts = f.ts
    AND z.zone_kind = 'fvg'
    AND z.direction = f.direction
    AND z.top = f.top
    AND z.bottom = f.bottom
);

-- ---------------------------------------------------------------------------
-- 3. Recompute invalidated_at / is_fresh for recent FVG zones
-- ---------------------------------------------------------------------------
-- This covers the bounded lookback windows used by the FVG signal-source
-- strategies (24 hours for 5m/15m, up to 30 days for 1d). Older rows are
-- refreshed incrementally the next time the engine lifecycle refresh runs.

WITH fvg_invalidations AS (
  SELECT
    z.symbol,
    z.tf,
    z.ts,
    z.zone_kind,
    z.direction,
    z.top,
    z.bottom,
    first_close.ts AS inv_ts
  FROM features_zone z
  LEFT JOIN LATERAL (
    SELECT c.ts
    FROM candles_1m c
    WHERE c.symbol = z.symbol
      AND c.ts > z.ts
      AND c.c >= z.bottom
      AND c.c <= z.top
    ORDER BY c.ts ASC
    LIMIT 1
  ) first_close ON TRUE
  WHERE z.zone_kind = 'fvg'
    AND z.ts >= NOW() - INTERVAL '30 days'
)
UPDATE features_zone z
SET
  invalidated_at = fi.inv_ts,
  is_fresh = (fi.inv_ts IS NULL)
FROM fvg_invalidations fi
WHERE z.symbol = fi.symbol
  AND z.tf = fi.tf
  AND z.ts = fi.ts
  AND z.zone_kind = fi.zone_kind
  AND z.direction = fi.direction
  AND z.top = fi.top
  AND z.bottom = fi.bottom;

-- ---------------------------------------------------------------------------
-- 4. Back up and drop the retired features_fvg table
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS features_fvg_backup;
CREATE TABLE features_fvg_backup AS TABLE features_fvg;

DROP TABLE IF EXISTS features_fvg;
