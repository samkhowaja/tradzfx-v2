---
--- Migration 157: Time-bucketed live_signal dedup index
---
--- The original idx_live_signal_dedup (migration 121) is keyed on
--- (symbol, strategy_id, signal_fingerprint) with NO time component.
--- This means a byte-identical signal emitted days later (same sym + strat
---+ same fingerprint) violates the UNIQUE → aborts the transaction,
---+ producing 24/29 orphan orders with no joinable parent live_signal row (§1.4).
---
--- Fix: include date_trunc('hour', ts) in the unique constraint so that
--- identical signals in different hours are NOT duplicates. The pipeline's
--- findRecentDuplicate (30-min cooldown) already prevents rapid re-entry;
--- the DB constraint is a safety net for pipeline re-runs within the same hour.
---

-- Drop the old time-less index
DROP INDEX IF EXISTS idx_live_signal_dedup;

-- Create time-bucketed replacement.
-- date_trunc on timestamptz is STABLE (timezone-dependent), not IMMUTABLE,
-- so we cast through TIMESTAMP AT TIME ZONE 'UTC' which is deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_signal_dedup_v2
  ON live_signal(symbol, strategy_id, signal_fingerprint, date_trunc('hour', ts AT TIME ZONE 'UTC'))
  WHERE signal_fingerprint IS NOT NULL;
