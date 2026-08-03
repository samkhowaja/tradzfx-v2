-- Keep canonical and backtest quarantine semantics identical.
-- Only explicitly approved KEEP rows are usable. Raw candles remain immutable.
BEGIN;

DROP INDEX IF EXISTS idx_candle_quarantine_unresolved;
CREATE INDEX IF NOT EXISTS idx_candle_quarantine_blocking
    ON candle_quarantine(symbol, broker, timeframe, event_time)
    WHERE approved_at IS NULL OR decision <> 'KEEP';

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
      AND (q.approved_at IS NULL OR q.decision <> 'KEEP')
);

COMMIT;
