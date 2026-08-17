-- Forward-only staging for transactional candle provenance.
-- Schema-only. Does not alter migration-193 triggers or enable ingestion.
BEGIN;

CREATE TABLE IF NOT EXISTS market.pending_raw_candle_evidence (
  pending_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ingestion_run_id BIGINT NOT NULL
    REFERENCES market.candle_ingestion_runs(run_id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  broker TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe = '1m'),
  candle_ts TIMESTAMPTZ NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v BIGINT,
  spread DOUBLE PRECISION,
  digits SMALLINT,
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  hash_algorithm TEXT NOT NULL
    CHECK (hash_algorithm = 'sha256-v1-utc-canonical-number'),
  supersedes_raw_evidence_id BIGINT,
  authority_snapshot_id BIGINT NOT NULL
    REFERENCES market.candle_authority_snapshot(authority_snapshot_id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (o::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (h::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (l::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (c::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (v IS NULL OR v >= 0),
  CHECK (spread IS NULL OR spread::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (h >= l AND h >= o AND h >= c AND l <= o AND l <= c),
  UNIQUE (ingestion_run_id, source_key, candle_ts)
);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'market.pending_raw_candle_evidence'::regclass
      AND conname = 'pending_raw_candle_evidence_source_key_nonempty'
  ) THEN
    ALTER TABLE market.pending_raw_candle_evidence
      ADD CONSTRAINT pending_raw_candle_evidence_source_key_nonempty
      CHECK (btrim(source_key) <> '');
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_pending_raw_candle_evidence_run
  ON market.pending_raw_candle_evidence(ingestion_run_id, candle_ts);

COMMENT ON TABLE market.pending_raw_candle_evidence IS
  'Unpromoted immutable ingestion payload; never canonical authority. Migration 195.';

COMMIT;
