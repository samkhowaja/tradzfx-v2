-- Reliable higher-timeframe candle layer.
-- 1. Metadata table for HTF candle coverage (used by preflight).
-- 2. Widen continuous-aggregate refresh policies so materializations cover
--    research windows, not just the last few days.

-- @reconcile: table:candle_coverage

-- ---------------------------------------------------------------------------
-- 1. Coverage metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candle_coverage (
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  source_min_ts TIMESTAMPTZ,
  source_max_ts TIMESTAMPTZ,
  expected_rows INT,
  actual_rows INT,
  coverage_ratio NUMERIC(5,4),
  has_gaps BOOLEAN DEFAULT false,
  refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (symbol, tf)
);

CREATE INDEX IF NOT EXISTS idx_candle_coverage_refreshed
  ON candle_coverage(refreshed_at);

-- ---------------------------------------------------------------------------
-- 2. Widen continuous-aggregate refresh policies.
--    The previous policies only refreshed 3 days (5m), 1 week (15m) and
--    1 month (1h) of history. Research backtests need at least 90 days,
--    so we recreate the policies with a 1-year start_offset. Real-time
--    aggregation already fills any gaps on read; this change just keeps
--    the materializations warm for common query patterns.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  cagg_name TEXT;
  start_off INTERVAL;
  end_off INTERVAL;
  sched INTERVAL;
BEGIN
  FOREACH cagg_name IN ARRAY ARRAY['candles_5m','candles_15m','candles_1h','candles_4h','candles_1d_utc','candles_1d_ny']
  LOOP
    -- Remove any existing refresh policy for this cagg.
    -- TimescaleDB 2.x API: pass the continuous-aggregate regclass (and
    -- if_exists) rather than the deprecated (text, job_id) form.
    PERFORM remove_continuous_aggregate_policy(cagg_name::regclass, if_exists => true);

    -- Recreate with a wide start_offset. end_offset is kept conservative
    -- so incomplete current buckets are handled by real-time aggregation.
    CASE cagg_name
      WHEN 'candles_5m' THEN
        start_off := INTERVAL '1 year'; end_off := INTERVAL '1 hour'; sched := INTERVAL '5 minutes';
      WHEN 'candles_15m' THEN
        start_off := INTERVAL '1 year'; end_off := INTERVAL '1 hour'; sched := INTERVAL '15 minutes';
      WHEN 'candles_1h' THEN
        start_off := INTERVAL '1 year'; end_off := INTERVAL '1 hour'; sched := INTERVAL '1 hour';
      WHEN 'candles_4h' THEN
        start_off := INTERVAL '2 years'; end_off := INTERVAL '1 hour'; sched := INTERVAL '4 hours';
      WHEN 'candles_1d_utc' THEN
        start_off := INTERVAL '3 years'; end_off := INTERVAL '1 day';  sched := INTERVAL '1 day';
      WHEN 'candles_1d_ny' THEN
        start_off := INTERVAL '3 years'; end_off := INTERVAL '1 day';  sched := INTERVAL '1 day';
    END CASE;

    PERFORM add_continuous_aggregate_policy(cagg_name::regclass,
      start_offset => start_off,
      end_offset => end_off,
      schedule_interval => sched,
      if_not_exists => true);
  END LOOP;
END $$;
