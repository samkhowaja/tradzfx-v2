-- Migration 164: durable checkpoints for progressive DAG-v2 shadow producers.
-- Shadow-only. No live signal or execution path reads this table.

BEGIN;

CREATE TABLE IF NOT EXISTS progressive_shadow_checkpoint (
  plan_hash TEXT NOT NULL REFERENCES progressive_plan_registry(plan_hash),
  node_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  source_feature TEXT NOT NULL,
  source_tf TEXT NOT NULL,
  last_source_ts TIMESTAMPTZ NOT NULL,
  last_source_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_hash, node_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_progressive_shadow_checkpoint_source
  ON progressive_shadow_checkpoint(source_feature, symbol, source_tf, last_source_ts, last_source_key);

COMMIT;
