-- Migration 187: append-only immutable candle producer lineage.
-- Canonical candle relations remain projections; lineage lives beside source facts.
BEGIN;

CREATE SCHEMA IF NOT EXISTS market;

CREATE TABLE IF NOT EXISTS market.candle_producer_lineage (
  lineage_id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  broker TEXT NOT NULL,
  candle_ts TIMESTAMPTZ NOT NULL,
  source_key TEXT NOT NULL,
  producer_run_id BIGINT NOT NULL REFERENCES feature_producer_runs(run_id),
  manifest_name TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  trusted_window_id BIGINT NOT NULL REFERENCES market.trusted_windows(window_id),
  effective_broker_identity TEXT NOT NULL,
  policy_id BIGINT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, broker, candle_ts, source_key, producer_run_id),
  UNIQUE (symbol, candle_ts, producer_run_id)
);

CREATE INDEX IF NOT EXISTS candle_producer_lineage_lookup
  ON market.candle_producer_lineage(symbol, candle_ts, producer_run_id);

CREATE OR REPLACE FUNCTION market.reject_candle_producer_lineage_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'candle producer lineage is append-only';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS candle_producer_lineage_append_only
  ON market.candle_producer_lineage;
CREATE TRIGGER candle_producer_lineage_append_only
  BEFORE UPDATE OR DELETE ON market.candle_producer_lineage
  FOR EACH ROW EXECUTE FUNCTION market.reject_candle_producer_lineage_mutation();

COMMENT ON TABLE market.candle_producer_lineage IS
  'Immutable append-only lineage for canonical candle source identities. Never mutable fields on canonical views.';
COMMIT;
