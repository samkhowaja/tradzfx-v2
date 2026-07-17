-- 131_quality_scored_session_failover.sql
-- Add deterministic UTC-day broker leases. Manual policies keep existing
-- behavior; session_lease policies fail closed until one audited lease exists.

BEGIN;

CREATE TABLE IF NOT EXISTS ops.broker_session_leases (
    symbol TEXT NOT NULL,
    session_start TIMESTAMPTZ NOT NULL,
    session_end TIMESTAMPTZ NOT NULL,
    broker_id TEXT NOT NULL REFERENCES raw.brokers(broker_id),
    policy_id BIGINT NOT NULL REFERENCES raw.symbol_broker_policy(policy_id),
    coverage_ratio DOUBLE PRECISION NOT NULL CHECK (coverage_ratio >= 0 AND coverage_ratio <= 1),
    lag_seconds INTEGER NOT NULL CHECK (lag_seconds >= 0),
    source_max_ts TIMESTAMPTZ NOT NULL,
    observed_minutes INTEGER NOT NULL CHECK (observed_minutes > 0),
    candidate_minutes INTEGER NOT NULL CHECK (candidate_minutes > 0),
    leased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by TEXT NOT NULL DEFAULT CURRENT_USER,
    PRIMARY KEY (symbol, session_start),
    CHECK (session_start = date_trunc('day', session_start)),
    CHECK (session_end = session_start + INTERVAL '1 day')
);

CREATE INDEX IF NOT EXISTS idx_broker_session_leases_broker
    ON ops.broker_session_leases(broker_id, session_start DESC);

