-- Convert candles_1m to a TimescaleDB hypertable and maintain higher
-- timeframe OHLCV candles as real-time continuous aggregates.

-- 1. Hypertable for 1m candles (7-day chunks).
SELECT create_hypertable(
  'candles_1m',
  'ts',
  chunk_time_interval => INTERVAL '7 days',
  migrate_data => true
);

-- 2. Drop the legacy custom rollup tables / helpers.
DROP TABLE IF EXISTS candles_5m CASCADE;
DROP TABLE IF EXISTS candles_15m CASCADE;
DROP TABLE IF EXISTS candles_1h CASCADE;
DROP TABLE IF EXISTS candles_4h CASCADE;
DROP TABLE IF EXISTS candles_1d_utc CASCADE;
DROP TABLE IF EXISTS candles_1d_ny CASCADE;
DROP TABLE IF EXISTS candle_aggregate_meta CASCADE;
DROP FUNCTION IF EXISTS tm_refresh_candle_aggregates(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) CASCADE;
DROP FUNCTION IF EXISTS tm_time_bucket(INT, TIMESTAMPTZ, INT) CASCADE;

-- 3. Continuous aggregates (real-time aggregation enabled).
CREATE MATERIALIZED VIEW candles_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  time_bucket(INTERVAL '5 minutes', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, time_bucket(INTERVAL '5 minutes', ts)
WITH NO DATA;

CREATE MATERIALIZED VIEW candles_15m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  time_bucket(INTERVAL '15 minutes', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, time_bucket(INTERVAL '15 minutes', ts)
WITH NO DATA;

CREATE MATERIALIZED VIEW candles_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  time_bucket(INTERVAL '1 hour', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, time_bucket(INTERVAL '1 hour', ts)
WITH NO DATA;

CREATE MATERIALIZED VIEW candles_4h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  time_bucket(INTERVAL '4 hours', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, time_bucket(INTERVAL '4 hours', ts)
WITH NO DATA;

CREATE MATERIALIZED VIEW candles_1d_utc
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  time_bucket(INTERVAL '1 day', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, time_bucket(INTERVAL '1 day', ts)
WITH NO DATA;

-- NY close = 21:00 UTC. Origin is picked to align daily buckets at 21:00.
CREATE MATERIALIZED VIEW candles_1d_ny
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  time_bucket(INTERVAL '1 day', ts, '2000-01-01 21:00:00+00'::timestamptz) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, time_bucket(INTERVAL '1 day', ts, '2000-01-01 21:00:00+00'::timestamptz)
WITH NO DATA;

-- 4. Backfill all aggregates from historical 1m data.
CALL refresh_continuous_aggregate('candles_5m', NULL, NULL);
CALL refresh_continuous_aggregate('candles_15m', NULL, NULL);
CALL refresh_continuous_aggregate('candles_1h', NULL, NULL);
CALL refresh_continuous_aggregate('candles_4h', NULL, NULL);
CALL refresh_continuous_aggregate('candles_1d_utc', NULL, NULL);
CALL refresh_continuous_aggregate('candles_1d_ny', NULL, NULL);

-- 5. Refresh policies keep the materializations warm incrementally.
--    Real-time aggregation covers the latest incomplete buckets automatically.
SELECT add_continuous_aggregate_policy('candles_5m',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes');

SELECT add_continuous_aggregate_policy('candles_15m',
  start_offset => INTERVAL '1 week',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes');

SELECT add_continuous_aggregate_policy('candles_1h',
  start_offset => INTERVAL '1 month',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('candles_4h',
  start_offset => INTERVAL '3 months',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '4 hours');

SELECT add_continuous_aggregate_policy('candles_1d_utc',
  start_offset => INTERVAL '1 year',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');

SELECT add_continuous_aggregate_policy('candles_1d_ny',
  start_offset => INTERVAL '1 year',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');

-- 6. Compression on older 1m chunks (optional, saves disk).
--    Compress chunks older than 30 days.
ALTER TABLE candles_1m SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol'
);

SELECT add_compression_policy('candles_1m', INTERVAL '30 days');
