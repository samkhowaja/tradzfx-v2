-- Partial covering indexes for fast point-in-time lookups of still-fresh zones/iFVGs/order blocks.
-- These complement the PIT DISTINCT indexes by letting the planner jump to rows that are
-- not yet invalidated, avoiding backward scans through large stale-history tails.

CREATE INDEX IF NOT EXISTS idx_features_zone_pit_fresh
  ON features_zone (symbol, tf, ts DESC)
  INCLUDE (zone_kind, top, bottom, strength_score)
  WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_features_ifvg_pit_fresh
  ON features_ifvg (symbol, tf, ts DESC)
  INCLUDE (direction, top, bottom, strength_score)
  WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_features_order_block_pit_fresh
  ON features_order_block (symbol, tf, ts DESC)
  INCLUDE (ob_kind, top, bottom, strength_score)
  WHERE invalidated_at IS NULL;
