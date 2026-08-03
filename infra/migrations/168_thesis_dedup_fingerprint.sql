---
--- Migration 168: Thesis-level dedup fingerprint
---
--- Adds a thesis_fingerprint column to live_signal and orders tables.
--- The thesis fingerprint captures (symbol + strategy_id + UTC date + session
--- window + direction + conditionId + feature row identity) so that trades
--- sharing the same market thesis (e.g. same 1h HTF zone + BST session) are
--- deduplicated — only the earliest accepted trade per unique thesis survives.
---
--- A UNIQUE index on live_signal prevents race conditions where two concurrent
--- pipeline evaluations both accept the same thesis in the same second.
---

ALTER TABLE live_signal
  ADD COLUMN IF NOT EXISTS thesis_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_live_signal_thesis_fingerprint
  ON live_signal (thesis_fingerprint)
  WHERE thesis_fingerprint IS NOT NULL;

-- Unique constraint: at most one live_signal per unique thesis per symbol/strategy.
-- Prevents concurrent pipeline runs from inserting duplicate thesis signals.
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_signal_thesis_dedup
  ON live_signal (symbol, strategy_id, thesis_fingerprint)
  WHERE thesis_fingerprint IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS thesis_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_thesis_fingerprint
  ON orders (thesis_fingerprint)
  WHERE thesis_fingerprint IS NOT NULL;

-- Also add to live_order for full lineage
ALTER TABLE live_order
  ADD COLUMN IF NOT EXISTS thesis_fingerprint TEXT;
