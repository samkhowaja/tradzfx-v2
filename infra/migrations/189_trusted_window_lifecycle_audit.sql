-- Migration 189: append-only audit trail for trusted-window lifecycle changes.
BEGIN;
CREATE TABLE IF NOT EXISTS market.trusted_window_events (
  event_id BIGSERIAL PRIMARY KEY,
  window_id BIGINT NOT NULL REFERENCES market.trusted_windows(window_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created','promoted','revoked','superseded')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  detector_version TEXT NOT NULL,
  canonical_version TEXT NOT NULL,
  gate_summary_hash TEXT NOT NULL CHECK (gate_summary_hash ~ '^[0-9a-f]{64}$'),
  actor TEXT NOT NULL,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trusted_window_events_lookup
  ON market.trusted_window_events(window_id, occurred_at);
CREATE OR REPLACE FUNCTION market.reject_trusted_window_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'trusted window events are append-only'; END $$;
DROP TRIGGER IF EXISTS trusted_window_events_append_only ON market.trusted_window_events;
CREATE TRIGGER trusted_window_events_append_only
  BEFORE UPDATE OR DELETE ON market.trusted_window_events
  FOR EACH ROW EXECUTE FUNCTION market.reject_trusted_window_event_mutation();
COMMIT;