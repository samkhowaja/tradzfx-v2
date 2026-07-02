-- 075_strategy_families_and_variants.sql
-- Replaces the old suffix-based family grouping with explicit family + variant tables.
-- Cleans old strategy/trade data so the user can rebuild strategies from scratch.

BEGIN;

-- Top-level strategy family
CREATE TABLE IF NOT EXISTS strategy_families (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    category      TEXT,
    base_spec     JSONB NOT NULL DEFAULT '{}',
    is_archived   BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Variant of a family
CREATE TABLE IF NOT EXISTS strategy_variants (
    id              TEXT PRIMARY KEY,
    family_id       TEXT NOT NULL REFERENCES strategy_families(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    overrides       JSONB NOT NULL DEFAULT '{}',
    symbols         TEXT[] NOT NULL DEFAULT '{}',
    timeframes      TEXT[] NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_variants_family_id ON strategy_variants(family_id);
CREATE INDEX IF NOT EXISTS idx_strategy_variants_is_active ON strategy_variants(is_active);

-- Link orders to variants going forward
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES strategy_variants(id);

CREATE INDEX IF NOT EXISTS idx_orders_variant_id ON orders(variant_id);

-- Clean slate: remove old strategy specs, orders, and audit data.
-- This matches the user's request to start from scratch.
TRUNCATE TABLE strategy_specs CASCADE;
TRUNCATE TABLE orders, setup_evaluations, backtest_results, backtest_runs,
              position_commands, decision_trace, live_signal_rejection,
              live_fill, live_order, live_signal
              CASCADE;

COMMIT;
