-- Migration 165: preserve immutable node evidence after invalidation/expiry.
--
-- Reducer retains evidence provenance when a satisfied node becomes terminal.
-- Migration 163 incorrectly required evidence_json to be non-null iff status was
-- exactly 'satisfied', causing terminal projection writes to fail.

BEGIN;

ALTER TABLE progressive_setup_node
  DROP CONSTRAINT IF EXISTS progressive_setup_node_check;

ALTER TABLE progressive_setup_node
  ADD CONSTRAINT progressive_setup_node_evidence_status_check CHECK (
    (status <> 'satisfied' OR evidence_json IS NOT NULL)
    AND (status <> 'pending' OR evidence_json IS NULL)
  );

COMMIT;
