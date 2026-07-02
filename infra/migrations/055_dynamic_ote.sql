-- Migration 044: Dynamic OTE & premium/discount scoring for Phase 6.
-- Adds impulse-leg-derived OTE columns and a continuous premium/discount score
-- to the pricing feature output.

ALTER TABLE features_pricing
  ADD COLUMN IF NOT EXISTS dynamic_ote_low DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dynamic_ote_high DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dynamic_ote_mid DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dynamic_ote_source TEXT,
  ADD COLUMN IF NOT EXISTS dynamic_ote_quality DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS premium_discount_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS impulse_legs JSONB;

-- Pit-cover index update is not strictly required because the existing
-- idx_features_pricing_pit_cover only INCLUDEs `position`. New columns are
-- read by the setup engine's latest-row lookup which already filters by
-- (symbol, tf, ts DESC).
