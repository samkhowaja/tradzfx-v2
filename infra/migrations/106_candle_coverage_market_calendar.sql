-- 106_candle_coverage_market_calendar.sql
-- SK-10: make candle_coverage market-calendar-aware. Adds tradable-bar expectation,
-- gap accounting and the resolved source so coverage reflects the FX 24/5 week
-- (Sun 21:00 UTC -> Fri 21:00 UTC) instead of 24/7 wall-clock.
--
-- Non-destructive (ADD COLUMN IF NOT EXISTS) -> not blocked by the SK-51 guard;
-- existing rows keep NULL for the new columns until the next recordCandleCoverage run.

ALTER TABLE candle_coverage
  ADD COLUMN IF NOT EXISTS expected_tradable_bars INT,
  ADD COLUMN IF NOT EXISTS gap_count INT,
  ADD COLUMN IF NOT EXISTS largest_gap_minutes INT,
  ADD COLUMN IF NOT EXISTS source TEXT;
