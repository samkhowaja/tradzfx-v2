-- 129_canonical_htf_projections.sql
-- Materialize policy-correct higher-timeframe candles from canonical 1m rows.
-- Existing broker-qualified Timescale caggs remain untouched as raw evidence.

BEGIN;

CREATE SCHEMA IF NOT EXISTS market;

CREATE TABLE IF NOT EXISTS market.candles_5m_canonical (
    symbol TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    o DOUBLE PRECISION NOT NULL,
    h DOUBLE PRECISION NOT NULL,
    l DOUBLE PRECISION NOT NULL,
    c DOUBLE PRECISION NOT NULL,
    v BIGINT,
    tick_count INTEGER NOT NULL CHECK (tick_count > 0),
    policy_ids BIGINT[] NOT NULL,
    broker_ids TEXT[] NOT NULL,
    source_min_ts TIMESTAMPTZ NOT NULL,
    source_max_ts TIMESTAMPTZ NOT NULL,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (symbol, ts),
    CHECK (h >= l AND h >= GREATEST(o, c) AND l <= LEAST(o, c)),
    CHECK (source_max_ts >= source_min_ts)
);

CREATE TABLE IF NOT EXISTS market.candles_15m_canonical
    (LIKE market.candles_5m_canonical INCLUDING ALL);
CREATE TABLE IF NOT EXISTS market.candles_1h_canonical
    (LIKE market.candles_5m_canonical INCLUDING ALL);
CREATE TABLE IF NOT EXISTS market.candles_4h_canonical
    (LIKE market.candles_5m_canonical INCLUDING ALL);
CREATE TABLE IF NOT EXISTS market.candles_1d_utc_canonical
    (LIKE market.candles_5m_canonical INCLUDING ALL);
CREATE TABLE IF NOT EXISTS market.candles_1d_ny_canonical
    (LIKE market.candles_5m_canonical INCLUDING ALL);

CREATE INDEX IF NOT EXISTS idx_candles_5m_canonical_ts
    ON market.candles_5m_canonical(ts DESC);
CREATE INDEX IF NOT EXISTS idx_candles_15m_canonical_ts
    ON market.candles_15m_canonical(ts DESC);
CREATE INDEX IF NOT EXISTS idx_candles_1h_canonical_ts
    ON market.candles_1h_canonical(ts DESC);
CREATE INDEX IF NOT EXISTS idx_candles_4h_canonical_ts
    ON market.candles_4h_canonical(ts DESC);
CREATE INDEX IF NOT EXISTS idx_candles_1d_utc_canonical_ts
    ON market.candles_1d_utc_canonical(ts DESC);
CREATE INDEX IF NOT EXISTS idx_candles_1d_ny_canonical_ts
    ON market.candles_1d_ny_canonical(ts DESC);

