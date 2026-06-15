-- TradeMentor V2 — Foundation Schema
-- PostgreSQL-compatible (no TimescaleDB extension required)
-- Uses regular tables with time-based indexes instead of hypertables

-- ── Raw candles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candles_1m (
    symbol    TEXT NOT NULL,
    ts        TIMESTAMPTZ NOT NULL,
    o         DOUBLE PRECISION NOT NULL,
    h         DOUBLE PRECISION NOT NULL,
    l         DOUBLE PRECISION NOT NULL,
    c         DOUBLE PRECISION NOT NULL,
    v         BIGINT,
    broker    TEXT,
    digits    SMALLINT,
    PRIMARY KEY (symbol, ts)
);

CREATE INDEX IF NOT EXISTS idx_candles_1m_symbol_ts ON candles_1m(symbol, ts DESC);
CREATE INDEX IF NOT EXISTS idx_candles_1m_ts ON candles_1m(ts DESC);

-- ── Features: ATR ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_atr (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    period      INT NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, period)
);

CREATE INDEX IF NOT EXISTS idx_features_atr_symbol ON features_atr(symbol, tf, ts DESC);

-- ── Features: Pivot (swing highs/lows) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_pivot (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    kind        TEXT NOT NULL,
    price       DOUBLE PRECISION NOT NULL,
    confidence  DOUBLE PRECISION,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, kind, price)
);

CREATE INDEX IF NOT EXISTS idx_features_pivot_symbol ON features_pivot(symbol, tf, ts DESC);

-- ── Features: Structure (BOS, MSS, CHoCH) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS features_structure (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    event_type  TEXT NOT NULL,
    direction   TEXT NOT NULL,
    level       DOUBLE PRECISION,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, event_type)
);

CREATE INDEX IF NOT EXISTS idx_features_structure_symbol ON features_structure(symbol, tf, ts DESC);

-- ── Features: Sweep (liquidity sweeps) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_sweep (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    direction   TEXT NOT NULL,
    level       DOUBLE PRECISION,
    extreme     DOUBLE PRECISION,
    close       DOUBLE PRECISION,
    evidence    JSONB,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, direction)
);

CREATE INDEX IF NOT EXISTS idx_features_sweep_symbol ON features_sweep(symbol, tf, ts DESC);

-- ── Features: Zone (supply/demand, FVG) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_zone (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    zone_kind   TEXT NOT NULL,
    top         DOUBLE PRECISION,
    bottom      DOUBLE PRECISION,
    fill_pct    DOUBLE PRECISION,
    tapped      BOOLEAN DEFAULT FALSE,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, zone_kind, top, bottom)
);

CREATE INDEX IF NOT EXISTS idx_features_zone_symbol ON features_zone(symbol, tf, ts DESC);

-- ── Features: Pricing (premium/discount/OTE) ────────────────────────────────
CREATE TABLE IF NOT EXISTS features_pricing (
    symbol       TEXT NOT NULL,
    tf           TEXT NOT NULL,
    ts           TIMESTAMPTZ NOT NULL,
    position     TEXT,
    fib_position TEXT,
    in_ote       BOOLEAN,
    ote_low      DOUBLE PRECISION,
    ote_high     DOUBLE PRECISION,
    engine_ver   TEXT NOT NULL DEFAULT '1.0.0',
    input_hash   TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts)
);

CREATE INDEX IF NOT EXISTS idx_features_pricing_symbol ON features_pricing(symbol, tf, ts DESC);

-- ── Features: Bias (directional bias per TF) ────────────────────────────────
CREATE TABLE IF NOT EXISTS features_bias (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    direction   TEXT NOT NULL,
    confidence  DOUBLE PRECISION,
    reason      TEXT,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts)
);

CREATE INDEX IF NOT EXISTS idx_features_bias_symbol ON features_bias(symbol, tf, ts DESC);

-- ── Features: Session ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_session (
    symbol      TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    session     TEXT NOT NULL,
    utc_hour    INT NOT NULL,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, ts)
);

CREATE INDEX IF NOT EXISTS idx_features_session_symbol ON features_session(symbol, ts DESC);

-- ── Features: Displacement ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_displacement (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    grade       TEXT NOT NULL,
    direction   TEXT NOT NULL,
    body_pct    DOUBLE PRECISION,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts)
);

CREATE INDEX IF NOT EXISTS idx_features_displacement_symbol ON features_displacement(symbol, tf, ts DESC);

-- ── Feature Cache (content-addressed, per-feature) ──────────────────────────
CREATE TABLE IF NOT EXISTS feature_cache (
    feature_name TEXT NOT NULL,
    input_hash   TEXT NOT NULL,
    output_hash  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (feature_name, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_feature_cache_created ON feature_cache(created_at DESC);

-- ── Decision Trace (unified observability) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_trace (
    run_id      TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    node_id     TEXT NOT NULL,
    node_type   TEXT NOT NULL,
    passed      BOOLEAN NOT NULL,
    reason      TEXT,
    latency_ms  INT,
    input_hash  TEXT,
    PRIMARY KEY (run_id, symbol, strategy_id, ts, node_id)
);

CREATE INDEX IF NOT EXISTS idx_decision_trace_run ON decision_trace(run_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_decision_trace_symbol ON decision_trace(symbol, strategy_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_decision_trace_ts ON decision_trace(ts DESC);

-- ── Orders (explicit state machine) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    symbol          TEXT NOT NULL,
    strategy_id     TEXT NOT NULL,
    side            TEXT NOT NULL,
    entry_type      TEXT NOT NULL,
    entry_price     DOUBLE PRECISION,
    stop_loss       DOUBLE PRECISION,
    take_profit     DOUBLE PRECISION,
    status          TEXT NOT NULL DEFAULT 'pending',
    fill_price      DOUBLE PRECISION,
    close_price     DOUBLE PRECISION,
    outcome         TEXT,
    outcome_r       DOUBLE PRECISION,
    created_at      TIMESTAMPTZ NOT NULL,
    filled_at       TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    mt5_ticket      BIGINT,
    trace_run_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_strategy ON orders(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_ts ON orders(created_at DESC);

-- ── AI Narratives (Kimi API outputs, Week 3-4) ──────────────────────────────
CREATE TABLE IF NOT EXISTS ai_narratives (
    id          BIGSERIAL PRIMARY KEY,
    symbol      TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    context     JSONB NOT NULL,
    narrative   TEXT NOT NULL,
    model       TEXT NOT NULL,
    latency_ms  INT,
    cost_usd    DOUBLE PRECISION,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_narratives_symbol ON ai_narratives(symbol, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ai_narratives_ts ON ai_narratives(ts DESC);

-- ── Schema migrations tracking ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed
INSERT INTO features_session (symbol, ts, session, utc_hour, input_hash)
VALUES ('SEED', NOW(), 'ASIA', 0, 'seed')
ON CONFLICT DO NOTHING;
DELETE FROM features_session WHERE symbol = 'SEED';
