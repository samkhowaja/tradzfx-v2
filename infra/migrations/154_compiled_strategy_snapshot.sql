-- Immutable compiler artifact used by live deployments and historical replay.
-- Stores point-in-time SQL separately from mutable compiler/registry code.

CREATE TABLE IF NOT EXISTS compiled_strategy_snapshot (
    snapshot_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_hash            TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    content_hash_bin        BYTEA GENERATED ALWAYS AS (decode(content_hash, 'hex')) STORED,
    strategy_snapshot_id    UUID NOT NULL REFERENCES strategy_settings_snapshot(snapshot_id),
    strategy_id             TEXT NOT NULL,
    compiler_version        TEXT NOT NULL,
    registry_version        TEXT NOT NULL,
    source_spec_hash        TEXT NOT NULL CHECK (source_spec_hash ~ '^[0-9a-f]{64}$'),
    pit_signal_sql          TEXT NOT NULL,
    parameter_contract_json JSONB NOT NULL DEFAULT '{"symbol":1,"ttlInterval":2,"evaluationTs":3}',
    activated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT compiled_strategy_snapshot_compiler_nonempty CHECK (length(trim(compiler_version)) > 0),
    CONSTRAINT compiled_strategy_snapshot_registry_nonempty CHECK (length(trim(registry_version)) > 0),
    CONSTRAINT compiled_strategy_snapshot_sql_nonempty CHECK (length(trim(pit_signal_sql)) > 0),
    CONSTRAINT compiled_strategy_snapshot_parameter_contract CHECK (
      parameter_contract_json = '{"symbol":1,"ttlInterval":2,"evaluationTs":3}'::jsonb
    ),
    CONSTRAINT compiled_strategy_snapshot_hash_unique UNIQUE (content_hash_bin)
);

CREATE OR REPLACE FUNCTION reject_compiled_strategy_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'compiled_strategy_snapshot is immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_compiled_strategy_snapshot_immutable ON compiled_strategy_snapshot;
CREATE TRIGGER trg_compiled_strategy_snapshot_immutable
BEFORE UPDATE OR DELETE ON compiled_strategy_snapshot
FOR EACH ROW EXECUTE FUNCTION reject_compiled_strategy_snapshot_mutation();

CREATE INDEX IF NOT EXISTS idx_compiled_strategy_snapshot_strategy
  ON compiled_strategy_snapshot(strategy_id, activated_at DESC);

ALTER TABLE live_deployment
  ADD COLUMN IF NOT EXISTS compiled_strategy_snapshot_id UUID
  REFERENCES compiled_strategy_snapshot(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_live_deployment_compiled_snapshot
  ON live_deployment(compiled_strategy_snapshot_id)
  WHERE compiled_strategy_snapshot_id IS NOT NULL;

COMMENT ON TABLE compiled_strategy_snapshot IS
  'Content-addressed immutable PIT SQL artifact. Replay executes stored SQL without recompiling historical specs.';
COMMENT ON COLUMN live_deployment.compiled_strategy_snapshot_id IS
  'Exact compiler artifact used when deployment was activated; null only for deployments predating migration 154.';
