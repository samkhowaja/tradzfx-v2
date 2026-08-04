-- Migration 182: preserve raw broker labels while exposing canonical broker identity.
-- Historical broker='MT5' means 1x Trade Ltd. via MT5 platform. Raw rows stay immutable.

BEGIN;

CREATE SCHEMA IF NOT EXISTS raw;

CREATE TABLE IF NOT EXISTS raw.broker_identity_correction (
    correction_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    raw_broker_value TEXT NOT NULL,
    canonical_broker TEXT NOT NULL,
    platform TEXT,
    introduced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    introduced_by TEXT NOT NULL DEFAULT CURRENT_USER,
    notes TEXT NOT NULL,
    UNIQUE (raw_broker_value, canonical_broker, platform)
);

INSERT INTO raw.broker_identity_correction
    (raw_broker_value, canonical_broker, platform, introduced_by, notes)
VALUES
    ('MT5', '1x Trade Ltd.', 'mt5', 'migration-182',
     'Historical candles labeled MT5 represent 1x Trade Ltd. server via MT5 platform; raw labels remain unchanged.'),
    ('MT4', 'OANDA Corporation', 'mt4', 'migration-182',
     'MT4 platform historical labels represent OANDA Corporation server where present; raw labels remain unchanged.')
ON CONFLICT (raw_broker_value, canonical_broker, platform) DO NOTHING;

CREATE OR REPLACE FUNCTION raw.effective_broker_identity(raw_broker TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE btrim(raw_broker)
      WHEN 'MT5' THEN '1x Trade Ltd.'
      WHEN 'MT4' THEN 'OANDA Corporation'
      ELSE NULLIF(btrim(raw_broker), '')
    END
$$;

COMMENT ON FUNCTION raw.effective_broker_identity(TEXT) IS
    'Maps legacy platform labels to broker server identity without changing raw data.';
COMMENT ON TABLE raw.broker_identity_correction IS
    'Append-only evidence for historical broker-label interpretation.';

-- Canonical arbitration compares effective identity, while output keeps raw broker
-- for traceability. Explicit raw broker reads remain raw/audit reads.
CREATE OR REPLACE VIEW market.candles_1m_canonical AS
SELECT c.symbol, c.ts, c.o, c.h, c.l, c.c, c.v, c.spread, c.broker, c.digits,
    p.policy_id,
    raw.effective_broker_identity(c.broker) AS effective_broker_identity
FROM candles_1m c
JOIN LATERAL (
    SELECT policy_id, broker_id
    FROM raw.symbol_broker_policy p
    WHERE p.symbol = c.symbol
      AND p.effective_from <= c.ts
      AND (p.effective_to IS NULL OR c.ts < p.effective_to)
    ORDER BY p.priority ASC
    LIMIT 1
) p ON p.broker_id = raw.effective_broker_identity(c.broker);

COMMIT;
