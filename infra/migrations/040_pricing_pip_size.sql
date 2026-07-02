-- Add pip_size to features_pricing so the risk compiler can size positions
-- correctly per symbol instead of using a hardcoded threshold.

ALTER TABLE features_pricing
  ADD COLUMN IF NOT EXISTS pip_size DOUBLE PRECISION;
