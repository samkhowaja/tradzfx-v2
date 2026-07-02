-- Convert candles_1m to a TimescaleDB hypertable and maintain higher
-- timeframe OHLCV candles as real-time continuous aggregates.

-- 1. Hypertable for 1m candles (7-day chunks).
SELECT create_hypertable(
  'candles_1m',
  'ts',
  chunk_time_interval => INTERVAL '7 days',
  migrate_data => true,
  if_not_exists => true
);

-- 2. Drop the legacy custom rollup tables / helpers.
-- Only drop plain tables; if the objects have already been converted to
-- continuous aggregates we leave them in place.
DO $$
DECLARE
  rel RECORD;
BEGIN
  FOR rel IN
    SELECT relname, relkind FROM pg_class
    WHERE relname IN (
      'candles_5m','candles_15m','candles_1h','candles_4h',
      'candles_1d_utc','candles_1d_ny','candle_aggregate_meta'
    )
  LOOP
    IF rel.relkind = 'r' THEN
      EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', rel.relname);
    ELSIF rel.relkind = 'm' THEN
      RAISE NOTICE 'Leaving continuous aggregate % in place', rel.relname;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS tm_refresh_candle_aggregates(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) CASCADE;
DROP FUNCTION IF EXISTS tm_time_bucket CASCADE;

-- 3. Continuous aggregates (real-time aggregation enabled).
-- Each cagg is created only if it does not already exist, so this migration
-- remains safe to re-run on a DB where the caggs were previously created.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'candles_5m') THEN
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
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'candles_15m') THEN
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
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'candles_1h') THEN
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
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'candles_4h') THEN
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
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'candles_1d_utc') THEN
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
  END IF;

  -- NY close = 21:00 UTC. Origin is picked to align daily buckets at 21:00.
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'candles_1d_ny') THEN
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
  END IF;
END $$;

-- 4. Backfill all aggregates from historical 1m data.
-- Only refresh caggs that are empty, avoiding a full re-backfill on re-runs.
DO $$
DECLARE
  cagg_name TEXT;
  row_count BIGINT;
BEGIN
  FOREACH cagg_name IN ARRAY ARRAY['candles_5m','candles_15m','candles_1h','candles_4h','candles_1d_utc','candles_1d_ny']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = cagg_name) THEN
      EXECUTE format('SELECT COUNT(*) FROM %I', cagg_name) INTO row_count;
      IF row_count = 0 THEN
        EXECUTE format('CALL refresh_continuous_aggregate(%L, NULL, NULL)', cagg_name);
      END IF;
    END IF;
  END LOOP;
END $$;

-- 5. Refresh policies keep the materializations warm incrementally.
--    Real-time aggregation covers the latest incomplete buckets automatically.
DO $$
DECLARE
  cagg_name TEXT;
BEGIN
  FOREACH cagg_name IN ARRAY ARRAY['candles_5m','candles_15m','candles_1h','candles_4h','candles_1d_utc','candles_1d_ny']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM timescaledb_information.jobs
      WHERE proc_name = 'policy_refresh_continuous_aggregate'
        AND hypertable_name = cagg_name
    ) THEN
      CASE cagg_name
        WHEN 'candles_5m' THEN
          PERFORM add_continuous_aggregate_policy('candles_5m',
            start_offset => INTERVAL '3 days',
            end_offset => INTERVAL '1 hour',
            schedule_interval => INTERVAL '5 minutes');
        WHEN 'candles_15m' THEN
          PERFORM add_continuous_aggregate_policy('candles_15m',
            start_offset => INTERVAL '1 week',
            end_offset => INTERVAL '1 hour',
            schedule_interval => INTERVAL '15 minutes');
        WHEN 'candles_1h' THEN
          PERFORM add_continuous_aggregate_policy('candles_1h',
            start_offset => INTERVAL '1 month',
            end_offset => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour');
        WHEN 'candles_4h' THEN
          PERFORM add_continuous_aggregate_policy('candles_4h',
            start_offset => INTERVAL '3 months',
            end_offset => INTERVAL '1 hour',
            schedule_interval => INTERVAL '4 hours');
        WHEN 'candles_1d_utc' THEN
          PERFORM add_continuous_aggregate_policy('candles_1d_utc',
            start_offset => INTERVAL '1 year',
            end_offset => INTERVAL '1 day',
            schedule_interval => INTERVAL '1 day');
        WHEN 'candles_1d_ny' THEN
          PERFORM add_continuous_aggregate_policy('candles_1d_ny',
            start_offset => INTERVAL '1 year',
            end_offset => INTERVAL '1 day',
            schedule_interval => INTERVAL '1 day');
      END CASE;
    END IF;
  END LOOP;
END $$;

-- 6. Compression on older 1m chunks (optional, saves disk).
--    Compress chunks older than 30 days.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'candles_1m' AND compression_enabled = true
  ) THEN
    ALTER TABLE candles_1m SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'symbol'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.jobs
    WHERE proc_name = 'policy_compression'
      AND hypertable_name = 'candles_1m'
  ) THEN
    PERFORM add_compression_policy('candles_1m', INTERVAL '30 days');
  END IF;
END $$;
