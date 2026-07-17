-- Idempotency for strategy_signal_candidates JSONL spool replay.
--
-- Migration 114 creates the table; this follow-up keeps already-migrated
-- databases honest by adding the replay identity as its own schema step.

CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_signal_candidates_identity
  ON strategy_signal_candidates(
    source,
    strategy_id,
    symbol,
    COALESCE(tf, ''),
    ts,
    COALESCE(side, ''),
    COALESCE(fingerprint, ''),
    decision_stage
  );
