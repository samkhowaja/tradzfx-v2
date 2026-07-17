-- ATR Zero-Row Repair: Prevent zero ATR values on non-zero-range candles.
-- ATR should almost never be zero on liquid FX over valid candles (range > 0).
-- This constraint prevents corrupt ATR rows from entering the table.

-- Simple check constraint: ATR value must be positive (or null)
-- The producer will handle the more complex validation against candle range
ALTER TABLE features_atr ADD CONSTRAINT chk_atr_not_zero
CHECK (
  value > 0
  OR value IS NULL
) NOT VALID;

-- Index to speed up the constraint check on inserts
CREATE INDEX IF NOT EXISTS idx_features_atr_zero_check
  ON features_atr (symbol, tf, ts)
  WHERE value = 0 OR value IS NULL;