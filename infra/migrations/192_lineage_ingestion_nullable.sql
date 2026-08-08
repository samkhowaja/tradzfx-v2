-- 192_lineage_ingestion_nullable.sql
-- Migration 187 designed candle_producer_lineage for certification-side rows:
-- every certification column (manifest, trusted_window, policy) was NOT NULL.
-- Migration 191 added ingestion-side provenance (ingestion_run_id) and relaxed
-- producer_run_id, but left the other certification columns NOT NULL, so an
-- ingestion-provenance row cannot be inserted without faking certification
-- facts — the same false-provenance category error migration 189 voided.
--
-- An ingestion-provenance row honestly knows: symbol, broker, candle_ts,
-- source_key (channel identity), ingestion_run_id, raw_candle_id.
-- It does NOT yet know: manifest, trusted_window, policy (certification binds
-- those later when a consumer certifies the window).
--
-- This migration drops NOT NULL on the certification-side columns. Existing
-- certification rows keep their values; new ingestion rows carry NULLs there.
-- The certifier's lineage gate must NOT treat NULL certification columns as
-- satisfied lineage — gate semantics remain a separate decision.

BEGIN;

ALTER TABLE market.candle_producer_lineage ALTER COLUMN manifest_name DROP NOT NULL;
ALTER TABLE market.candle_producer_lineage ALTER COLUMN manifest_sha256 DROP NOT NULL;
ALTER TABLE market.candle_producer_lineage ALTER COLUMN trusted_window_id DROP NOT NULL;
ALTER TABLE market.candle_producer_lineage ALTER COLUMN effective_broker_identity DROP NOT NULL;
ALTER TABLE market.candle_producer_lineage ALTER COLUMN policy_id DROP NOT NULL;

-- Guard: a row must be bound to at least one run side — ingestion or consumer.
-- Prevents rows with neither provenance anchor.
ALTER TABLE market.candle_producer_lineage
  ADD CONSTRAINT candle_lineage_some_run
  CHECK (producer_run_id IS NOT NULL OR ingestion_run_id IS NOT NULL);

-- Guard: manifest_sha256 format still enforced when present.
-- (existing CHECK on manifest_sha256 already permits only 64-hex; NULL ok)

COMMIT;
