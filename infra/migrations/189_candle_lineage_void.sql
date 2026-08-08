-- Migration 189: void-and-strike corrections for candle producer lineage.
-- Additive-only. Append-only contract preserved:
--   - INSERT unchanged
--   - DELETE still rejected
--   - UPDATE permitted ONLY when it voids a previously-unvoided row
--     (voided_at NULL -> non-NULL, void_reason set) and changes nothing else.
-- The mistake stays visible; correction is itself an immutable event.

BEGIN;

ALTER TABLE market.candle_producer_lineage
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE OR REPLACE FUNCTION market.reject_candle_producer_lineage_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'candle_producer_lineage is append-only: DELETE rejected';
  END IF;

  -- TG_OP = 'UPDATE': allow only a pure void (strike) operation.
  IF OLD.voided_at IS NULL
     AND NEW.voided_at IS NOT NULL
     AND NEW.void_reason IS NOT NULL
     AND NEW.lineage_id                IS NOT DISTINCT FROM OLD.lineage_id
     AND NEW.symbol                    IS NOT DISTINCT FROM OLD.symbol
     AND NEW.broker                    IS NOT DISTINCT FROM OLD.broker
     AND NEW.candle_ts                 IS NOT DISTINCT FROM OLD.candle_ts
     AND NEW.source_key                IS NOT DISTINCT FROM OLD.source_key
     AND NEW.producer_run_id           IS NOT DISTINCT FROM OLD.producer_run_id
     AND NEW.manifest_name             IS NOT DISTINCT FROM OLD.manifest_name
     AND NEW.manifest_sha256           IS NOT DISTINCT FROM OLD.manifest_sha256
     AND NEW.trusted_window_id         IS NOT DISTINCT FROM OLD.trusted_window_id
     AND NEW.effective_broker_identity IS NOT DISTINCT FROM OLD.effective_broker_identity
     AND NEW.policy_id                 IS NOT DISTINCT FROM OLD.policy_id
     AND NEW.recorded_at               IS NOT DISTINCT FROM OLD.recorded_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'candle_producer_lineage is append-only: only voiding (voided_at/void_reason) is allowed';
END $$;

COMMENT ON COLUMN market.candle_producer_lineage.voided_at IS
  'Set when lineage row is voided as false provenance. Row remains as immutable audit evidence; consumers MUST filter voided_at IS NULL.';
COMMENT ON COLUMN market.candle_producer_lineage.void_reason IS
  'Machine-readable reason, e.g. FALSE_PROVENANCE: bound to feature-consumer runs, not ingestion lineage.';

COMMIT;
