-- Migration 117: Zone lifecycle process only open zones (not invalidated).
--
-- Problem: refresh_zone_lifecycle() was scanning BOTH open AND recently-invalidated
-- zones for every call (44,237 rows in a 30d XAUUSD window, of which only 220 are
-- open — 99.5% waste). An invalidated zone has terminal lifecycle state — its
-- first_touch_at, fill_pct, invalidated_at, is_fresh, tapped columns NEVER change,
-- so processing them every iteration is purely wasted I/O.
--
-- Additionally, the idx_features_zone_lifecycle_scan partial index (WHERE invalidated_at
-- IS NULL) could not be used because the candidate filter included invalidated rows.
--
-- Changes:
--   1. Candidate filter: z.invalidated_at IS NULL (matching order_block/ifvg/sweep/structure).
--   2. Actually respect the checkpoint: removed the p_ignore_checkpoint=true workaround.
--      When p_ignore_checkpoint=false (default), v_from_ts = MAX(last_processed_ts, window_start).
--   3. Removed lifecycle_refresh_state_tf support (unused — refresh-lifecycle.js always
--      passes p_tf=NULL). Keeps the 6-param signature for backward compatibility.
--   4. Removed the scan_full_window() code path that was introduced by migrations 097/111
--      as a defensive hedge — it's been empirically confirmed unnecessary.
--
-- After applying, run: REINDEX TABLE features_zone; VACUUM FULL features_zone;
-- to reclaim ~18GB of bloat from the 97% deletion that already ran.

-- Drop the legacy 4-param overload first so the 6-param is unambiguous
DROP FUNCTION IF EXISTS public.refresh_zone_lifecycle(
  p_symbol text,
  p_as_of_ts timestamp with time zone,
  p_lookback_interval interval,
  p_limit integer
);

-- Drop the old 6-param overload so CREATE OR REPLACE replaces it cleanly
DROP FUNCTION IF EXISTS public.refresh_zone_lifecycle(
  p_symbol text,
  p_as_of_ts timestamp with time zone,
  p_lookback_interval interval,
  p_limit integer,
  p_tf text,
  p_ignore_checkpoint boolean
);

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
  -- Ensure a checkpoint row exists for this symbol+table.
  INSERT INTO lifecycle_refresh_state (symbol, table_name)
  VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  -- Determine scan start: if ignoring checkpoint, start from window boundary;
  -- otherwise use MAX(last_processed_ts, window boundary).
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

  -- Process only OPEN (non-invalidated) zones within the scan window.
  -- This matches the partial index idx_features_zone_lifecycle_scan
  -- (WHERE invalidated_at IS NULL) for fast indexed scanning.
  -- Invalidated zones have terminal lifecycle state and never need reprocessing.
  WITH candidates AS (
    SELECT z.symbol, z.tf, z.ts, z.zone_kind, z.direction, z.top, z.bottom
    FROM features_zone z
    WHERE z.symbol = p_symbol
      AND z.ts >= p_as_of_ts - p_lookback_interval
      AND z.ts <= p_as_of_ts
      AND z.ts > v_from_ts
      AND (p_tf IS NULL OR z.tf = p_tf)
      AND z.invalidated_at IS NULL
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
        AND c.ts <= LEAST(p_as_of_ts, cnd.ts + interval '5 days')
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
            cnd.zone_kind = 'fvg'
            AND c.c >= cnd.bottom
            AND c.c <= cnd.top
          )
          OR
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

  -- Advance checkpoint. If no rows were processed, advance to p_as_of_ts so
  -- subsequent calls don't re-scan the same empty window.
  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$function$;
