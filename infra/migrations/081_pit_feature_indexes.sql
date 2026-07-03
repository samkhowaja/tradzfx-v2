-- Covering indexes to speed up point-in-time backtester LATERAL lookups.
-- Ordering the index key by the DISTINCT ON columns lets Postgres stop after
-- the first row per group instead of sorting the entire history up to b.ts.

DROP INDEX IF EXISTS idx_features_zone_pit_filter;
DROP INDEX IF EXISTS idx_features_order_block_pit_filter;

CREATE INDEX IF NOT EXISTS idx_features_zone_pit_distinct
  ON features_zone (symbol, tf, zone_kind, ts DESC)
  INCLUDE (direction, is_fresh, quality_score, invalidated_at, strength_score, top, bottom);

CREATE INDEX IF NOT EXISTS idx_features_zone_retest_pit
  ON features_zone_retest (symbol, tf, ts DESC)
  INCLUDE (wick_into_zone, close_inside_zone, direction);

CREATE INDEX IF NOT EXISTS idx_features_order_block_pit_distinct
  ON features_order_block (symbol, tf, ob_kind, ts DESC)
  INCLUDE (is_fresh, invalidated_at, strength_score, top, bottom);

CREATE INDEX IF NOT EXISTS idx_features_structure_pit_distinct
  ON features_structure (symbol, tf, event_type, direction, ts DESC)
  INCLUDE (level, invalidated_at, strength);

CREATE INDEX IF NOT EXISTS idx_features_ema_cross_pit_distinct
  ON features_ema_cross (symbol, tf, fast_period, slow_period, ts DESC)
  INCLUDE (direction);
