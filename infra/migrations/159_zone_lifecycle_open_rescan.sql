-- Migration 159: Zone lifecycle rescan open zones on every cycle
--
-- Problem (migration 117): Candidates filter uses `z.ts > v_from_ts`, so once
-- the checkpoint cursor passes a zone's formation timestamp, that zone is
-- NEVER re-examined. If a candle breach occurs after the first scan (late
-- invalidation), `invalidated_at` stays NULL and `is_fresh` stays true forever.
--
-- Fix: Mirror migration 146's order_block approach — rescan ALL open zones
-- (invalidated_at IS NULL) within the lookback window every call. The formation-
-- time checkpoint still filters closed zones for efficiency, but the open-set
-- scan is unbounded by the cursor. IS DISTINCT FROM prevents no-op writes.
--
-- Performance note: The partial index idx_features_zone_lifecycle_scan
-- (WHERE invalidated_at IS NULL) already supports open-zone scans. The
-- lookback window (p_lookback_interval) bounds the total candidates.

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
  v_table_name TEXT := 'features_zone';
BEGIN
  -- Ensure a checkpoint row exists for this symbol+table.
  INSERT INTO lifecycle_refresh_state (symbol, table_name)
  VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  -- Determine scan start for checkpoint tracking of newly-formed zones.
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

  -- Re-process ALL open zones within the lookback window. The checkpoint
  -- (v_from_ts) is used only to bound the candidate set for closed zones
  -- (invalidated rows have terminal lifecycle and never change). Open zones
  -- are ALWAYS rescanned regardless of the cursor, so late invalidations
  -- are caught on the next cycle.
  WITH candidates AS (
    SELECT z.symbol, z.tf, z.ts, z.zone_kind, z.direction, z.top, z.bottom,
           z.first_touch_at, z.fill_pct, z.mitigated_at, z.invalidated_at, z.is_fresh
    FROM features_zone z
    WHERE z.symbol = p_symbol
      AND z.ts >= p_as_of_ts - p_lookback_interval
      AND z.ts <= p_as_of_ts
      AND (p_tf IS NULL OR z.tf = p_tf)
      AND (
        -- Open zones: always rescanned (catches late invalidations)
        z.invalidated_at IS NULL
        OR
        -- Closed zones within the checkpoint window: formation-time filter
        -- ensures they were already processed. Invalidated zones are terminal
        -- so they never need re-scanning — this clause is kept for backward
        -- compatibility with the existing partial index.
        (z.invalidated_at IS NOT NULL AND z.ts > v_from_ts)
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
      life.first_touch_at_new,
      COALESCE(life.fill_pct_new, 0::double precision) AS fill_pct_new,
      COALESCE(life.fill_mitigation_at_new, life.invalidated_at_new) AS mitigated_at_new,
      life.invalidated_at_new,
      life.invalidated_at_new IS NULL AS is_fresh_new
    FROM candidates cnd
    LEFT JOIN LATERAL (
      SELECT
        MIN(c.ts) FILTER (
          WHERE c.h >= cnd.bottom AND c.l <= cnd.top
        ) AS first_touch_at_new,
        MAX(
          CASE
            WHEN c.h < cnd.bottom OR c.l > cnd.top OR cnd.top <= cnd.bottom THEN NULL
            WHEN COALESCE(cnd.direction, CASE WHEN cnd.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END) = 'bullish'
              THEN LEAST(1::double precision, GREATEST(0::double precision,
                (cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0)))
            ELSE LEAST(1::double precision, GREATEST(0::double precision,
                (LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0)))
          END
        ) AS fill_pct_new,
        MIN(c.ts) FILTER (
          WHERE c.h >= cnd.bottom AND c.l <= cnd.top
            AND CASE
              WHEN COALESCE(cnd.direction, CASE WHEN cnd.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END) = 'bullish'
                THEN (cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0) >= 0.5
              ELSE (LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0) >= 0.5
            END
        ) AS fill_mitigation_at_new,
        MIN(c.ts) FILTER (
          WHERE (cnd.zone_kind = 'fvg' AND c.c >= cnd.bottom AND c.c <= cnd.top)
             OR (COALESCE(cnd.direction, CASE WHEN cnd.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END) = 'bullish'
                 AND c.c < cnd.bottom AND cnd.zone_kind <> 'fvg')
             OR (COALESCE(cnd.direction, CASE WHEN cnd.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END) = 'bearish'
                 AND c.c > cnd.top AND cnd.zone_kind <> 'fvg')
        ) AS invalidated_at_new
      FROM market.candles_1m_canonical c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
    ) life ON TRUE
  ),
  upd AS (
    UPDATE features_zone z
    SET
      first_touch_at = c.first_touch_at_new,
      fill_pct = c.fill_pct_new,
      mitigated_at = c.mitigated_at_new,
      invalidated_at = c.invalidated_at_new,
      is_fresh = c.is_fresh_new,
      tapped = (c.first_touch_at_new IS NOT NULL)
    FROM computed c
    WHERE z.symbol = c.symbol
      AND z.tf = c.tf
      AND z.ts = c.ts
      AND z.zone_kind = c.zone_kind
      AND z.direction = c.direction
      AND z.top = c.top
      AND z.bottom = c.bottom
      AND (z.first_touch_at, z.fill_pct, z.mitigated_at,
           z.invalidated_at, z.is_fresh)
          IS DISTINCT FROM
          (c.first_touch_at_new, c.fill_pct_new, c.mitigated_at_new,
           c.invalidated_at_new, c.is_fresh_new)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  -- Advance checkpoint for newly-formed zones (not used for open-zone
  -- rescan, but tracks progress for the closed-zone filter above).
  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(
    (SELECT MAX(ts) FROM features_zone
     WHERE symbol = p_symbol
       AND tf IS NOT DISTINCT FROM p_tf
       AND ts >= p_as_of_ts - p_lookback_interval
       AND ts <= p_as_of_ts
       AND invalidated_at IS NOT NULL
       AND ts > v_from_ts),
    p_as_of_ts
  )
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$function$;

COMMIT;
