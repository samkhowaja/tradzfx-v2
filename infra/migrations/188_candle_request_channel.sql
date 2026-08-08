-- 188_candle_request_channel.sql
-- LINEAGE-06: on-demand candle request channel (app -> EA -> CopyRates -> artifact).
-- Creates the first PROVEN-class provenance domain for candles: every imported bar
-- can be bound to a hashed request/response artifact from a specific terminal.
-- Non-destructive: new tables only.

BEGIN;

CREATE TABLE IF NOT EXISTS market.candle_requests (
  request_id      uuid PRIMARY KEY,
  symbol          text NOT NULL,
  timeframe       text NOT NULL DEFAULT '1m',
  from_utc        timestamptz NOT NULL,
  to_utc          timestamptz NOT NULL,
  purpose         text NOT NULL,            -- gap_fill | verification | forensic
  requested_by    text NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','fulfilled','failed','expired')),
  response_count  int,
  terminal_login  text,
  terminal_server text,
  responded_at    timestamptz,
  error           text,
  CHECK (to_utc > from_utc)
);
CREATE INDEX IF NOT EXISTS candle_requests_status_idx ON market.candle_requests (status, requested_at);

CREATE TABLE IF NOT EXISTS market.candle_source_artifacts (
  artifact_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES market.candle_requests(request_id),
  symbol          text NOT NULL,
  timeframe       text NOT NULL,
  from_utc        timestamptz NOT NULL,
  to_utc          timestamptz NOT NULL,
  bar_count       int NOT NULL,
  payload_sha256  text NOT NULL,            -- SHA-256 of canonical response payload JSON
  payload         jsonb NOT NULL,           -- raw bars as returned by the terminal
  terminal_login  text NOT NULL,
  terminal_server text NOT NULL,
  terminal_build  text,
  retrieved_at    timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, payload_sha256)
);

-- Bar-level lineage: binds one raw candles_1m row to the artifact that proved it.
-- Append-only; rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS market.candle_bar_lineage (
  lineage_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol          text NOT NULL,
  broker          text NOT NULL,
  ts              timestamptz NOT NULL,
  artifact_id     uuid NOT NULL REFERENCES market.candle_source_artifacts(artifact_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, broker, ts, artifact_id)
);
CREATE INDEX IF NOT EXISTS candle_bar_lineage_bar_idx ON market.candle_bar_lineage (symbol, broker, ts);

CREATE OR REPLACE FUNCTION market.candle_bar_lineage_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'candle_bar_lineage is append-only';
END $$;

DROP TRIGGER IF EXISTS candle_bar_lineage_no_update ON market.candle_bar_lineage;
CREATE TRIGGER candle_bar_lineage_no_update
  BEFORE UPDATE OR DELETE ON market.candle_bar_lineage
  FOR EACH ROW EXECUTE FUNCTION market.candle_bar_lineage_append_only();

COMMIT;
