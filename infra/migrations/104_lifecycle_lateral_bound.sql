-- 104_lifecycle_lateral_bound.sql
--
-- P0-C / SK-24 / SK-26: bound the zone touch/retest COUNT LATERAL so
-- refresh_zone_lifecycle() cannot enter the death-spiral that froze the
-- XAUUSD lifecycle cursor for ~30 days.
--
-- Root cause (099 / pre-104 refresh_zone_lifecycle):
--   * candidates are walked `z.ts > v_from_ts ORDER BY z.ts ASC LIMIT p_limit`.
--   * the touch/retest pass was `LEFT JOIN LATERAL (SELECT c.ts FROM candles_1m
--     WHERE c.ts > ft.ts AND c.ts <= COALESCE(ft.invalidated_at, p_as_of_ts) ...)`
--     with NO inner LIMIT and an upper bound of p_as_of_ts. For a still-fresh
--     zone formed 30 days ago that scans ~43k 1m bars PER zone; across a
--     p_limit=10000 catch-up batch that is hundreds of millions of rows and the
--     statement never returns inside the web/PM2 budget, so the checkpoint
--     (last_processed_ts) never advances and the backlog is non-recoverable.
--
-- Fix: cap the touch/retest forward horizon at a fixed 5-day window from zone
-- formation (`LEAST(COALESCE(ft.invalidated_at, p_as_of_ts), ft.ts + 5 days)`).
-- touch_count/retest_count become "touches/retests within 5 days of formation",
-- a bounded, stable, strategy-sufficient definition. For live-edge (tradeable)
-- zones the natural horizon is << 5 days, so counts are exact; the cap only
-- truncates counts for old zones that the maintenance guard (see
-- scripts/refresh-lifecycle.js / P0-C runbook) closes out as non-tradeable.
--
-- first_touch / fill_pct / invalidation LATERALs are LEFT UNCHANGED: they are
-- LIMIT 1 and stop at the first index match, and they determine correctness
-- (is_fresh / invalidated_at), so they must not be time-capped.
--
-- The cursor checkpoint (last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)) is
-- unchanged; once the LATERAL is bounded the function completes and the cursor
-- advances every call, so partial/interrupted runs are no longer fatal.

CREATE OR REPLACE FUNCTION public.refresh_zone_lifecycle(
  p_symbol text,
  p_as_of_ts timestamp with time zone DEFAULT now(),
  p_lookback_interval interval DEFAULT '10 days'::interval,
  p_limit integer DEFAULT 1000,
  p_tf text DEFAULT NULL::text,
  p_ignore_checkpoint boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
AS $function$
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

  -- Touch / retest counters for the same candidate window, bounded by invalidation
  -- AND a fixed 5-day forward horizon from zone formation (SK-24/26 death-spiral fix).
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
        AND c.ts <= LEAST(COALESCE(ft.invalidated_at, p_as_of_ts), ft.ts + interval '5 days')
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
$function$;

COMMENT ON FUNCTION public.refresh_zone_lifecycle(text, timestamptz, interval, integer, text, boolean) IS
  'Per-symbol zone lifecycle recompute. P0-C/104: touch/retest COUNT LATERAL is bounded to a 5-day forward horizon (SK-24/26 death-spiral fix). first_touch/fill/invalidation remain LIMIT-1 (correctness).';
