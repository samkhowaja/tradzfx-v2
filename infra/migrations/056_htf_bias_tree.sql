-- Migration 045: HTF Bias Tree (Phase 7).
-- Stores the propagated per-timeframe bias tree alongside the legacy aggregate.

ALTER TABLE features_htf_bias
  ADD COLUMN IF NOT EXISTS by_time_frame JSONB,
  ADD COLUMN IF NOT EXISTS trading_tf TEXT;
