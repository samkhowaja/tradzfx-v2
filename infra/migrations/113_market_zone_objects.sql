-- Canonical market zone objects.
--
-- features_zone is a raw feature surface and can contain many overlapping rows
-- around the same market object. Strategies need a stable object layer with
-- dedupe/count metadata so direction/entry logic is not dominated by duplicate
-- historical shadows.

CREATE TABLE IF NOT EXISTS market_zone_objects (
  zone_object_id text PRIMARY KEY,
  symbol text NOT NULL,
  tf text NOT NULL,
  zone_kind text NOT NULL,
  direction text NOT NULL,
  price_bucket bigint NOT NULL,
  time_bucket timestamptz NOT NULL,
  first_formed_at timestamptz NOT NULL,
  last_formed_at timestamptz NOT NULL,
  top numeric NOT NULL,
  bottom numeric NOT NULL,
  midpoint numeric NOT NULL,
  raw_zone_count integer NOT NULL,
  active_raw_count integer NOT NULL,
  invalidated_raw_count integer NOT NULL,
  touched_raw_count integer NOT NULL,
  max_rank_score numeric,
  max_quality_score numeric,
  max_strength_score numeric,
  touch_count integer NOT NULL DEFAULT 0,
  retest_count integer NOT NULL DEFAULT 0,
  invalidated_at timestamptz,
  mitigated_at timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_zone_objects_lookup
  ON market_zone_objects(symbol, tf, zone_kind, direction, time_bucket DESC);

CREATE INDEX IF NOT EXISTS idx_market_zone_objects_active
  ON market_zone_objects(symbol, tf, zone_kind, direction, midpoint)
  WHERE invalidated_at IS NULL;

CREATE OR REPLACE FUNCTION public.refresh_market_zone_objects(
  p_symbol text,
  p_tf text,
  p_as_of_ts timestamptz DEFAULT now(),
  p_lookback_interval interval DEFAULT '90 days'::interval
)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH raw AS (
    SELECT
      z.symbol,
      z.tf,
      z.zone_kind,
      COALESCE(z.direction, CASE WHEN z.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END) AS direction,
      z.ts,
      z.top,
      z.bottom,
      ((z.top + z.bottom) / 2.0) AS midpoint,
      z.rank_score,
      z.quality_score,
      z.strength_score,
      z.invalidated_at,
      z.mitigated_at,
      z.tapped,
      z.touch_count,
      z.retest_count,
      date_trunc('day', z.ts) AS time_bucket,
      floor(ln(GREATEST(((z.top + z.bottom) / 2.0)::double precision, 0.00000001)) / 0.0005)::bigint AS price_bucket
    FROM features_zone z
    WHERE z.symbol = p_symbol
      AND z.tf = p_tf
      AND z.ts >= p_as_of_ts - p_lookback_interval
      AND z.ts <= p_as_of_ts
      AND z.top > z.bottom
  ),
  grouped AS (
    SELECT
      md5(concat_ws('|', symbol, tf, zone_kind, direction, time_bucket::text, price_bucket::text)) AS zone_object_id,
      symbol,
      tf,
      zone_kind,
      direction,
      price_bucket,
      time_bucket,
      MIN(ts) AS first_formed_at,
      MAX(ts) AS last_formed_at,
      MAX(top) AS top,
      MIN(bottom) AS bottom,
      AVG(midpoint) AS midpoint,
      COUNT(*)::int AS raw_zone_count,
      COUNT(*) FILTER (WHERE invalidated_at IS NULL)::int AS active_raw_count,
      COUNT(*) FILTER (WHERE invalidated_at IS NOT NULL)::int AS invalidated_raw_count,
      COUNT(*) FILTER (WHERE COALESCE(tapped, false))::int AS touched_raw_count,
      MAX(rank_score) AS max_rank_score,
      MAX(quality_score) AS max_quality_score,
      MAX(strength_score) AS max_strength_score,
      SUM(COALESCE(touch_count, 0))::int AS touch_count,
      SUM(COALESCE(retest_count, 0))::int AS retest_count,
      CASE
        WHEN COUNT(*) FILTER (WHERE invalidated_at IS NULL) > 0 THEN NULL
        ELSE MAX(invalidated_at)
      END AS invalidated_at,
      MIN(mitigated_at) FILTER (WHERE mitigated_at IS NOT NULL) AS mitigated_at
    FROM raw
    GROUP BY symbol, tf, zone_kind, direction, price_bucket, time_bucket
  ),
  upserted AS (
    INSERT INTO market_zone_objects (
      zone_object_id, symbol, tf, zone_kind, direction, price_bucket, time_bucket,
      first_formed_at, last_formed_at, top, bottom, midpoint, raw_zone_count,
      active_raw_count, invalidated_raw_count, touched_raw_count, max_rank_score,
      max_quality_score, max_strength_score, touch_count, retest_count,
      invalidated_at, mitigated_at, refreshed_at
    )
    SELECT
      zone_object_id, symbol, tf, zone_kind, direction, price_bucket, time_bucket,
      first_formed_at, last_formed_at, top, bottom, midpoint, raw_zone_count,
      active_raw_count, invalidated_raw_count, touched_raw_count, max_rank_score,
      max_quality_score, max_strength_score, touch_count, retest_count,
      invalidated_at, mitigated_at, now()
    FROM grouped
    ON CONFLICT (zone_object_id) DO UPDATE SET
      first_formed_at = EXCLUDED.first_formed_at,
      last_formed_at = EXCLUDED.last_formed_at,
      top = EXCLUDED.top,
      bottom = EXCLUDED.bottom,
      midpoint = EXCLUDED.midpoint,
      raw_zone_count = EXCLUDED.raw_zone_count,
      active_raw_count = EXCLUDED.active_raw_count,
      invalidated_raw_count = EXCLUDED.invalidated_raw_count,
      touched_raw_count = EXCLUDED.touched_raw_count,
      max_rank_score = EXCLUDED.max_rank_score,
      max_quality_score = EXCLUDED.max_quality_score,
      max_strength_score = EXCLUDED.max_strength_score,
      touch_count = EXCLUDED.touch_count,
      retest_count = EXCLUDED.retest_count,
      invalidated_at = EXCLUDED.invalidated_at,
      mitigated_at = EXCLUDED.mitigated_at,
      refreshed_at = now()
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_count FROM upserted;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE VIEW market_zone_objects_active AS
SELECT *
FROM market_zone_objects
WHERE invalidated_at IS NULL;
