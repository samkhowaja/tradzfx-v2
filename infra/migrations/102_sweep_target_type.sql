-- Migration 102: add target_type to features_sweep (P3a level-based sweep rebuild).
-- Classifies the liquidity level that was swept: swing | pdh | pdl | equal_high | equal_low.
-- Nullable so existing rows remain valid; rebuilt rows populate it. Backfill follows.

ALTER TABLE features_sweep ADD COLUMN IF NOT EXISTS target_type TEXT;

CREATE INDEX IF NOT EXISTS idx_features_sweep_target_type
  ON features_sweep (symbol, tf, target_type, ts DESC);
