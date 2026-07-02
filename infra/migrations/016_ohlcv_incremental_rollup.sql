-- Incremental rollup function for pre-aggregated OHLCV tables.
-- Called by the ingestion API after a batch of 1m candles is inserted/updated.
-- Only buckets that have at least one affected 1m row are recomputed.

CREATE OR REPLACE FUNCTION tm_refresh_candle_aggregates(
  p_symbol TEXT,
  p_min_ts TIMESTAMPTZ,
  p_max_ts TIMESTAMPTZ
) RETURNS void LANGUAGE plpgsql AS $$
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
      WHERE symbol = %L
        AND ts >= %L
        AND ts <= %L
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
      p_symbol,
      p_min_ts,
      p_max_ts,
      meta.bucket_seconds,
      meta.offset_seconds
    );
    EXECUTE sql_template;
  END LOOP;
END $$;
