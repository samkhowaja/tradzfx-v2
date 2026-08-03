-- Broker-aware candle quarantine. Raw candles remain immutable.
BEGIN;

CREATE TABLE IF NOT EXISTS candle_quarantine (
    id BIGSERIAL PRIMARY KEY,
    symbol TEXT NOT NULL,
    broker TEXT NOT NULL,
    timeframe TEXT NOT NULL DEFAULT '1m',
    event_time TIMESTAMPTZ NOT NULL,
    raw_source_key TEXT NOT NULL,
    flags TEXT[] NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    detector_version TEXT NOT NULL,
    detector_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by TEXT,
    decision TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (decision IN ('KEEP','EXCLUDE','REPLACED','UNKNOWN')),
    notes TEXT,
    UNIQUE (symbol, broker, timeframe, event_time, detector_version)
);

CREATE INDEX IF NOT EXISTS idx_candle_quarantine_lookup
    ON candle_quarantine(symbol, timeframe, event_time);
CREATE INDEX IF NOT EXISTS idx_candle_quarantine_unresolved
    ON candle_quarantine(symbol, timeframe, event_time)
    WHERE approved_at IS NULL OR decision = 'UNKNOWN';

COMMENT ON TABLE candle_quarantine IS
    'Evidence and approval decisions for suspicious broker candles. Raw candles are never mutated.';

CREATE OR REPLACE VIEW market.candles_1m_canonical AS
SELECT c.symbol, c.ts, c.o, c.h, c.l, c.c, c.v, c.spread, c.broker, c.digits,
       p.policy_id
FROM candles_1m c
JOIN LATERAL (
    SELECT policy_id, broker_id
    FROM raw.symbol_broker_policy p
    WHERE p.symbol = c.symbol
      AND p.effective_from <= c.ts
      AND (p.effective_to IS NULL OR c.ts < p.effective_to)
    ORDER BY p.priority ASC
    LIMIT 1
) p ON p.broker_id = c.broker
WHERE NOT EXISTS (
    SELECT 1
    FROM candle_quarantine q
    WHERE q.symbol = c.symbol
      AND q.broker = c.broker
      AND q.timeframe = '1m'
      AND q.event_time = c.ts
      AND (q.approved_at IS NULL OR q.decision IN ('UNKNOWN', 'EXCLUDE'))
);

COMMIT;
