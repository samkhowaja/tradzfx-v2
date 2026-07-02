-- Migration 005e: Extensions to existing feature tables
-- Adds quality scoring, CISD flag, and LLT targets.

-- Zone quality scoring (Bernd's Globex, Doyle S/D, Waqar)
ALTER TABLE features_zone
  ADD COLUMN IF NOT EXISTS age_bars INT,
  ADD COLUMN IF NOT EXISTS departure_candles INT,
  ADD COLUMN IF NOT EXISTS is_fresh BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS quality_score DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_features_zone_fresh ON features_zone(symbol, tf, ts DESC, is_fresh) WHERE is_fresh = TRUE;

-- Structure: CISD flag (ICT Turtle Soup)
ALTER TABLE features_structure
  ADD COLUMN IF NOT EXISTS is_cisd BOOLEAN DEFAULT FALSE;

-- Pricing: LLT target + balanced flag (Kane's Lab)
ALTER TABLE features_pricing
  ADD COLUMN IF NOT EXISTS llt_target DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS balanced BOOLEAN DEFAULT FALSE;
