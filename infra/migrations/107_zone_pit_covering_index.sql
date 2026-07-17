-- Extend the features_zone PIT covering index so the DISTINCT ON lateral
-- lookups resolve as index-only scans. The legacy fork now pushes zone_kind /
-- direction equalities into the lateral (mirroring the compiler), so the
-- (symbol, tf, zone_kind, ts DESC) key is fully usable; direction and
-- rank_score are added to the INCLUDE list to cover the tie-break ORDER BY.
-- Must be applied non-transactionally (CREATE INDEX CONCURRENTLY).

--- statement: drop_zone_pit_distinct
DROP INDEX CONCURRENTLY IF EXISTS idx_features_zone_pit_distinct;

--- statement: create_zone_pit_distinct
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_features_zone_pit_distinct
  ON features_zone (symbol, tf, zone_kind, ts DESC)
  INCLUDE (direction, is_fresh, quality_score, rank_score, invalidated_at, strength_score, top, bottom);
