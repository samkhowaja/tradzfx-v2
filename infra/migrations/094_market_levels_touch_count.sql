-- Migration 094: expose real touch_count in market_levels_view
--
-- Track B (D013): the unified levels view was hardcoding touch_count = 0 for
-- every level type, which made structural entry-zone graders see all zones as
-- untouched.  features_zone now stores the real touch_count (added in 093), so
-- this migration wires it through the view and keeps other level types at 0
-- until their source tables gain the same columns.

CREATE OR REPLACE VIEW market_levels_view AS
SELECT
  gen_random_uuid() AS id,
  encode(sha256((symbol || ':' || tf || ':' || 'zone' || ':' || zone_kind || ':' || top::text || ':' || bottom::text || ':' || ts::text)::bytea), 'hex') AS level_hash,
  symbol,
  tf,
  'zone'::TEXT AS level_type,
  zone_kind AS kind,
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
