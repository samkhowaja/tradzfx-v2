-- Migration 161: PIT-safe canonical zone clustering (shadow only)
--
-- Raw features_zone rows remain untouched. public.canonical_zone_observations
-- adds deterministic cluster metadata for diagnostics. The
-- canonical_zones_as_of() function performs representative selection only
-- after applying the caller's anchor, preventing future rungs or lifecycle
-- state from leaking into PIT queries.

BEGIN;

CREATE OR REPLACE FUNCTION public.zone_canonical_grid(p_symbol TEXT)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN upper(regexp_replace(COALESCE(p_symbol, ''), '[^A-Z0-9]', '', 'g')) IN ('XAUUSD', 'GOLD') THEN 0.50
    WHEN upper(regexp_replace(COALESCE(p_symbol, ''), '[^A-Z0-9]', '', 'g')) ~ 'JPY$' THEN 0.05
    ELSE 0.0005
  END
$$;

CREATE OR REPLACE VIEW public.canonical_zone_observations AS
SELECT
  z.*,
  public.zone_canonical_grid(z.symbol) AS canonical_grid,
  round(((z.top + z.bottom) / 2.0) / public.zone_canonical_grid(z.symbol))::BIGINT AS price_bucket,
  concat_ws(
    '|',
    upper(z.symbol),
    z.tf,
    z.zone_kind,
    z.direction,
    round(((z.top + z.bottom) / 2.0) / public.zone_canonical_grid(z.symbol))::BIGINT
  ) AS logical_id
FROM public.features_zone z
WHERE z.top IS NOT NULL
  AND z.bottom IS NOT NULL
  AND z.top > z.bottom;

CREATE OR REPLACE FUNCTION public.canonical_zones_as_of(
  p_symbol TEXT,
  p_tf TEXT,
  p_anchor TIMESTAMPTZ,
  p_lookback INTERVAL DEFAULT INTERVAL '30 days'
)
RETURNS TABLE (
  symbol TEXT,
  tf TEXT,
  ts TIMESTAMPTZ,
  zone_kind TEXT,
  direction TEXT,
  top DOUBLE PRECISION,
  bottom DOUBLE PRECISION,
  fill_pct DOUBLE PRECISION,
  tapped BOOLEAN,
  age_bars INTEGER,
  departure_candles INTEGER,
  is_fresh BOOLEAN,
  quality_score DOUBLE PRECISION,
  formation TEXT,
  strength_score DOUBLE PRECISION,
  mitigated_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  first_touch_at TIMESTAMPTZ,
  rank_score DOUBLE PRECISION,
  outcome TEXT,
  touch_count INTEGER,
  retest_count INTEGER,
  engine_ver TEXT,
  input_hash TEXT,
  logical_id TEXT,
  price_bucket BIGINT,
  canonical_grid DOUBLE PRECISION,
  rung_count BIGINT,
  raw_ids TEXT[]
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH eligible AS MATERIALIZED (
    SELECT o.*
    FROM public.canonical_zone_observations o
    WHERE o.symbol = p_symbol
      AND o.tf = p_tf
      AND o.ts <= p_anchor
      AND o.ts >= p_anchor - p_lookback
      AND (o.invalidated_at IS NULL OR o.invalidated_at > p_anchor)
  ),
  grouped AS (
    SELECT
      e.logical_id,
      COUNT(*)::BIGINT AS rung_count,
      array_agg(
        concat_ws('@', e.ts::TEXT, e.top::TEXT, e.bottom::TEXT)
        ORDER BY e.ts, e.top, e.bottom
      ) AS raw_ids
    FROM eligible e
    GROUP BY e.logical_id
  ),
  ranked AS (
    SELECT
      e.*,
      row_number() OVER (
        PARTITION BY e.logical_id
        ORDER BY
          CASE WHEN e.mitigated_at IS NULL OR e.mitigated_at > p_anchor THEN 1 ELSE 0 END DESC,
          e.quality_score DESC NULLS LAST,
          e.rank_score DESC NULLS LAST,
          e.strength_score DESC NULLS LAST,
          e.ts DESC
      ) AS representative_rank
    FROM eligible e
  )
  SELECT
    r.symbol, r.tf, r.ts, r.zone_kind, r.direction, r.top, r.bottom,
    r.fill_pct, r.tapped, r.age_bars, r.departure_candles, r.is_fresh,
    r.quality_score, r.formation, r.strength_score, r.mitigated_at,
    r.invalidated_at, r.first_touch_at, r.rank_score, r.outcome,
    r.touch_count, r.retest_count, r.engine_ver, r.input_hash,
    r.logical_id, r.price_bucket, r.canonical_grid,
    g.rung_count, g.raw_ids
  FROM ranked r
  JOIN grouped g USING (logical_id)
  WHERE r.representative_rank = 1
$$;

COMMENT ON VIEW public.canonical_zone_observations IS
  'Shadow-only zone observations with deterministic logical cluster metadata; does not collapse rows.';
COMMENT ON FUNCTION public.canonical_zones_as_of(TEXT, TEXT, TIMESTAMPTZ, INTERVAL) IS
  'PIT-safe canonical zone representatives selected after anchor and lifecycle filtering.';

COMMIT;
