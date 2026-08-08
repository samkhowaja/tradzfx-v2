-- Migration 191: bind candle_producer_lineage to ingestion runs.
--
-- 187 schema bound lineage to feature_producer_runs (feature-consumer runs).
-- Correct model: lineage binds each candle to the INGESTION run that produced
-- its raw row. Add ingestion_run_id FK to market.candle_ingestion_runs.
-- Keep producer_run_id for historical/voided rows (append-only; cannot alter).
-- New honest lineage rows MUST set ingestion_run_id; producer_run_id becomes
-- optional (nullable) for feature-consumer correlation only.
--
-- Additive-only.

BEGIN;

ALTER TABLE market.candle_producer_lineage
  ADD COLUMN IF NOT EXISTS ingestion_run_id BIGINT
    REFERENCES market.candle_ingestion_runs(run_id),
  ADD COLUMN IF NOT EXISTS raw_candle_id BIGINT;

-- producer_run_id (feature-consumer FK from 187) becomes optional: honest
-- lineage is keyed on ingestion_run_id; producer_run_id retained only for
-- correlation with feature-consumer runs when known.
ALTER TABLE market.candle_producer_lineage
  ALTER COLUMN producer_run_id DROP NOT NULL;

COMMENT ON COLUMN market.candle_producer_lineage.ingestion_run_id IS
  'FK to market.candle_ingestion_runs. The ingestion batch that produced this raw candle. Required for honest lineage; voided rows from 187 lack it (they were false provenance).';
COMMENT ON COLUMN market.candle_producer_lineage.raw_candle_id IS
  'FK to immutable raw candles_1m row (ctid or surrogate when available). Binds lineage to the exact raw source row.';

-- Index for certifier lineage gate join on ingestion_run_id
CREATE INDEX IF NOT EXISTS idx_cpl_ingestion_run
  ON market.candle_producer_lineage(ingestion_run_id) WHERE ingestion_run_id IS NOT NULL;

COMMIT;
