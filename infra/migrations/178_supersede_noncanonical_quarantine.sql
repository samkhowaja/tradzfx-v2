-- Noncanonical broker evidence cannot block canonical projections.
-- Preserve evidence, but mark it superseded by effective broker policy.
BEGIN;

UPDATE candle_quarantine q
SET superseded_at = COALESCE(q.superseded_at, NOW()),
    superseded_by = COALESCE(q.superseded_by, 'effective-canonical-broker-policy')
WHERE q.superseded_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM raw.symbol_broker_policy p
    WHERE p.symbol = q.symbol
      AND p.broker_id = q.broker
      AND p.effective_from <= q.event_time
      AND (p.effective_to IS NULL OR q.event_time < p.effective_to)
      AND p.priority = (
        SELECT MIN(p2.priority)
        FROM raw.symbol_broker_policy p2
        WHERE p2.symbol = q.symbol
          AND p2.effective_from <= q.event_time
          AND (p2.effective_to IS NULL OR q.event_time < p2.effective_to)
      )
  );

COMMIT;
