-- Migration 184: single DB calendar authority for trusted-window continuity.
-- Classification is deterministic and broker-aware at the API boundary. Broker
-- identity is retained for future broker-specific calendars; current policy
-- uses the shared FX week and XAUUSD maintenance schedule.

BEGIN;

CREATE OR REPLACE FUNCTION market.classify_candle_gap(
    p_symbol TEXT,
    p_broker_identity TEXT,
    p_previous_ts TIMESTAMPTZ,
    p_current_ts TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    midpoint TIMESTAMPTZ;
    dow INTEGER;
    hour_utc INTEGER;
BEGIN
    IF p_previous_ts IS NULL OR p_current_ts IS NULL OR p_current_ts <= p_previous_ts THEN
        RETURN 'NONE';
    END IF;
    IF p_current_ts - p_previous_ts <= INTERVAL '1 minute' THEN
        RETURN 'NONE';
    END IF;

    midpoint := p_previous_ts + (p_current_ts - p_previous_ts) / 2;
    dow := EXTRACT(DOW FROM midpoint AT TIME ZONE 'UTC')::INTEGER;
    hour_utc := EXTRACT(HOUR FROM midpoint AT TIME ZONE 'UTC')::INTEGER;

    IF dow = 6
       OR (dow = 0 AND hour_utc < 21)
       OR (dow = 5 AND hour_utc >= 21)
       OR (upper(p_symbol) = 'XAUUSD' AND hour_utc = 21) THEN
        IF dow = 6 OR dow = 0 OR dow = 5 THEN
            RETURN 'EXPECTED_WEEKEND';
        END IF;
        RETURN 'EXPECTED_DAILY_BREAK';
    END IF;
    RETURN 'UNEXPECTED';
END;
$$;

COMMENT ON FUNCTION market.classify_candle_gap(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Canonical calendar classification for candle continuity; broker identity retained for policy evolution.';

COMMIT;
