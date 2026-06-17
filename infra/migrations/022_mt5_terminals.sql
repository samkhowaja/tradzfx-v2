-- MT5 terminal registry for auto-registration and heartbeat tracking.
CREATE TABLE IF NOT EXISTS mt5_terminals (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    platform        TEXT NOT NULL,
    account_number  TEXT NOT NULL,
    broker          TEXT,
    broker_server   TEXT,
    account_type    TEXT,
    currency        TEXT,
    leverage        INTEGER,
    label           TEXT,
    balance         DOUBLE PRECISION,
    api_key         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mt5_terminals_account
    ON mt5_terminals(platform, account_number, broker_server);

CREATE INDEX IF NOT EXISTS idx_mt5_terminals_api_key
    ON mt5_terminals(api_key);
