-- Migration 186: EXCLUDE quarantine decisions remove the candle from canonical reads.
--
-- Decision semantics for market.candles_1m_canonical:
--   KEEP + approved      -> candle included (verified acceptable)
--   REPLACED             -> candle included until superseded_by points at its
--                           replacement evidence (future wiring)
--   EXCLUDE + approved   -> candle intentionally omitted (verified corrupt);
--                           the omitted minute reads as a data hole, not an
--                           unresolved anomaly
--   UNKNOWN / undecided  -> candle remains in the view; the trusted-window
--                           certification gate blocks any island containing it
--                           (fail-closed for unresolved rows)
-- Only decisions made by a human reviewer (approved_by IS NOT NULL) take
-- effect; unapproved EXCLUDE rows change nothing.

BEGIN;

CREATE OR REPLACE VIEW market.candles_1m_canonical AS
 SELECT c.symbol,
    c.ts,
    c.o,
    c.h,
    c.l,
    c.c,
    c.v,
    c.spread,
    c.broker,
    c.digits,
    p.policy_id,
    raw.effective_broker_identity(c.broker) AS effective_broker_identity
   FROM candles_1m c
     JOIN LATERAL ( SELECT p_1.policy_id,
            p_1.broker_id
           FROM raw.symbol_broker_policy p_1
          WHERE p_1.symbol = c.symbol AND p_1.effective_from <= c.ts AND (p_1.effective_to IS NULL OR c.ts < p_1.effective_to)
          ORDER BY p_1.priority
         LIMIT 1) p ON p.broker_id = raw.effective_broker_identity(c.broker)
  WHERE NOT EXISTS (
    SELECT 1
      FROM candle_quarantine q
     WHERE q.symbol = c.symbol
       AND q.timeframe = '1m'
       AND q.event_time = c.ts
       AND q.broker IN (c.broker, raw.effective_broker_identity(c.broker))
       AND q.superseded_at IS NULL
       AND q.decision = 'EXCLUDE'
       AND q.approved_at IS NOT NULL
       AND q.approved_by IS NOT NULL
  );

COMMENT ON VIEW market.candles_1m_canonical IS
 'Canonical 1m candles. Approved EXCLUDE quarantine decisions omit the candle (verified corrupt, reads as a hole). UNKNOWN/undecided rows are NOT filtered here; they block trusted-window certification instead (fail-closed).';

COMMIT;
