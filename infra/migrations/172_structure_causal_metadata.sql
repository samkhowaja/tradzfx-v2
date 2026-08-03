-- Add causal source/swept level metadata to features_structure.

ALTER TABLE features_structure
  ADD COLUMN IF NOT EXISTS source_level_id TEXT,
  ADD COLUMN IF NOT EXISTS source_level_kind TEXT,
  ADD COLUMN IF NOT EXISTS source_level_confirmation_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS swept_level_id TEXT,
  ADD COLUMN IF NOT EXISTS swept_level_price DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS swept_level_kind TEXT;

CREATE INDEX IF NOT EXISTS idx_features_structure_source_level
  ON features_structure(symbol, tf, source_level_id);