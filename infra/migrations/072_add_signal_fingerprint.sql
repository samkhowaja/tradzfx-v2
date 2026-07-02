-- Phase 3: signal deduplication.
-- Add a deterministic fingerprint to orders and live_signal so identical
-- rejected/closed signals can be suppressed during the strategy cooldown.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS signal_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS orders_fingerprint_idx
  ON orders (signal_fingerprint)
  WHERE signal_fingerprint IS NOT NULL;

ALTER TABLE live_signal
  ADD COLUMN IF NOT EXISTS signal_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS live_signal_fingerprint_idx
  ON live_signal (signal_fingerprint)
  WHERE signal_fingerprint IS NOT NULL;
