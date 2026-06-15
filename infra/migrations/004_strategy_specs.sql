-- Migration 004: Strategy specs table
-- Stores strategy YAML specs in the database for live loading.

CREATE TABLE IF NOT EXISTS strategy_specs (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    version         TEXT NOT NULL,
    description     TEXT,
    spec_json       JSONB NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_specs_active ON strategy_specs(is_active);
