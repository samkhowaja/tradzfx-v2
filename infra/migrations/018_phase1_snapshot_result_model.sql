-- TradeMentor V2 — Phase 1: Snapshot / Result / Live Pipeline Tables
-- Reproducible analysis + normalized live execution audit log.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Feature config snapshot
--    Immutable record of the feature DAG (names, versions, dependencies) used
--    for a run or live deployment. Content-addressed by sha256 hash.
CREATE TABLE IF NOT EXISTS feature_config_snapshot (
    snapshot_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_hash         TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    engine_version       TEXT NOT NULL,
    feature_definitions  JSONB NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by           TEXT,
    notes                TEXT
);

CREATE INDEX IF NOT EXISTS idx_feature_config_snapshot_hash
    ON feature_config_snapshot(content_hash);
CREATE INDEX IF NOT EXISTS idx_feature_config_snapshot_created_at
    ON feature_config_snapshot(created_at DESC);

-- 2. Strategy settings snapshot
--    Immutable record of the strategy spec + runtime overrides at a point in time.
CREATE TABLE IF NOT EXISTS strategy_settings_snapshot (
    snapshot_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_hash         TEXT NOT NULL UNIQUE,
    strategy_id          TEXT NOT NULL,
    strategy_version     TEXT NOT NULL,
    name                 TEXT NOT NULL,
    spec_json            JSONB NOT NULL,
    live_overrides_json  JSONB,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_settings_snapshot_hash
    ON strategy_settings_snapshot(content_hash);
CREATE INDEX IF NOT EXISTS idx_strategy_settings_snapshot_strategy
    ON strategy_settings_snapshot(strategy_id, created_at DESC);

-- 3. Analysis run
--    One row per backtest / walk-forward / research execution.
CREATE TABLE IF NOT EXISTS analysis_run (
    run_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_type             TEXT NOT NULL,                 -- backtest, walk_forward, monte_carlo, research
    strategy_id          TEXT NOT NULL,
    strategy_snapshot_id UUID NOT NULL REFERENCES strategy_settings_snapshot(snapshot_id),
    feature_snapshot_id  UUID NOT NULL REFERENCES feature_config_snapshot(snapshot_id),
    symbols              TEXT[] NOT NULL,
    timeframe            TEXT NOT NULL,
    start_ts             TIMESTAMPTZ NOT NULL,
    end_ts               TIMESTAMPTZ NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
    params_json          JSONB NOT NULL DEFAULT '{}',
    summary_json         JSONB,
    error_message        TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at           TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analysis_run_strategy ON analysis_run(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_run_status ON analysis_run(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_run_type ON analysis_run(run_type, created_at DESC);

-- 4. Analysis signal
--    Every signal generated during an analysis run.
CREATE TABLE IF NOT EXISTS analysis_signal (
    signal_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id               UUID NOT NULL REFERENCES analysis_run(run_id) ON DELETE CASCADE,
    symbol               TEXT NOT NULL,
    ts                   TIMESTAMPTZ NOT NULL,
    strategy_id          TEXT NOT NULL,
    side                 TEXT NOT NULL CHECK (side IN ('buy','sell')),
    entry_type           TEXT NOT NULL DEFAULT 'market',
    entry_price          DOUBLE PRECISION NOT NULL,
    stop_loss            DOUBLE PRECISION NOT NULL,
    take_profit          DOUBLE PRECISION NOT NULL,
    confidence           DOUBLE PRECISION,
    source_json          JSONB NOT NULL DEFAULT '{}',
    features_asof_ts     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analysis_signal_run ON analysis_signal(run_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_signal_symbol ON analysis_signal(symbol, ts DESC);

-- 5. Analysis trade
--    Simulated or replayed trade outcome from an analysis run.
CREATE TABLE IF NOT EXISTS analysis_trade (
    trade_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id               UUID NOT NULL REFERENCES analysis_run(run_id) ON DELETE CASCADE,
    signal_id            UUID REFERENCES analysis_signal(signal_id),
    symbol               TEXT NOT NULL,
    strategy_id          TEXT NOT NULL,
    side                 TEXT NOT NULL,
    entry_price          DOUBLE PRECISION NOT NULL,
    fill_price           DOUBLE PRECISION,
    stop_loss            DOUBLE PRECISION NOT NULL,
    take_profit          DOUBLE PRECISION NOT NULL,
    status               TEXT NOT NULL DEFAULT 'open',
    outcome              TEXT,
    outcome_r            DOUBLE PRECISION,
    open_ts              TIMESTAMPTZ NOT NULL,
    close_ts             TIMESTAMPTZ,
    close_price          DOUBLE PRECISION,
    realized_pnl         DOUBLE PRECISION,
    hold_bars            INT,
    metadata_json        JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_analysis_trade_run ON analysis_trade(run_id, open_ts DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_trade_symbol ON analysis_trade(symbol, open_ts DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_trade_outcome ON analysis_trade(outcome) WHERE outcome IS NOT NULL;

-- 6. Live deployment
--    Which strategy + feature snapshots are currently deployed live.
CREATE TABLE IF NOT EXISTS live_deployment (
    deployment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id          TEXT NOT NULL,
    strategy_snapshot_id UUID NOT NULL REFERENCES strategy_settings_snapshot(snapshot_id),
    feature_snapshot_id  UUID NOT NULL REFERENCES feature_config_snapshot(snapshot_id),
    mode                 TEXT NOT NULL DEFAULT 'paper',
    started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at             TIMESTAMPTZ,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    metadata_json        JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_live_deployment_active ON live_deployment(is_active, strategy_id);
CREATE INDEX IF NOT EXISTS idx_live_deployment_strategy ON live_deployment(strategy_id, started_at DESC);

-- 7. Live signal
--    A signal produced by the live pipeline before gate evaluation.
CREATE TABLE IF NOT EXISTS live_signal (
    signal_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id        UUID NOT NULL REFERENCES live_deployment(deployment_id),
    symbol               TEXT NOT NULL,
    ts                   TIMESTAMPTZ NOT NULL,
    strategy_id          TEXT NOT NULL,
    side                 TEXT NOT NULL CHECK (side IN ('buy','sell')),
    entry_type           TEXT NOT NULL DEFAULT 'market',
    entry_price          DOUBLE PRECISION NOT NULL,
    stop_loss            DOUBLE PRECISION NOT NULL,
    take_profit          DOUBLE PRECISION NOT NULL,
    confidence           DOUBLE PRECISION,
    source_json          JSONB NOT NULL DEFAULT '{}',
    gate_trace_run_id    TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_signal_deployment ON live_signal(deployment_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_live_signal_symbol ON live_signal(symbol, ts DESC);
CREATE INDEX IF NOT EXISTS idx_live_signal_trace ON live_signal(gate_trace_run_id);

-- 8. Live order
--    Approved live signal converted to an order.
CREATE TABLE IF NOT EXISTS live_order (
    order_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id            UUID NOT NULL REFERENCES live_signal(signal_id),
    deployment_id        UUID NOT NULL REFERENCES live_deployment(deployment_id),
    symbol               TEXT NOT NULL,
    strategy_id          TEXT NOT NULL,
    side                 TEXT NOT NULL,
    entry_type           TEXT NOT NULL,
    entry_price          DOUBLE PRECISION NOT NULL,
    stop_loss            DOUBLE PRECISION NOT NULL,
    take_profit          DOUBLE PRECISION NOT NULL,
    lot_size             DOUBLE PRECISION NOT NULL,
    risk_reward          DOUBLE PRECISION NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending',
    trade_mode           TEXT NOT NULL DEFAULT 'paper',
    expires_at           TIMESTAMPTZ,
    reject_reason        TEXT,
    legacy_order_id      TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at              TIMESTAMPTZ,
    acked_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_live_order_status ON live_order(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_order_signal ON live_order(signal_id);
CREATE INDEX IF NOT EXISTS idx_live_order_deployment ON live_order(deployment_id, created_at DESC);

-- 9. Live fill
--    Execution events for a live order (open fill, partial close, full close, reject).
CREATE TABLE IF NOT EXISTS live_fill (
    fill_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id             UUID NOT NULL REFERENCES live_order(order_id) ON DELETE CASCADE,
    fill_ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fill_type            TEXT NOT NULL,                -- open, partial_close, full_close, reject
    mt5_ticket           BIGINT,
    fill_price           DOUBLE PRECISION,
    fill_volume          DOUBLE PRECISION,
    realized_pnl         DOUBLE PRECISION,
    commission           DOUBLE PRECISION,
    swap                 DOUBLE PRECISION,
    metadata_json        JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_live_fill_order ON live_fill(order_id, fill_ts DESC);
CREATE INDEX IF NOT EXISTS idx_live_fill_ticket ON live_fill(mt5_ticket) WHERE mt5_ticket IS NOT NULL;
