-- Strategy signal candidate audit table.
--
-- Persists every signal candidate — accepted and rejected — with the exact
-- feature/candle/direction/gate/setup snapshot at the moment of evaluation.
-- Both the backtest runner and the live runner write to this table via a
-- JSONL spool + batch inserter (the pattern proven by ingest-resilience work)
-- so audit persistence can never block or fail a trade decision.
--
-- "Why no trades?" becomes:
--   SELECT * FROM strategy_signal_candidates
--   WHERE strategy_id = '...' AND decision_stage != 'executed'
--   ORDER BY ts DESC;
-- (RC-7 / Bugs #12, #15)

CREATE TABLE IF NOT EXISTS strategy_signal_candidates (
  id BIGSERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  tf TEXT,
  ts TIMESTAMPTZ NOT NULL,
  side TEXT,
  entry_price NUMERIC,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  bias_direction TEXT,
  setup_family TEXT,
  setup_grade TEXT,
  setup_block_reasons JSONB,
  gate_results JSONB,
  decision_stage TEXT NOT NULL,
  decision_reason TEXT,
  feature_snapshot JSONB,
  fingerprint TEXT,
  dedup_check_result TEXT,
  engine_version TEXT,
  spec_hash TEXT,
  source TEXT NOT NULL DEFAULT 'backtest',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_signal_candidates_strategy_ts
  ON strategy_signal_candidates(strategy_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_signal_candidates_stage
  ON strategy_signal_candidates(strategy_id, decision_stage)
  WHERE decision_stage != 'executed';

CREATE INDEX IF NOT EXISTS idx_strategy_signal_candidates_symbol_ts
  ON strategy_signal_candidates(symbol, ts DESC);

-- Idempotency for JSONL spool replay. Nullable fields are normalized so the
-- same candidate/stage cannot be inserted twice after a drain retry.
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
