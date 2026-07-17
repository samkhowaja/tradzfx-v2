-- Add timeframe-specific lifecycle checkpoints for timeframe-bearing zone
-- lifecycle repair. The legacy lifecycle_refresh_state table is intentionally
-- left in place because non-zone lifecycle functions still use its
-- (symbol, table_name) contract.

CREATE TABLE IF NOT EXISTS lifecycle_refresh_state_tf (
  symbol text NOT NULL,
  table_name text NOT NULL,
  tf text NOT NULL,
  last_processed_ts timestamptz NOT NULL,
  PRIMARY KEY (symbol, table_name, tf)
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
