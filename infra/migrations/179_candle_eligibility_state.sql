-- Explicit point-in-time candle eligibility. Raw candles remain immutable.
BEGIN;

CREATE SCHEMA IF NOT EXISTS market;

CREATE TABLE IF NOT EXISTS market.candle_eligibility (
    symbol TEXT NOT NULL,
    broker TEXT NOT NULL,
    timeframe TEXT NOT NULL DEFAULT '1m',
    ts TIMESTAMPTZ NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('PERSISTED','VALIDATING','CLEAN','BLOCKED','ERROR')),
    validator_version TEXT,
    policy_id BIGINT,
    evidence_fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    validation_started_at TIMESTAMPTZ,
    validation_completed_at TIMESTAMPTZ,
    error_message TEXT,
    PRIMARY KEY (symbol, broker, timeframe, ts)
);

CREATE INDEX IF NOT EXISTS idx_candle_eligibility_state
  ON market.candle_eligibility(symbol, timeframe, ts, state);

-- Do not bulk-backfill historical rows here. Large raw histories can exceed the
-- migration statement timeout. Historical validation must run through workers;
-- absent eligibility rows remain invisible to canonical reads.

CREATE OR REPLACE VIEW market.candles_1m_canonical AS
SELECT c.symbol, c.ts, c.o, c.h, c.l, c.c, c.v, c.spread, c.broker, c.digits,
       p.policy_id
FROM candles_1m c
JOIN LATERAL (
  SELECT policy_id, broker_id FROM raw.symbol_broker_policy p
  WHERE p.symbol=c.symbol AND p.effective_from <= c.ts
    AND (p.effective_to IS NULL OR c.ts < p.effective_to)
  ORDER BY p.priority ASC, p.effective_from DESC, p.policy_id DESC LIMIT 1
) p ON p.broker_id=c.broker
JOIN market.candle_eligibility e
  ON e.symbol=c.symbol AND e.broker=c.broker AND e.timeframe='1m' AND e.ts=c.ts
 AND e.state='CLEAN' AND e.policy_id=p.policy_id;

COMMIT;
