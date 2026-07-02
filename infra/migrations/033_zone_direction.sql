-- Migration 027: Add direction to features_zone so FVGs can be bullish/bearish.
ALTER TABLE features_zone ADD COLUMN IF NOT EXISTS direction TEXT;
