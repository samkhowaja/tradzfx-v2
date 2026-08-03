-- Migration 166: durable run ledger for progressive DAG-v2 shadow canary.
-- Shadow-only observability. No signal, order, trade, or execution path reads this table.

BEGIN;

CREATE TABLE IF NOT EXISTS progressive_shadow_canary_run (
  run_id BIGSERIAL PRIMARY KEY,
  plan_hash TEXT NOT NULL REFERENCES progressive_plan_registry(plan_hash),
  symbol TEXT NOT NULL,
  data_clock TIMESTAMPTZ NOT NULL,
  window_since TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed')),
  pass_count INTEGER NOT NULL DEFAULT 0 CHECK (pass_count >= 0),
  rows_read INTEGER NOT NULL DEFAULT 0 CHECK (rows_read >= 0),
  events_inserted INTEGER NOT NULL DEFAULT 0 CHECK (events_inserted >= 0),
  events_applied INTEGER NOT NULL DEFAULT 0 CHECK (events_applied >= 0),
  events_ignored INTEGER NOT NULL DEFAULT 0 CHECK (events_ignored >= 0),
  invariant_json JSONB,
  error_text TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CHECK (window_since <= data_clock),
  CHECK ((status = 'running') = (finished_at IS NULL)),
  CHECK (status <> 'passed' OR (invariant_json IS NOT NULL AND error_text IS NULL)),
  CHECK (status <> 'failed' OR error_text IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_progressive_shadow_canary_run_plan_clock
  ON progressive_shadow_canary_run(plan_hash, symbol, data_clock DESC, run_id DESC);

CREATE INDEX IF NOT EXISTS idx_progressive_shadow_canary_run_status
  ON progressive_shadow_canary_run(status, started_at DESC);

COMMIT;
