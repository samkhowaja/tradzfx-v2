-- 130_policy_transition_refresh_audit.sql
-- Make every effective-dated broker policy mutation rebuild affected canonical
-- HTF buckets and leave durable arbitration evidence in same transaction.

BEGIN;

ALTER TABLE ops.broker_arbitration_runs
    DROP CONSTRAINT IF EXISTS broker_arbitration_runs_decision_check;
ALTER TABLE ops.broker_arbitration_runs
    ADD CONSTRAINT broker_arbitration_runs_decision_check
    CHECK (decision IN ('selected', 'failed_closed', 'manual_failover', 'policy_changed'));

CREATE OR REPLACE FUNCTION raw.refresh_policy_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_symbol TEXT;
    v_from TIMESTAMPTZ;
    v_to TIMESTAMPTZ;
    v_selected RECORD;
    v_old_policy_id BIGINT;
    v_new_policy_id BIGINT;
    v_old_broker_id TEXT;
    v_new_broker_id TEXT;
    v_changed_by TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_symbol := NEW.symbol;
        v_from := NEW.effective_from;
        v_new_policy_id := NEW.policy_id;
        v_new_broker_id := NEW.broker_id;
        v_changed_by := NEW.changed_by;
    ELSIF TG_OP = 'DELETE' THEN
        v_symbol := OLD.symbol;
        v_from := OLD.effective_from;
        v_old_policy_id := OLD.policy_id;
        v_old_broker_id := OLD.broker_id;
        v_changed_by := OLD.changed_by;
    ELSE
        v_symbol := NEW.symbol;
        v_from := LEAST(OLD.effective_from, NEW.effective_from);
        v_old_policy_id := OLD.policy_id;
        v_new_policy_id := NEW.policy_id;
        v_old_broker_id := OLD.broker_id;
        v_new_broker_id := NEW.broker_id;
        v_changed_by := NEW.changed_by;
    END IF;

    -- A policy transition can change every canonical minute from its earliest
    -- old/new boundary through current raw history. Explicit upper bound lets
    -- refresh_canonical_htf delete stale projections when policy now fails closed.
    SELECT COALESCE(MAX(ts) + INTERVAL '1 minute', v_from + INTERVAL '1 minute')
    INTO v_to
    FROM candles_1m
    WHERE symbol = v_symbol
      AND ts >= v_from;

    IF v_to > v_from THEN
        PERFORM * FROM market.refresh_canonical_htf(v_symbol, v_from, v_to);
    END IF;

    SELECT p.policy_id, p.broker_id
    INTO v_selected
    FROM raw.symbol_broker_policy p
    WHERE p.symbol = v_symbol
      AND p.effective_from <= NOW()
      AND (p.effective_to IS NULL OR NOW() < p.effective_to)
    ORDER BY p.priority, p.effective_from DESC
    LIMIT 1;

    INSERT INTO ops.broker_arbitration_runs (
        symbol,
        selected_broker_id,
        policy_id,
        decision,
        source_max_ts,
        details,
        finished_at,
        changed_by
    )
    VALUES (
        v_symbol,
        v_selected.broker_id,
        v_selected.policy_id,
        'policy_changed',
        CASE WHEN v_to > v_from THEN v_to - INTERVAL '1 minute' ELSE NULL END,
        jsonb_build_object(
            'operation', TG_OP,
            'affected_from', v_from,
            'affected_to', v_to,
            'old_policy_id', v_old_policy_id,
            'new_policy_id', v_new_policy_id,
            'old_broker_id', v_old_broker_id,
            'new_broker_id', v_new_broker_id
        ),
        NOW(),
        COALESCE(v_changed_by, CURRENT_USER)
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE TRIGGER trg_refresh_policy_transition
AFTER INSERT OR UPDATE OR DELETE ON raw.symbol_broker_policy
FOR EACH ROW EXECUTE FUNCTION raw.refresh_policy_transition();

COMMENT ON FUNCTION raw.refresh_policy_transition() IS
    'Transactional owner for policy mutation effects: rebuilds every affected canonical HTF projection and records policy_changed arbitration evidence.';

COMMIT;
