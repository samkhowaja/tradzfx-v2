-- Migration 190: append-only ingestion run ledger + reverification evidence tier.
--
-- candle_ingestion_runs: immutable identity for every ingestion batch (live EA,
-- MT5 CopyRates replay, CSV backfill, on-demand artifact). Each run is
-- replayable: source_system + artifact/config pointers + engine version.
-- Core identity fields are never updated; status transitions only.
--
-- candle_reverification_evidence: independent consistency proofs (CopyRates
-- re-read, artifact hash match, cross-broker check). NEVER joins lineage gates.
-- Strengthens provenance; does not conflate with ingestion lineage.
--
-- Additive-only. No destructive SQL.

BEGIN;

CREATE TABLE IF NOT EXISTS market.candle_ingestion_runs (
  run_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_system   TEXT NOT NULL,            -- 'mt5-ea' | 'copyrates' | 'csv-backfill' | 'ondemand-artifact'
  symbol          TEXT NOT NULL,
  timeframe       TEXT NOT NULL,            -- '1m'
  broker          TEXT NOT NULL,
  batch_start_ts  TIMESTAMPTZ NOT NULL,     -- requested window start (UTC)
  batch_end_ts    TIMESTAMPTZ NOT NULL,     -- requested window end (UTC)
  raw_span_min_ts TIMESTAMPTZ,              -- actual earliest candle ts in batch
  raw_span_max_ts TIMESTAMPTZ,              -- actual latest candle ts in batch
  artifact_id     UUID,                     -- FK market.candle_source_artifacts (ondemand path)
  artifact_sha256 TEXT CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$'),
  spool_file      TEXT,                     -- EA spool filename when replayed from spool
  terminal_login  BIGINT,
  terminal_server TEXT,
  engine_ver      TEXT NOT NULL,            -- ingestion code version
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed','partial')),
  rows_seen       INT,
  rows_inserted   INT,
  rows_rejected   INT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  params          JSONB,                    -- copyrates window, tz offset, digit config
  notes           TEXT,
  CHECK (batch_end_ts > batch_start_ts)
);

CREATE INDEX IF NOT EXISTS idx_cir_lookup
  ON market.candle_ingestion_runs(symbol, timeframe, broker, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cir_artifact
  ON market.candle_ingestion_runs(artifact_id) WHERE artifact_id IS NOT NULL;

-- Append-only: core identity immutable. Status/metrics may transition once
-- (running -> terminal), but never the identity/evidence fields.
CREATE OR REPLACE FUNCTION market.reject_candle_ingestion_runs_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'candle_ingestion_runs is append-only: DELETE rejected';
  END IF;
  -- UPDATE: allow only running -> terminal status + completion metrics.
  IF OLD.status = 'running'
     AND NEW.status IN ('success','failed','partial')
     AND NEW.run_id          IS NOT DISTINCT FROM OLD.run_id
     AND NEW.source_system   IS NOT DISTINCT FROM OLD.source_system
     AND NEW.symbol          IS NOT DISTINCT FROM OLD.symbol
     AND NEW.timeframe       IS NOT DISTINCT FROM OLD.timeframe
     AND NEW.broker          IS NOT DISTINCT FROM OLD.broker
     AND NEW.batch_start_ts  IS NOT DISTINCT FROM OLD.batch_start_ts
     AND NEW.batch_end_ts    IS NOT DISTINCT FROM OLD.batch_end_ts
     AND NEW.artifact_id     IS NOT DISTINCT FROM OLD.artifact_id
     AND NEW.artifact_sha256 IS NOT DISTINCT FROM OLD.artifact_sha256
     AND NEW.terminal_login  IS NOT DISTINCT FROM OLD.terminal_login
     AND NEW.terminal_server IS NOT DISTINCT FROM OLD.terminal_server
     AND NEW.engine_ver      IS NOT DISTINCT FROM OLD.engine_ver
     AND NEW.started_at      IS NOT DISTINCT FROM OLD.started_at
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'candle_ingestion_runs: only running->terminal status transition allowed';
END $$;

DROP TRIGGER IF EXISTS candle_ingestion_runs_append_only ON market.candle_ingestion_runs;
CREATE TRIGGER candle_ingestion_runs_append_only
  BEFORE UPDATE OR DELETE ON market.candle_ingestion_runs
  FOR EACH ROW EXECUTE FUNCTION market.reject_candle_ingestion_runs_mutation();

COMMENT ON TABLE market.candle_ingestion_runs IS
  'Append-only ingestion batch ledger. Every candle batch (live EA, CopyRates replay, CSV backfill, on-demand) registers a run before writing candles. candle_producer_lineage.ingestion_run_id FK targets this. Replayable: source_system + artifact + engine_ver + params.';

-- Reverification evidence: independent consistency proofs. NEVER a lineage gate input.
CREATE TABLE IF NOT EXISTS market.candle_reverification_evidence (
  evidence_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol         TEXT NOT NULL,
  timeframe      TEXT NOT NULL,
  anchor_ts      TIMESTAMPTZ NOT NULL,
  broker         TEXT NOT NULL,
  check_type     TEXT NOT NULL CHECK (check_type IN (
    'COPYRATES_MATCH','ARTIFACT_HASH_MATCH','CROSS_BROKER_CONSISTENT','DETACHED_REPLAY_MATCH')),
  evidence_source TEXT NOT NULL,            -- terminal id / artifact id / api endpoint
  evidence_ts    TIMESTAMPTZ NOT NULL DEFAULT now(),
  detector_version TEXT,
  result         TEXT NOT NULL CHECK (result IN ('CONFIRMED','INCONSISTENT','UNKNOWN')),
  details_json   JSONB,
  UNIQUE (symbol, timeframe, anchor_ts, broker, check_type, evidence_source)
);

CREATE INDEX IF NOT EXISTS idx_cre_lookup
  ON market.candle_reverification_evidence(symbol, timeframe, anchor_ts);

COMMENT ON TABLE market.candle_reverification_evidence IS
  'Independent consistency proofs (CopyRates re-read, artifact hash, cross-broker). NEVER joins candle_producer_lineage gates. Strengthens provenance without conflating with ingestion lineage.';

COMMIT;
