-- Migration 095: Make zone direction part of the primary identity.
--
-- Track B (D-2): features_zone originally omitted direction from the PK, so a
-- bullish and a bearish zone at the same price/time collapsed into one row.
-- This migration:
--   1. Adds/stores direction on zone_outcomes and includes it in the unique key.
--   2. Adds direction to the features_zone primary key.
--   3. Updates refresh_zone_lifecycle to group/join by direction and read from
--      candles_1m (the previous version referenced a non-existent `candles` table).
--   4. Rebuilds market_levels_view so zone rows expose the correct directional kind.

-- 1. zone_outcomes: store direction and include it in the uniqueness key.
ALTER TABLE zone_outcomes ADD COLUMN IF NOT EXISTS direction TEXT;

UPDATE zone_outcomes
SET direction = CASE
  WHEN zone_kind = 'supply' THEN 'bearish'
  WHEN zone_kind = 'demand' THEN 'bullish'
  ELSE COALESCE(direction, 'bullish')
END
WHERE direction IS NULL;

DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'zone_outcomes'::regclass AND contype = 'u'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE zone_outcomes DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE zone_outcomes
  ADD CONSTRAINT zone_outcomes_unique
  UNIQUE (symbol, tf, zone_kind, direction, top, bottom, formation_ts);

-- 2. features_zone: backfill direction and include it in the PK.
ALTER TABLE features_zone ALTER COLUMN direction SET DEFAULT 'bullish';

UPDATE features_zone
SET direction = CASE
  WHEN zone_kind = 'supply' THEN 'bearish'
  WHEN zone_kind = 'demand' THEN 'bullish'
  ELSE COALESCE(direction, 'bullish')
END
WHERE direction IS NULL;

ALTER TABLE features_zone ALTER COLUMN direction SET NOT NULL;

ALTER TABLE features_zone DROP CONSTRAINT features_zone_pkey;
ALTER TABLE features_zone
  ADD PRIMARY KEY (symbol, tf, ts, zone_kind, direction, top, bottom);

-- 3. Refresh function: group/join by direction and use the real 1m candle table.
CREATE OR REPLACE FUNCTION refresh_zone_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count   INT := 0;
BEGIN
  v_from_ts := p_as_of_ts - p_lookback_interval;

  WITH touches AS (
    SELECT
      z.symbol, z.tf, z.ts, z.zone_kind, z.direction, z.top, z.bottom,
      COUNT(*) FILTER (
        WHERE c.ts > z.ts AND c.high >= z.bottom AND c.low <= z.top
      )::INT AS touch_count,
      COUNT(*) FILTER (
        WHERE c.ts > z.ts
          AND c.high >= z.bottom AND c.low <= z.top
          AND c.ts > COALESCE((
            SELECT MIN(c2.ts)
            FROM candles_1m c2
            WHERE c2.symbol = z.symbol
              AND c2.ts     > z.ts
              AND c2.high   >= z.bottom
              AND c2.low    <= z.top
          ), z.ts)
      )::INT AS retest_count
    FROM features_zone z
    LEFT JOIN LATERAL (
      SELECT ts, high, low
      FROM candles_1m c
      WHERE c.symbol = z.symbol
        AND c.ts     > z.ts
        AND c.ts     <= p_as_of_ts
      ORDER BY c.ts ASC
    ) c ON TRUE
    WHERE z.symbol = p_symbol
      AND (z.mitigated_at IS NULL OR z.mitigated_at > v_from_ts)
      AND (z.invalidated_at IS NULL OR z.invalidated_at > v_from_ts)
    GROUP BY z.symbol, z.tf, z.ts, z.zone_kind, z.direction, z.top, z.bottom
  )
  UPDATE features_zone z
  SET touch_count  = COALESCE(t.touch_count, 0),
      retest_count = COALESCE(t.retest_count, 0)
  FROM touches t
  WHERE z.symbol     = t.symbol
    AND z.tf         = t.tf
    AND z.ts         = t.ts
    AND z.zone_kind  = t.zone_kind
    AND z.direction  = t.direction
    AND z.top        = t.top
    AND z.bottom     = t.bottom;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 4. market_levels_view: derive directional kind from features_zone.direction