CREATE OR REPLACE FUNCTION ops.arbitrate_broker_session(
    p_symbol TEXT,
    p_session_start TIMESTAMPTZ DEFAULT date_trunc('day', NOW())
)
RETURNS TABLE (
    decision TEXT,
    selected_broker_id TEXT,
    selected_policy_id BIGINT,
    coverage_ratio DOUBLE PRECISION,
    lag_seconds INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_session_start TIMESTAMPTZ := date_trunc('day', p_session_start);
    v_session_end TIMESTAMPTZ := date_trunc('day', p_session_start) + INTERVAL '1 day';
    v_observation_end TIMESTAMPTZ;
    v_observed_minutes INTEGER;
    v_existing ops.broker_session_leases%ROWTYPE;
    v_selected RECORD;
BEGIN
    IF p_symbol IS NULL OR p_symbol <> UPPER(p_symbol) THEN
        RAISE EXCEPTION 'Broker arbitration symbol must be uppercase: %', p_symbol;
    END IF;

    SELECT * INTO v_existing
    FROM ops.broker_session_leases l
    WHERE l.symbol = p_symbol
      AND l.session_start = v_session_start;

    IF FOUND THEN
        RETURN QUERY SELECT
            'selected'::text,
            v_existing.broker_id,
            v_existing.policy_id,
            v_existing.coverage_ratio,
            v_existing.lag_seconds;
        RETURN;
    END IF;

    SELECT LEAST(v_session_end, MAX(c.ts) + INTERVAL '1 minute')
    INTO v_observation_end
    FROM candles_1m c
    WHERE c.symbol = p_symbol
      AND c.ts >= v_session_start
      AND c.ts < v_session_end;

    IF v_observation_end IS NULL THEN
        INSERT INTO ops.broker_arbitration_runs (
            symbol, session_key, decision, details, finished_at, changed_by
        ) VALUES (
            p_symbol, v_session_start::text, 'failed_closed',
            jsonb_build_object('reason', 'no_observed_minutes', 'session_end', v_session_end),
            NOW(), CURRENT_USER
        );
        RETURN QUERY SELECT 'failed_closed'::text, NULL::text, NULL::bigint,
                            NULL::double precision, NULL::integer;
        RETURN;
    END IF;

    SELECT COUNT(DISTINCT c.ts)::int
    INTO v_observed_minutes
    FROM candles_1m c
    JOIN raw.brokers b ON b.broker_id = c.broker AND b.enabled
    WHERE c.symbol = p_symbol
      AND c.ts >= v_session_start
      AND c.ts < v_observation_end;

    SELECT scored.*
    INTO v_selected
    FROM (
        SELECT p.policy_id,
               p.broker_id,
               p.priority,
               COUNT(DISTINCT c.ts)::int AS candidate_minutes,
               MAX(c.ts) AS source_max_ts,
               COUNT(DISTINCT c.ts)::double precision / NULLIF(v_observed_minutes, 0) AS coverage_ratio,
               GREATEST(0, EXTRACT(EPOCH FROM ((v_observation_end - INTERVAL '1 minute') - MAX(c.ts)))::int) AS lag_seconds,
               p.min_coverage_ratio,
               p.max_lag_seconds
        FROM raw.symbol_broker_policy p
        JOIN raw.brokers b ON b.broker_id = p.broker_id AND b.enabled
        LEFT JOIN candles_1m c
          ON c.symbol = p.symbol
         AND c.broker = p.broker_id
         AND c.ts >= v_session_start
         AND c.ts < v_observation_end
        WHERE p.symbol = p_symbol
          AND p.failover_mode = 'session_lease'
          AND p.effective_from < v_session_end
          AND (p.effective_to IS NULL OR p.effective_to > v_session_start)
        GROUP BY p.policy_id, p.broker_id, p.priority,
                 p.min_coverage_ratio, p.max_lag_seconds
    ) scored
    WHERE scored.candidate_minutes > 0
      AND scored.coverage_ratio >= scored.min_coverage_ratio
      AND scored.lag_seconds <= scored.max_lag_seconds
    ORDER BY scored.priority, scored.coverage_ratio DESC,
             scored.lag_seconds, scored.broker_id
    LIMIT 1;

    IF v_selected.policy_id IS NULL THEN
        INSERT INTO ops.broker_arbitration_runs (
            symbol, session_key, decision, source_max_ts, coverage_ratio,
            details, finished_at, changed_by
        ) VALUES (
            p_symbol, v_session_start::text, 'failed_closed',
            v_observation_end - INTERVAL '1 minute', NULL,
            jsonb_build_object(
                'reason', 'no_candidate_met_thresholds',
                'observed_minutes', v_observed_minutes,
                'observation_end', v_observation_end
            ),
            NOW(), CURRENT_USER
        );
        RETURN QUERY SELECT 'failed_closed'::text, NULL::text, NULL::bigint,
                            NULL::double precision, NULL::integer;
        RETURN;
    END IF;

    INSERT INTO ops.broker_session_leases (
        symbol, session_start, session_end, broker_id, policy_id,
        coverage_ratio, lag_seconds, source_max_ts, observed_minutes,
        candidate_minutes, changed_by
    ) VALUES (
        p_symbol, v_session_start, v_session_end, v_selected.broker_id,
        v_selected.policy_id, v_selected.coverage_ratio, v_selected.lag_seconds,
        v_selected.source_max_ts, v_observed_minutes,
        v_selected.candidate_minutes, CURRENT_USER
    )
    ON CONFLICT (symbol, session_start) DO NOTHING;

    SELECT * INTO v_existing
    FROM ops.broker_session_leases l
    WHERE l.symbol = p_symbol
      AND l.session_start = v_session_start;

    INSERT INTO ops.broker_arbitration_runs (
        symbol, session_key, selected_broker_id, policy_id, decision,
        source_max_ts, coverage_ratio, details, finished_at, changed_by
    ) VALUES (
        p_symbol, v_session_start::text, v_existing.broker_id,
        v_existing.policy_id, 'selected', v_existing.source_max_ts,
        v_existing.coverage_ratio,
        jsonb_build_object(
            'lag_seconds', v_existing.lag_seconds,
            'observed_minutes', v_existing.observed_minutes,
            'candidate_minutes', v_existing.candidate_minutes,
            'session_end', v_existing.session_end
        ),
        NOW(), CURRENT_USER
    );

    PERFORM * FROM market.refresh_canonical_htf(
        p_symbol, v_session_start, LEAST(v_session_end, v_observation_end)
    );

    RETURN QUERY SELECT 'selected'::text, v_existing.broker_id,
                        v_existing.policy_id, v_existing.coverage_ratio,
                        v_existing.lag_seconds;
END;
$$;

CREATE OR REPLACE VIEW market.candles_1m_canonical AS
SELECT c.symbol, c.ts, c.o, c.h, c.l, c.c, c.v, c.spread, c.broker, c.digits,
       selected.policy_id
FROM candles_1m c
JOIN LATERAL (
    SELECT p.policy_id,
           CASE
               WHEN p.failover_mode = 'session_lease' THEN lease.broker_id
               ELSE p.broker_id
           END AS broker_id
    FROM raw.symbol_broker_policy p
    LEFT JOIN ops.broker_session_leases lease
      ON lease.symbol = p.symbol
     AND lease.session_start = date_trunc('day', c.ts)
     AND lease.policy_id = p.policy_id
     AND c.ts >= lease.session_start
     AND c.ts < lease.session_end
    WHERE p.symbol = c.symbol
      AND p.effective_from <= c.ts
      AND (p.effective_to IS NULL OR c.ts < p.effective_to)
      AND (p.failover_mode = 'manual' OR lease.policy_id IS NOT NULL)
    ORDER BY p.priority ASC
    LIMIT 1
) selected ON selected.broker_id = c.broker;

CREATE OR REPLACE PROCEDURE ops.arbitrate_broker_sessions_job(
    job_id INTEGER,
    config JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT p.symbol
        FROM raw.symbol_broker_policy p
        WHERE p.failover_mode = 'session_lease'
          AND p.effective_from < date_trunc('day', NOW()) + INTERVAL '1 day'
          AND (p.effective_to IS NULL OR p.effective_to > date_trunc('day', NOW()))
    LOOP
        PERFORM * FROM ops.arbitrate_broker_session(r.symbol, date_trunc('day', NOW()));
    END LOOP;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM timescaledb_information.jobs
        WHERE proc_schema = 'ops'
          AND proc_name = 'arbitrate_broker_sessions_job'
    ) THEN
        PERFORM add_job(
            'ops.arbitrate_broker_sessions_job',
            INTERVAL '5 minutes',
            config => '{}'::jsonb,
            initial_start => NOW() + INTERVAL '5 minutes'
        );
    END IF;
END;
$$;

COMMENT ON TABLE ops.broker_session_leases IS
    'Immutable UTC-day canonical broker choice. Primary key prevents source oscillation within a session.';
COMMENT ON FUNCTION ops.arbitrate_broker_session(TEXT, TIMESTAMPTZ) IS
    'Selects first policy-priority enabled broker meeting relative observed-minute coverage and lag thresholds; audits selection or fails closed.';
COMMENT ON PROCEDURE ops.arbitrate_broker_sessions_job(INTEGER, JSONB) IS
    'Five-minute owner that creates missing current UTC-day leases for session_lease policies.';
COMMENT ON VIEW market.candles_1m_canonical IS
    'Manual policy selects configured broker; session_lease policy emits only immutable audited lease broker rows and otherwise fails closed.';

COMMIT;
