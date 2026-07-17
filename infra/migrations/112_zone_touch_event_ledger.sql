-- Zone touch/retest analytics ledger.
--
-- Critical lifecycle repair now updates tradability state only. This ledger is
-- the durable home for secondary analytics such as touch_count and retest_count.
-- If this job is slow or stale, strategy execution can degrade quality scoring
-- without corrupting tapped/invalidated truth.

CREATE TABLE IF NOT EXISTS zone_touch_events (
  zone_id text NOT NULL,
  symbol text NOT NULL,
  tf text NOT NULL,
  zone_ts timestamptz NOT NULL,
  zone_kind text NOT NULL,
  direction text NOT NULL,
  top numeric NOT NULL,
  bottom numeric NOT NULL,
  touch_ts timestamptz NOT NULL,
  touch_type text NOT NULL CHECK (touch_type IN ('first_touch', 'retest')),
  fill_pct numeric,
  candle_high numeric,
  candle_low numeric,
  candle_close numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zone_id, touch_ts)
);

CREATE INDEX IF NOT EXISTS idx_zone_touch_events_symbol_tf_touch
  ON zone_touch_events(symbol, tf, touch_ts DESC);

CREATE INDEX IF NOT EXISTS idx_zone_touch_events_zone
  ON zone_touch_events(zone_id, touch_ts);

CREATE TABLE IF NOT EXISTS zone_touch_event_refresh_state (
  symbol text NOT NULL,
  tf text NOT NULL,
  last_processed_ts timestamptz NOT NULL,
  PRIMARY KEY (symbol, tf)
);

CREATE OR REPLACE FUNCTION public.refresh_zone_touch_events(
  p_symbol text,
  p_as_of_ts timestamptz DEFAULT now(),
  p_lookback_interval interval DEFAULT '10 days'::interval,
  p_limit integer DEFAULT 1000,
  p_tf text DEFAULT NULL::text,
  p_ignore_checkpoint boolean DEFAULT false
)
RETURNS TABLE(rows_inserted integer, zones_updated integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_from_ts timestamptz;
  v_max_zone_ts timestamptz;
  v_tf text := COALESCE(p_tf, '*');
BEGIN
  INSERT INTO zone_touch_event_refresh_state(symbol, tf, last_processed_ts)
  VALUES (p_symbol, v_tf, p_as_of_ts - p_lookback_interval)
  ON CONFLICT (symbol, tf) DO NOTHING;

  IF p_ignore_checkpoint THEN
    v_from_ts := p_as_of_ts - p_lookback_interval;
  ELSE
    SELECT COALESCE(
      GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval),
      p_as_of_ts - p_lookback_interval
    )
    INTO v_from_ts
    FROM zone_touch_event_refresh_state
    WHERE symbol = p_symbol AND tf = v_tf;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_zone_touch_candidates (
    zone_id text,
    symbol text,
    tf text,
    zone_ts timestamptz,
    zone_kind text,
    direction text,
    top numeric,
    bottom numeric,
    first_touch_at timestamptz,
    invalidated_at timestamptz
  ) ON COMMIT DROP;

  TRUNCATE tmp_zone_touch_candidates;

  INSERT INTO tmp_zone_touch_candidates
  SELECT
    md5(concat_ws('|', z.symbol, z.tf, z.ts::text, z.zone_kind, COALESCE(z.direction, ''), z.top::text, z.bottom::text)) AS zone_id,
    z.symbol,
    z.tf,
    z.ts,
    z.zone_kind,
    COALESCE(z.direction, CASE WHEN z.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END) AS direction,
    z.top,
    z.bottom,
    z.first_touch_at,
    z.invalidated_at
  FROM features_zone z
  WHERE z.symbol = p_symbol
    AND z.ts >= p_as_of_ts - p_lookback_interval
    AND z.ts <= p_as_of_ts
    AND z.ts > v_from_ts
    AND (p_tf IS NULL OR z.tf = p_tf)
  ORDER BY z.ts ASC
  LIMIT p_limit;

  WITH inserted AS (
    INSERT INTO zone_touch_events (
      zone_id, symbol, tf, zone_ts, zone_kind, direction, top, bottom,
      touch_ts, touch_type, fill_pct, candle_high, candle_low, candle_close
    )
    SELECT
      z.zone_id,
      z.symbol,
      z.tf,
      z.zone_ts,
      z.zone_kind,
      z.direction,
      z.top,
      z.bottom,
      c.ts AS touch_ts,
      CASE
        WHEN z.first_touch_at IS NULL OR c.ts <= z.first_touch_at THEN 'first_touch'
        ELSE 'retest'
      END AS touch_type,
      CASE
        WHEN z.direction = 'bullish'
          THEN LEAST(1, GREATEST(0, (z.top - GREATEST(z.bottom, c.l)) / NULLIF(z.top - z.bottom, 0)))
        ELSE LEAST(1, GREATEST(0, (LEAST(z.top, c.h) - z.bottom) / NULLIF(z.top - z.bottom, 0)))
      END AS fill_pct,
      c.h,
      c.l,
      c.c
    FROM tmp_zone_touch_candidates z
    JOIN LATERAL (
      SELECT c.ts, c.h, c.l, c.c
      FROM candles_1m c
      WHERE c.symbol = z.symbol
        AND c.ts > z.zone_ts
        AND c.ts <= LEAST(COALESCE(z.invalidated_at, p_as_of_ts), z.zone_ts + interval '5 days')
        AND c.h >= z.bottom
        AND c.l <= z.top
      ORDER BY c.ts ASC
    ) c ON TRUE
    ON CONFLICT (zone_id, touch_ts) DO NOTHING
    RETURNING zone_id
  ),
  counts AS (
    SELECT
      z.zone_id,
      COUNT(e.*)::int AS touch_count,
      COUNT(e.*) FILTER (WHERE e.touch_type = 'retest')::int AS retest_count
    FROM tmp_zone_touch_candidates z
    LEFT JOIN zone_touch_events e ON e.zone_id = z.zone_id
    GROUP BY z.zone_id
  ),
  updated AS (
    UPDATE features_zone f
    SET touch_count = c.touch_count,
        retest_count = c.retest_count
    FROM tmp_zone_touch_candidates z
    JOIN counts c ON c.zone_id = z.zone_id
    WHERE f.symbol = z.symbol
      AND f.tf = z.tf
      AND f.ts = z.zone_ts
      AND f.zone_kind = z.zone_kind
      AND f.direction = z.direction
      AND f.top = z.top
      AND f.bottom = z.bottom
    RETURNING f.ts
  )
  SELECT
    (SELECT COUNT(*)::int FROM inserted),
    (SELECT COUNT(*)::int FROM updated),
    (SELECT MAX(zone_ts) FROM tmp_zone_touch_candidates)
  INTO rows_inserted, zones_updated, v_max_zone_ts;

  UPDATE zone_touch_event_refresh_state
  SET last_processed_ts = COALESCE(v_max_zone_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND tf = v_tf;

  RETURN NEXT;
END;
$function$;
