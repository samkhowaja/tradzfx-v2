-- Restore directional projection lost from market_levels_view after migration 095.
-- Source feature tables remain unchanged.

CREATE OR REPLACE VIEW market_levels_view AS
SELECT gen_random_uuid() AS id,
  encode(sha256((symbol || ':' || tf || ':zone:' || zone_kind || ':' || COALESCE(direction, '') || ':' || top::text || ':' || bottom::text || ':' || ts::text)::bytea), 'hex') AS level_hash,
  symbol, tf, 'zone'::TEXT AS level_type,
  CASE WHEN zone_kind IN ('demand', 'supply') THEN zone_kind
       WHEN direction IN ('bullish', 'bearish') THEN direction
       ELSE zone_kind END AS kind,
  top::NUMERIC, bottom::NUMERIC, strength_score::NUMERIC AS strength,
  invalidated_at, first_touch_at AS tapped_at, COALESCE(touch_count, 0)::INT AS touch_count,
  NULL::TEXT AS source_id, NULL::JSONB AS source_json, ts, ts AS created_at, ts AS updated_at
FROM features_zone
UNION ALL
SELECT gen_random_uuid(),
  encode(sha256((symbol || ':' || tf || ':order_block:' || ob_kind || ':' || top::text || ':' || bottom::text || ':' || ts::text)::bytea), 'hex'),
  symbol, tf, 'order_block'::TEXT, ob_kind, top::NUMERIC, bottom::NUMERIC,
  strength_score::NUMERIC, invalidated_at, first_touch_at, 0,
  NULL::TEXT, NULL::JSONB, ts, ts, ts
FROM features_order_block
UNION ALL
SELECT gen_random_uuid(),
  encode(sha256((symbol || ':' || tf || ':pivot:' || kind || ':' || price::text || ':' || price::text || ':' || ts::text)::bytea), 'hex'),
  symbol, tf, 'pivot'::TEXT, kind, price::NUMERIC, price::NUMERIC, confidence::NUMERIC,
  NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 0, NULL::TEXT, NULL::JSONB, ts, ts, ts
FROM features_pivot
UNION ALL
SELECT gen_random_uuid(),
  encode(sha256((symbol || ':' || tf || ':liquidity_pool:' || kind || ':' || price::text || ':' || price::text || ':' || ts::text)::bytea), 'hex'),
  symbol, tf, 'liquidity_pool'::TEXT, kind, price::NUMERIC, price::NUMERIC, strength::NUMERIC,
  NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 0, NULL::TEXT, NULL::JSONB, ts, ts, ts
FROM features_liquidity_pools
UNION ALL
SELECT gen_random_uuid(),
  encode(sha256((symbol || ':' || tf || ':fvg:' || direction || ':' || top::text || ':' || bottom::text || ':' || ts::text)::bytea), 'hex'),
  symbol, tf, 'fvg'::TEXT, direction, top::NUMERIC, bottom::NUMERIC, strength_score::NUMERIC,
  invalidated_at, first_touch_at, 0, NULL::TEXT, NULL::JSONB, ts, ts, ts
FROM features_ifvg
UNION ALL
SELECT gen_random_uuid(),
  encode(sha256((symbol || ':' || tf || ':eq_liquidity:' || kind || ':' || price::text || ':' || price::text || ':' || ts::text)::bytea), 'hex'),
  symbol, tf, 'eq_liquidity'::TEXT, kind, price::NUMERIC, price::NUMERIC, strength::NUMERIC,
  NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 0, NULL::TEXT, NULL::JSONB, ts, ts, ts
FROM features_eq_liquidity;