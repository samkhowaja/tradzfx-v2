-- Add confirmation_count to features_ifvg to support robust reversal confirmation.
ALTER TABLE features_ifvg
  ADD COLUMN IF NOT EXISTS confirmation_count INT;
