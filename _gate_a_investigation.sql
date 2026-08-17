-- Gate A Investigation: 2 XAUUSD Quarantined Rows
-- Cross-check against candle data + market context
-- Purpose: Determine KEEP vs EXCLUDE for each row

-- Query 1: Exact candle details for the 2 flagged XAUUSD rows
SELECT 
  ts,
  open,
  high,
  low,
  close,
  (high - low) as range_price,
  (high - low) / 0.01 as range_pips,
  volume,
  EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') as hour_utc,
  EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') as day_of_week,
  broker,
  is_suspect,
  reason
FROM candles_1m
LEFT JOIN candle_quality ON candles_1m.id = candle_quality.candle_id
WHERE symbol = 'XAUUSD'
  AND ts >= '2026-07-06'::date
  AND ts < '2026-07-07'::date
  AND (high - low) / 0.01 > 900  -- Near or above 1000p threshold
ORDER BY ts ASC;

-- Query 2: Context bars (30 min before and after each suspect)
-- This helps determine if move was preceded by normal trading or sudden spike
SELECT 
  ts,
  (high - low) / 0.01 as range_pips,
  close,
  LEAD(close) OVER (ORDER BY ts) as next_close,
  LAG(close) OVER (ORDER BY ts) as prev_close,
  (LEAD(close) OVER (ORDER BY ts) - close) as next_move,
  (close - LAG(close) OVER (ORDER BY ts)) as prev_move
FROM candles_1m
WHERE symbol = 'XAUUSD'
  AND ts >= '2026-07-05 12:00'::timestamp AT TIME ZONE 'UTC'
  AND ts < '2026-07-07 12:00'::timestamp AT TIME ZONE 'UTC'
ORDER BY ts ASC;

-- Query 3: Spread at time of incident (if available)
SELECT 
  ts,
  (high - low) / 0.01 as range_pips,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (high - low) / 0.01) 
    OVER (ORDER BY ts ROWS BETWEEN 20 PRECEDING AND CURRENT ROW) as median_20m_range
FROM candles_1m
WHERE symbol = 'XAUUSD'
  AND ts >= '2026-07-06'::date
  AND ts < '2026-07-07'::date
ORDER BY ts ASC;
