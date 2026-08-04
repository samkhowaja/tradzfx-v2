-- Append-only evidence for broker replacement review.
-- Raw candles and quarantine decisions remain immutable until separately approved.
BEGIN;

CREATE TABLE IF NOT EXISTS market.candle_replacement_evidence (
    id BIGSERIAL PRIMARY KEY,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL DEFAULT '1m',
    event_time TIMESTAMPTZ NOT NULL,
    blocked_broker TEXT NOT NULL,
    alternate_broker TEXT NOT NULL,
    blocked_source_key TEXT NOT NULL,
    alternate_source_key TEXT NOT NULL,
    blocked_ohlc JSONB NOT NULL,
    alternate_ohlc JSONB NOT NULL,
    checks JSONB NOT NULL DEFAULT '{}'::jsonb,
    detector_version TEXT NOT NULL,
    validator_version TEXT NOT NULL,
    decision TEXT NOT NULL DEFAULT 'UNKNOWN'
      CHECK (decision IN ('UNKNOWN','KEEP','EXCLUDE','REPLACED')),
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (symbol, timeframe, event_time, blocked_broker, alternate_broker, validator_version)
);

CREATE INDEX IF NOT EXISTS idx_candle_replacement_review
  ON market.candle_replacement_evidence(symbol, event_time, decision);

COMMENT ON TABLE market.candle_replacement_evidence IS
  'Append-only broker replacement evidence. Does not unblock quarantine by itself.';

COMMIT;