-- Detector v2 is authoritative for current evidence. Supersede all v1 rows;
-- this is not an approval and does not mutate raw candles.
BEGIN;

UPDATE candle_quarantine
SET superseded_at = COALESCE(superseded_at, NOW()),
    superseded_by = COALESCE(superseded_by, 'candle-detector-v2-calendar')
WHERE detector_version = 'candle-detector-v1'
  AND superseded_at IS NULL;

COMMIT;
