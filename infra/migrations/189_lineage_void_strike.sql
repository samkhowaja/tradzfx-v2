-- Migration 189: void-and-strike corrections for candle_producer_lineage.
--
-- Lineage rows remain append-only as FACTS. Corrections are immutable void
-- markers: an UPDATE may ONLY set voided_at (NULL -> non-NULL) + void_reason
-- on a previously-unvoided row, changing no other column. DELETE stays
-- rejected. INSERT unchanged. The mistake stays visible forever.
--
-- Consumers MUST filter `voided_at IS NULL` when treating rows as valid
-- lineage. Voided rows are evidence of error, not provenance.

BEGIN;

ALTER TABLE market.candle_producer_lineage
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE OR REPLACE FUNCTION market.reject_candle_producer_lineage_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'candle producer lineage is append-only; DELETE forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Permitted only: void a previously-unvoided row, setting voided_at +
    -- void_reason, with every other column byte-identical.
    IF OLD.voided_at IS NULL
       AND NEW.voided_at IS NOT NULL
       AND NEW.void_reason IS NOT NULL
       AND NEW.lineage_id IS NOT DISTINCT FROM OLD.lineage_id
       AND NEW.symbol IS NOT DISTINCT FROM OLD.symbol
       AND NEW.broker IS NOT DISTINCT FROM OLD.broker
       AND NEW.candle_ts IS NOT DISTINCT FROM OLD.candle_ts
       AND NEW.source_key IS NOT DISTINCT FROM OLD.source_key
       AND NEW.producer_run_id IS NOT DISTINCT FROM OLD.producer_run_id
       AND NEW.manifest_name IS NOT DISTINCT FROM OLD.manifest_name
       AND NEW.manifest_sha256 IS NOT DISTINCT FROM OLD.manifest_sha256
       AND NEW.trusted_window_id IS NOT DISTINCT FROM OLD.trusted_window_id
       AND NEW.effective_broker_identity IS NOT DISTINCT FROM OLD.effective_broker_identity
       AND NEW.policy_id IS NOT DISTINCT FROM OLD.policy_id
       AND NEW.recorded_at IS NOT DISTINCT FROM OLD.recorded_at
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'candle producer lineage is append-only; only voiding (voided_at+void_reason) is allowed';
  END IF;

  RETURN NEW; -- INSERT
END $$;

COMMENT ON COLUMN market.candle_producer_lineage.voided_at IS
  'Non-NULL => row is voided (false/erroneous lineage). Consumers must filter voided_at IS NULL. Voiding is the only permitted UPDATE.';
COMMENT ON COLUMN market.candle_producer_lineage.void_reason IS
  'Human/audit reason the row was voided, e.g. FALSE_PROVENANCE: bound to feature-consumer runs, not ingestion lineage.';

COMMIT;