--    and include direction in the level hash.
CREATE OR REPLACE VIEW market_levels_view AS
SELECT
  gen_random_uuid() AS id,
  encode(sha256((symbol || ':' || tf || ':' || 'zone' || ':' || zone_kind || ':' || COALESCE(direction, '') || ':' || top::text || ':' || bottom::text || ':' || ts::text)::bytea), 'hex') AS level_hash,
  symbol,
  tf,
  'zone'::TEXT AS level_type,
  CASE
    WHEN zone_kind = 'demand' THEN 'demand'
    WHEN zone_kind = 'supply' THEN 'supply'
    WHEN direction = 'bullish' THEN 'bullish'
    WHEN direction = 'bearish' THEN 'bearish'
    ELSE zone_kind
  END AS kind,
  top::NUMERIC AS top,
  bottom::NUMERIC AS bottom,
  strength_score::NUMERIC AS strength,
  invalidated_at,
  first_touch_at AS tapped_at,
  COALESCE(touch_count, 0)::INT AS touch_count,
  NULL::TEXT AS source_id,
  NULL::JSONB AS source_json,
  ts,
  ts AS created_at,
  ts AS updated_at
FROM features_zone
UNION ALL
SELECT
  gen_random_uuid() AS id,
  encode(sha256((symbol || ':' || tf || ':' || 'order_block' || ':' || ob_kind || ':' || top::text || ':' || bottom::text || ':' || ts::text)::bytea), 'hex') AS level_hash,
  symbol,
  tf,
  'order_block'::TEXT AS level_type,
  ob_kind AS kind,
  top::NUMERIC AS top,
  bottom::NUMERIC AS bottom,
  strength_score::NUMERIC AS strength,
  invalidated_at,
  first_touch_at AS tapped_at,
  0 AS touch_count,
  NULL::TEXT AS source_id,
  NULL::JSONB AS source_json,
  ts,
  ts AS created_at,
  ts AS updated_at
FROM features_order_block
UNION ALL
SELECT
  gen_random_uuid() AS id,
  encode(sha256((symbol || ':' || tf || ':' || 'pivot' || ':' || kind || ':' || price::text || ':' || price::text || ':' || ts::text)::bytea), 'hex') AS level_hash,
  symbol,
  tf,
  'pivot'::TEXT AS level_type,
  kind,
  price::NUMERIC AS top,
  price::NUMERIC AS bottom,
  confidence::NUMERIC AS strength,
  NULL::TIMESTAMPTZ AS invalidated_at,
  NULL::TIMESTAMPTZ AS tapped_at,
  0 AS touch_count,
  NULL::TEXT AS source_id,
  NULL::JSONB AS source_json,
  ts,
  ts AS created_at,
  ts AS updated_at
FROM features_pivot
UNION ALL
SELECT
  gen_random_uuid() AS id,
  encode(sha256((symbol || ':' || tf || ':' || 'liquidity_pool' || ':' || kind || ':' || price::text || ':' || price::text || ':' || ts::text)::bytea), 'hex') AS level_hash,
  symbol,
  tf,
  'liquidity_pool'::TEXT AS level_type,
  kind,
  price::NUMERIC AS top,
  price::NUMERIC AS bottom,
  strength::NUMERIC AS strength,
  NULL::TIMESTAMPTZ AS invalidated_at,
  NULL::TIMESTAMPTZ AS tapped_at,
  0 AS touch_count,
  NULL::TEXT AS source_id,
  NULL::JSONB AS source_json,
  ts,
  ts AS created_at,
  ts AS updated_at
FROM features_liquidity_pools
UNION ALL
SELECT
  gen_random_uuid() AS id,
  encode(sha256((symbol || ':' || tf || ':' || 'fvg' || ':' || direction || ':' || top::text || ':' || bottom::text || ':' || ts::text)::bytea), 'hex') AS level_hash,
  symbol,
  tf,
  'fvg'::TEXT AS level_type,
  direction AS kind,
  top::NUMERIC AS top,
  bottom::NUMERIC AS bottom,
  strength_score::NUMERIC AS strength,
  invalidated_at,
  first_touch_at AS tapped_at,
  0 AS touch_count,
  NULL::TEXT AS source_id,
  NULL::JSONB AS source_json,
  ts,
  ts AS created_at,
  ts AS updated_at
FROM features_ifvg
UNION ALL
SELECT
  gen_random_uuid() AS id,
  encode(sha256((symbol || ':' || tf || ':' || 'eq_liquidity' || ':' || kind || ':' || price::text || ':' || price::text || ':' || ts::text)::bytea), 'hex') AS level_hash,
  symbol,
  tf,
  'eq_liquidity'::TEXT AS level_type,
  kind,
  price::NUMERIC AS top,
  price::NUMERIC AS bottom,
  strength::NUMERIC AS strength,
  NULL::TIMESTAMPTZ AS invalidated_at,
  NULL::TIMESTAMPTZ AS tapped_at,
  0 AS touch_count,
  NULL::TEXT AS source_id,
  NULL::JSONB AS source_json,
  ts,
  ts AS created_at,
  ts AS updated_at
FROM features_eq_liquidity;