CREATE OR REPLACE FUNCTION market.refresh_canonical_htf(
    p_symbol TEXT DEFAULT NULL,
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (projection TEXT, rows_upserted BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_source_from TIMESTAMPTZ;
    v_source_to TIMESTAMPTZ;
    v_bucket_from TIMESTAMPTZ;
    v_bucket_to TIMESTAMPTZ;
    v_rows BIGINT;
    v_bucket_expr TEXT;
BEGIN
    IF p_symbol IS NOT NULL AND p_symbol <> UPPER(p_symbol) THEN
        RAISE EXCEPTION 'Canonical HTF symbol must be uppercase: %', p_symbol;
    END IF;
    IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_to <= p_from THEN
        RAISE EXCEPTION 'Canonical HTF refresh requires p_to > p_from';
    END IF;

    SELECT COALESCE(p_from, MIN(ts)),
           COALESCE(p_to, MAX(ts) + INTERVAL '1 minute')
    INTO v_source_from, v_source_to
    FROM market.candles_1m_canonical
    WHERE p_symbol IS NULL OR symbol = p_symbol;

    IF v_source_from IS NULL OR v_source_to IS NULL THEN
        RETURN;
    END IF;

    FOR r IN
        SELECT *
        FROM (VALUES
            ('candles_5m_canonical',    INTERVAL '5 minutes',  '2000-01-01 00:00:00+00'::timestamptz),
            ('candles_15m_canonical',   INTERVAL '15 minutes', '2000-01-01 00:00:00+00'::timestamptz),
            ('candles_1h_canonical',    INTERVAL '1 hour',     '2000-01-01 00:00:00+00'::timestamptz),
            ('candles_4h_canonical',    INTERVAL '4 hours',    '2000-01-01 00:00:00+00'::timestamptz),
            ('candles_1d_utc_canonical', INTERVAL '1 day',     '2000-01-01 00:00:00+00'::timestamptz),
            ('candles_1d_ny_canonical',  INTERVAL '1 day',     '2000-01-01 21:00:00+00'::timestamptz)
        ) AS x(table_name, bucket_width, bucket_origin)
    LOOP
        v_bucket_from := time_bucket(r.bucket_width, v_source_from, r.bucket_origin);
        v_bucket_to := time_bucket(
            r.bucket_width,
            v_source_to - INTERVAL '1 microsecond',
            r.bucket_origin
        ) + r.bucket_width;
        v_bucket_expr := format(
            'time_bucket(%L::interval, ts, %L::timestamptz)',
            r.bucket_width,
            r.bucket_origin
        );

        -- Delete first so a newly missing/failed-closed policy removes stale
        -- projection rows instead of leaving old canonical data behind.
        EXECUTE format(
            'DELETE FROM market.%I
             WHERE ($1::text IS NULL OR symbol = $1)
               AND ts >= $2 AND ts < $3',
            r.table_name
        ) USING p_symbol, v_bucket_from, v_bucket_to;

        EXECUTE format(
            'INSERT INTO market.%I
                (symbol, ts, o, h, l, c, v, tick_count, policy_ids, broker_ids,
                 source_min_ts, source_max_ts, refreshed_at)
             SELECT symbol,
                    %s AS ts,
                    first(o, ts) AS o,
                    max(h) AS h,
                    min(l) AS l,
                    last(c, ts) AS c,
                    sum(v)::bigint AS v,
                    count(*)::int AS tick_count,
                    array_agg(DISTINCT policy_id ORDER BY policy_id) AS policy_ids,
                    array_agg(DISTINCT broker ORDER BY broker) AS broker_ids,
                    min(ts) AS source_min_ts,
                    max(ts) AS source_max_ts,
                    NOW() AS refreshed_at
             FROM market.candles_1m_canonical
             WHERE ($1::text IS NULL OR symbol = $1)
               AND ts >= $2 AND ts < $3
             GROUP BY symbol, %s
             ON CONFLICT (symbol, ts) DO UPDATE SET
                o = EXCLUDED.o,
                h = EXCLUDED.h,
                l = EXCLUDED.l,
                c = EXCLUDED.c,
                v = EXCLUDED.v,
                tick_count = EXCLUDED.tick_count,
                policy_ids = EXCLUDED.policy_ids,
                broker_ids = EXCLUDED.broker_ids,
                source_min_ts = EXCLUDED.source_min_ts,
                source_max_ts = EXCLUDED.source_max_ts,
                refreshed_at = EXCLUDED.refreshed_at',
            r.table_name,
            v_bucket_expr,
            v_bucket_expr
        ) USING p_symbol, v_bucket_from, v_bucket_to;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        projection := 'market.' || r.table_name;
        rows_upserted := v_rows;
        RETURN NEXT;
    END LOOP;
END;
$$;

CREATE OR REPLACE PROCEDURE market.refresh_canonical_htf_job(
    job_id INTEGER,
    config JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_lookback INTERVAL := COALESCE(
        (config ->> 'lookback')::interval,
        INTERVAL '3 days'
    );
BEGIN
    PERFORM *
    FROM market.refresh_canonical_htf(
        NULL,
        NOW() - v_lookback,
        NOW() + INTERVAL '1 minute'
    );
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM timescaledb_information.jobs
        WHERE proc_schema = 'market'
          AND proc_name = 'refresh_canonical_htf_job'
    ) THEN
        PERFORM add_job(
            'market.refresh_canonical_htf_job',
            INTERVAL '5 minutes',
            config => '{"lookback":"3 days"}'::jsonb,
            initial_start => NOW() + INTERVAL '5 minutes'
        );
    END IF;
END;
$$;

-- Initial shadow backfill. No consumer is cut over by this migration.
SELECT * FROM market.refresh_canonical_htf();

COMMENT ON FUNCTION market.refresh_canonical_htf(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
    'Idempotently rebuilds every canonical HTF bucket overlapping [p_from,p_to) directly from effective-dated canonical 1m rows.';
COMMENT ON PROCEDURE market.refresh_canonical_htf_job(INTEGER, JSONB) IS
    'Five-minute owner for open/recent canonical HTF buckets. Historical imports and policy changes call refresh_canonical_htf with an explicit affected range.';
COMMENT ON TABLE market.candles_5m_canonical IS
    'Policy-correct 5m projection from market.candles_1m_canonical; broker_ids/policy_ids preserve transition provenance.';
COMMENT ON TABLE market.candles_15m_canonical IS
    'Policy-correct 15m projection from market.candles_1m_canonical; broker_ids/policy_ids preserve transition provenance.';
COMMENT ON TABLE market.candles_1h_canonical IS
    'Policy-correct 1h projection from market.candles_1m_canonical; broker_ids/policy_ids preserve transition provenance.';
COMMENT ON TABLE market.candles_4h_canonical IS
    'Policy-correct 4h projection from market.candles_1m_canonical; broker_ids/policy_ids preserve transition provenance.';
COMMENT ON TABLE market.candles_1d_utc_canonical IS
    'Policy-correct UTC-midnight daily projection from market.candles_1m_canonical.';
COMMENT ON TABLE market.candles_1d_ny_canonical IS
    'Policy-correct fixed-21:00-UTC daily projection from market.candles_1m_canonical; auxiliary export surface.';

COMMIT;
