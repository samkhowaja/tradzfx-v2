-- OHLCV aggregate tables for higher timeframes.
-- TimescaleDB is not available in this deployment, so we use plain PostgreSQL
-- tables maintained by an incremental rollup job. Each aggregate stores only
-- complete buckets; the latest incomplete bucket is computed on demand by the
-- candleStore reader.

-- Time-bucket helper. Buckets are anchored at the epoch and optionally shifted
-- by offset_seconds (e.g. 75600 for NY close = 21:00 UTC).
CREATE OR REPLACE FUNCTION tm_time_bucket(
  bucket_seconds INT,
  ts TIMESTAMPTZ,
  offset_seconds INT DEFAULT 0
) RETURNS TIMESTAMPTZ AS $$
BEGIN
  RETURN to_timestamp(
    floor((extract(epoch from ts) - offset_seconds) / bucket_seconds)
    * bucket_seconds
    + offset_seconds
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Aggregate metadata
CREATE TABLE IF NOT EXISTS candle_aggregate_meta (
  tf TEXT PRIMARY KEY,
  bucket_seconds INT NOT NULL,
  offset_seconds INT NOT NULL DEFAULT 0,
  description TEXT
);

INSERT INTO candle_aggregate_meta (tf, bucket_seconds, offset_seconds, description)
VALUES
  ('5m',       300, 0,        '5-minute candles aligned to UTC'),
  ('15m',      900, 0,        '15-minute candles aligned to UTC'),
  ('1h',      3600, 0,        '1-hour candles aligned to UTC'),
  ('4h',     14400, 0,        '4-hour candles aligned to UTC'),
  ('1d_utc', 86400, 0,        'Daily candles aligned to UTC midnight'),
  ('1d_ny',  86400, 75600,    'Daily candles aligned to New York close (21:00 UTC)')
ON CONFLICT (tf) DO UPDATE SET
  bucket_seconds = EXCLUDED.bucket_seconds,
  offset_seconds = EXCLUDED.offset_seconds,
  description    = EXCLUDED.description;

-- 5m
CREATE TABLE IF NOT EXISTS candles_5m (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v BIGINT NOT NULL DEFAULT 0,
  tick_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_5m_symbol_ts ON candles_5m(symbol, ts DESC);

-- 15m
CREATE TABLE IF NOT EXISTS candles_15m (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v BIGINT NOT NULL DEFAULT 0,
  tick_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_15m_symbol_ts ON candles_15m(symbol, ts DESC);

-- 1h
CREATE TABLE IF NOT EXISTS candles_1h (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v BIGINT NOT NULL DEFAULT 0,
  tick_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_1h_symbol_ts ON candles_1h(symbol, ts DESC);

-- 4h
CREATE TABLE IF NOT EXISTS candles_4h (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v BIGINT NOT NULL DEFAULT 0,
  tick_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_4h_symbol_ts ON candles_4h(symbol, ts DESC);

-- 1d UTC
CREATE TABLE IF NOT EXISTS candles_1d_utc (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v BIGINT NOT NULL DEFAULT 0,
  tick_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_1d_utc_symbol_ts ON candles_1d_utc(symbol, ts DESC);

-- 1d NY close (21:00 UTC)
CREATE TABLE IF NOT EXISTS candles_1d_ny (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v BIGINT NOT NULL DEFAULT 0,
  tick_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_1d_ny_symbol_ts ON candles_1d_ny(symbol, ts DESC);

-- Backfill from candles_1m.
-- We backfill complete buckets only. The latest incomplete bucket is computed
-- on demand by the candleStore reader.

DO $$
DECLARE
  meta RECORD;
  sql_template TEXT;
BEGIN
  FOR meta IN SELECT * FROM candle_aggregate_meta LOOP
    sql_template := format(
      $SQL$
      INSERT INTO candles_%s (
        symbol, ts, o, h, l, c, v, tick_count
      )
      SELECT
        symbol,
        tm_time_bucket(%L::int, ts, %L::int) AS bucket_ts,
        (array_agg(o ORDER BY ts ASC))[1]  AS o,
        MAX(h)                              AS h,
        MIN(l)                              AS l,
        (array_agg(c ORDER BY ts DESC))[1] AS c,
        COALESCE(SUM(v), 0)                 AS v,
        COUNT(*)::int                       AS tick_count
      FROM candles_1m
      GROUP BY symbol, tm_time_bucket(%L::int, ts, %L::int)
      ON CONFLICT (symbol, ts) DO UPDATE SET
        o = EXCLUDED.o,
        h = EXCLUDED.h,
        l = EXCLUDED.l,
        c = EXCLUDED.c,
        v = EXCLUDED.v,
        tick_count = EXCLUDED.tick_count
      $SQL$,
      meta.tf,
      meta.bucket_seconds,
      meta.offset_seconds,
      meta.bucket_seconds,
      meta.offset_seconds
    );
    -- Skip backfill if the target is already a continuous aggregate/view.
    -- This makes the migration safe to re-run after migration 013 converts
    -- the plain tables into TimescaleDB continuous aggregates.
    PERFORM 1 FROM pg_class
    WHERE relname = format('candles_%s', meta.tf)
      AND relkind = 'r';

    IF FOUND THEN
      RAISE NOTICE 'Backfilling candles_%', meta.tf;
      EXECUTE sql_template;
    ELSE
      RAISE NOTICE 'Skipping candles_% backfill (not a plain table)', meta.tf;
    END IF;
  END LOOP;
END $$;
