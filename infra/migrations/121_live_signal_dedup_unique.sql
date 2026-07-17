-- Prevent duplicate live_signal rows when pipeline runs in parallel.
-- Required before deploying acquirePipelineBucket fail-open (Fix 5).

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_signal_dedup
  ON live_signal(symbol, strategy_id, signal_fingerprint)
  WHERE signal_fingerprint IS NOT NULL;
