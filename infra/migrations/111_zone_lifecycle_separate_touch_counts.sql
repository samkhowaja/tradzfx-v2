-- Keep critical zone lifecycle repair independent from expensive touch/retest
-- analytics. A timeout in retest counting used to roll back tapped,
-- first_touch_at, mitigated_at, invalidated_at, and is_fresh updates.
--
-- Touch/retest counts should be maintained by a separate incremental event
-- ledger. This lifecycle function now updates only the fields used to decide
-- whether a zone is currently tradable.

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
  IF p_tf IS NULL THEN
    INSERT INTO lifecycle_refresh_state (symbol, table_name)
    VALUES (p_symbol, v_table_name)
    ON CONFLICT (symbol, table_name) DO NOTHING;
  ELSE
    INSERT INTO lifecycle_refresh_state_tf (symbol, table_name, tf, last_processed_ts)
    VALUES (p_symbol, v_table_name, p_tf, p_as_of_ts - p_lookback_interval)
    ON CONFLICT (symbol, table_name, tf) DO NOTHING;
  END IF;

  IF p_ignore_checkpoint THEN
    v_from_ts := p_as_of_ts - p_lookback_interval;
  ELSIF p_tf IS NULL THEN
    SELECT COALESCE(
      GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval),
      p_as_of_ts - p_lookback_interval
    )
    INTO v_from_ts
    FROM lifecycle_refresh_state
    WHERE symbol = p_symbol AND table_name = v_table_name;
  ELSE
    SELECT COALESCE(
      GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval),
      p_as_of_ts - p_lookback_interval
    )
    INTO v_from_ts
    FROM lifecycle_refresh_state_tf
    WHERE symbol = p_symbol AND table_name = v_table_name AND tf = p_tf;
  END IF;

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

  IF p_tf IS NULL THEN
    UPDATE lifecycle_refresh_state
    SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
    WHERE symbol = p_symbol AND table_name = v_table_name;
  ELSE
    UPDATE lifecycle_refresh_state_tf
    SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
    WHERE symbol = p_symbol AND table_name = v_table_name AND tf = p_tf;
  END IF;

  RETURN v_count;
END;
$function$;
