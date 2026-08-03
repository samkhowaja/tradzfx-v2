-- Supersede detector evidence removed by newer detector versions.
-- Superseded evidence is not approval; raw candles remain immutable.
BEGIN;

ALTER TABLE candle_quarantine
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by TEXT;

CREATE INDEX IF NOT EXISTS idx_candle_quarantine_active_blocking
  ON candle_quarantine(symbol, broker, timeframe, event_time)
  WHERE superseded_at IS NULL AND (approved_at IS NULL OR decision <> 'KEEP');

UPDATE candle_quarantine old
SET superseded_at = NOW(),
    superseded_by = 'candle-detector-v2-calendar'
WHERE old.detector_version = 'candle-detector-v1'
  AND old.superseded_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM candle_quarantine current
    WHERE current.detector_version = 'candle-detector-v2-calendar'
      AND current.symbol = old.symbol
      AND current.broker = old.broker
      AND current.timeframe = old.timeframe
      AND current.event_time = old.event_time
  );

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
      AND q.superseded_at IS NULL
      AND (q.approved_at IS NULL OR q.decision <> 'KEEP')
);

COMMIT;
