-- Deduplicate live_signal rows created by the pipeline-trigger race.
-- Keep the newest row (by signal_id) for each unique setup key and repoint
-- any live_order foreign keys to the kept row before deleting duplicates.
WITH keepers AS (
  SELECT signal_id,
         MAX(signal_id::text) OVER (
           PARTITION BY deployment_id, symbol, ts, strategy_id, side
         ) AS keeper_id
  FROM live_signal
)
UPDATE live_order lo
SET signal_id = k.keeper_id::uuid
FROM keepers k
WHERE lo.signal_id = k.signal_id
  AND k.signal_id::text <> k.keeper_id;

WITH dups AS (
  SELECT signal_id,
         ROW_NUMBER() OVER (
           PARTITION BY deployment_id, symbol, ts, strategy_id, side
           ORDER BY signal_id::text DESC
         ) AS rn
  FROM live_signal
)
DELETE FROM live_signal
WHERE signal_id IN (SELECT signal_id FROM dups WHERE rn > 1);

-- Enforce uniqueness so future duplicate inserts are rejected safely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_signal_unique_setup
  ON live_signal (deployment_id, symbol, ts, strategy_id, side);

-- Replace the single-symbol pipeline lock with a (symbol, bucket) lock.
-- The old primary key only allowed one row per symbol, which forced an
-- UPDATE-based race-prone acquisition. A unique index on (symbol, bucket)
-- lets each bucket be claimed once with an INSERT ... ON CONFLICT DO NOTHING.
ALTER TABLE pipeline_trigger_state
  DROP CONSTRAINT IF EXISTS pipeline_trigger_state_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_trigger_state_symbol_bucket
  ON pipeline_trigger_state (symbol, bucket);
