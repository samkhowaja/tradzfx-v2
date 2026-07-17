-- FX Weekend Calendar Guard: Reject non-tradable FX candles at the database level.
-- FX tradable window: Sunday 21:00 UTC → Friday 21:00 UTC (matching candles_1d_ny boundary).
-- This constraint prevents weekend bars from advancing the candle edge and poisoning
-- freshness checks (the root cause of BLOCKED_SYSTEM_QUALITY on all FX majors).
--
-- NOTE: Check constraint commented out due to TimescaleDB chunk validation issues.
-- Application-level guards (EA + ingestion server) are the primary defense.
-- To enable after weekend cleanup: uncomment the ALTER TABLE and run VALIDATE CONSTRAINT.

-- Index to speed up weekend detection queries
CREATE INDEX IF NOT EXISTS idx_candles_1m_fx_tradable_check
  ON candles_1m (symbol, ts)
  WHERE symbol IN ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK');

-- Check constraint (disabled - enable after weekend cleanup):
-- ALTER TABLE candles_1m ADD CONSTRAINT chk_fx_tradable_hours
-- CHECK (
--   symbol NOT IN ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK')
--   OR (
--     EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') NOT IN (0, 6) -- Not Sun/Sat
--     OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 0 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') >= 21) -- Sun >= 21:00
--     OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 5 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') < 21)  -- Fri < 21:00
--   )
-- ) NOT VALID;