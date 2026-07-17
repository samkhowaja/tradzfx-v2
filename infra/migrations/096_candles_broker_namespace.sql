-- Migration 096: Namespace candles_1m by broker.
--
-- Track B (D-1): the candles_1m primary key was (symbol, ts) and ignored broker,
-- so two brokers feeding the same symbol/minute overwrote each other and the
-- higher-timeframe continuous aggregates mixed broker data. This migration:
--   1. Migrates existing rows to broker 'default'.
--   2. Rebuilds candles_1m with PK (symbol, broker, ts).
--   3. Rebuilds all higher-timeframe continuous aggregates grouped by broker.
--   4. Re-enables compression with segmentby = 'symbol, broker'.

DO $$
DECLARE
  cagg_name TEXT;
BEGIN
  -- Drop continuous-aggregate refresh policies first.
  FOREACH cagg_name IN ARRAY ARRAY['candles_5m','candles_15m','candles_1h','candles_4h','candles_1d_utc','candles_1d_ny']
  LOOP
    BEGIN
      PERFORM remove_continuous_aggregate_policy(cagg_name, true);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'No refresh policy to remove for %', cagg_name;
    END;
  END LOOP;
END $$;

-- Drop compression policy so we can safely drop/recreate the hypertable.
DO $$
BEGIN
  BEGIN
    PERFORM remove_compression_policy('candles_1m', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No compression policy to remove for candles_1m';
  END;
END $$;

-- Drop old continuous aggregates (they depend on the old candles_1m definition).
DROP MATERIALIZED VIEW IF EXISTS candles_5m CASCADE;
DROP MATERIALIZED VIEW IF EXISTS candles_15m CASCADE;
DROP MATERIALIZED VIEW IF EXISTS candles_1h CASCADE;
DROP MATERIALIZED VIEW IF EXISTS candles_4h CASCADE;
DROP MATERIALIZED VIEW IF EXISTS candles_1d_utc CASCADE;
DROP MATERIALIZED VIEW IF EXISTS candles_1d_ny CASCADE;

-- Move the old hypertable out of the way.
ALTER TABLE candles_1m RENAME TO candles_1m_old;

-- Create the new broker-aware 1m table.
CREATE TABLE candles_1m (
    symbol    TEXT NOT NULL,
    ts        TIMESTAMPTZ NOT NULL,
    o         DOUBLE PRECISION NOT NULL,
    h         DOUBLE PRECISION NOT NULL,
    l         DOUBLE PRECISION NOT NULL,
    c         DOUBLE PRECISION NOT NULL,
    v         BIGINT,
    spread    DOUBLE PRECISION,
    broker    TEXT NOT NULL DEFAULT 'default',
    digits    SMALLINT,
    PRIMARY KEY (symbol, broker, ts)
);

CREATE INDEX IF NOT EXISTS idx_candles_1m_symbol_ts ON candles_1m(symbol, ts DESC);
CREATE INDEX IF NOT EXISTS idx_candles_1m_ts ON candles_1m(ts DESC);

SELECT create_hypertable(
  'candles_1m',
  'ts',
  chunk_time_interval => INTERVAL '7 days',
  migrate_data => false,
  if_not_exists => true
);

-- Migrate data. Existing NULL brokers become 'default'.
INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, spread, broker, digits)
SELECT symbol, ts, o, h, l, c, v, spread, COALESCE(broker, 'default'), digits
FROM candles_1m_old
ORDER BY ts;

-- Recreate continuous aggregates grouped by broker.
CREATE MATERIALIZED VIEW candles_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  broker,
  time_bucket(INTERVAL '5 minutes', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, broker, time_bucket(INTERVAL '5 minutes', ts)
WITH NO DATA;

CREATE MATERIALIZED VIEW candles_15m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  broker,
  time_bucket(INTERVAL '15 minutes', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, broker, time_bucket(INTERVAL '15 minutes', ts)
WITH NO DATA;

CREATE MATERIALIZED VIEW candles_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  broker,
  time_bucket(INTERVAL '1 hour', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, broker, time_bucket(INTERVAL '1 hour', ts)
WITH NO DATA;

CREATE MATERIALIZED VIEW candles_4h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  broker,
  time_bucket(INTERVAL '4 hours', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, broker, time_bucket(INTERVAL '4 hours', ts)
WITH NO DATA;

CREATE MATERIALIZED VIEW candles_1d_utc
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  broker,
  time_bucket(INTERVAL '1 day', ts) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, broker, time_bucket(INTERVAL '1 day', ts)
WITH NO DATA;

CREATE MATERIALIZED VIEW candles_1d_ny
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  symbol,
  broker,
  time_bucket(INTERVAL '1 day', ts, '2000-01-01 21:00:00+00'::timestamptz) AS ts,
  first(o, ts)  AS o,
  max(h)        AS h,
  min(l)        AS l,
  last(c, ts)   AS c,
  sum(v)::bigint AS v,
  count(*)::int AS tick_count
FROM candles_1m
GROUP BY symbol, broker, time_bucket(INTERVAL '1 day', ts, '2000-01-01 21:00:00+00'::timestamptz)
WITH NO DATA;

-- Refresh policies.
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

-- Compression.
ALTER TABLE candles_1m SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol, broker'
);

SELECT add_compression_policy('candles_1m', INTERVAL '30 days');

-- Drop the old hypertable.
DROP TABLE IF EXISTS candles_1m_old;
