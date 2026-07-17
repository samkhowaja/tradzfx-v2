-- Migration 118: Setup evaluation lifecycle columns.
--
-- Problem: setup_evaluations was a write-only log table with no lifecycle
-- tracking. Once written, rows were never updated. There was no way to:
--   1. Skip redundant setup evaluations (same context = same result)
--   2. Mark a setup as invalidated when conditions break
--   3. Distinguish candidates from filled trades from expired setups
--
-- Changes:
--   - Add setup_status (candidate → triggered → filled → completed | invalidated)
--   - Add context_hash (for skipping redundant evaluations)
--   - Add invalidated_at (when the setup's conditions break)

ALTER TABLE setup_evaluations
  ADD COLUMN IF NOT EXISTS setup_status TEXT
    CHECK (setup_status IS NULL OR setup_status = ANY (ARRAY['candidate','triggered','filled','completed','invalidated','blocked','ready','waiting'])),
  ADD COLUMN IF NOT EXISTS context_hash TEXT,
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

COMMENT ON COLUMN setup_evaluations.setup_status IS 'Lifecycle: candidate→triggered→filled→completed|invalidated | Analysis: blocked|ready|waiting';
COMMENT ON COLUMN setup_evaluations.context_hash IS 'Deterministic hash of the evaluation context (bias, pricing, zone IDs) for skip-dedup';
COMMENT ON COLUMN setup_evaluations.invalidated_at IS 'When this setup was invalidated (conditions broke before fill)';

-- Index for finding stale setups quickly (used by the backtester skip logic
-- and any future refresh_setup_lifecycle function).
CREATE INDEX IF NOT EXISTS idx_setup_evaluations_status_hash
  ON setup_evaluations(setup_status, context_hash)
  WHERE setup_status IS NOT NULL;
