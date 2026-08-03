-- Migration: 171_causal_timestamps
-- Purpose: Add causal availability timestamps for pivot confirmation and structure/sweep events
-- Created: 2026-07-30
-- Depends on: verified column gaps

ALTER TABLE features_pivot
ADD COLUMN IF NOT EXISTS confirmation_ts TIMESTAMPTZ;

ALTER TABLE features_structure
ADD COLUMN IF NOT EXISTS available_at_ts TIMESTAMPTZ;

ALTER TABLE features_sweep
ADD COLUMN IF NOT EXISTS available_at_ts TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_features_pivot_confirmation_ts
ON features_pivot(symbol, tf, confirmation_ts);

CREATE INDEX IF NOT EXISTS idx_features_structure_available_at
ON features_structure(symbol, tf, available_at_ts);

CREATE INDEX IF NOT EXISTS idx_features_sweep_available_at
ON features_sweep(symbol, tf, available_at_ts);
