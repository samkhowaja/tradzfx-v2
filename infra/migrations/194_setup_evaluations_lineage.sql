-- Migration 194: evaluator lineage on setup_evaluations.
--
-- Rationale (parity audit 2026-08): live vs PIT backtest diverged on
-- SL/TP/confidence for the same signal (watukushay_no1 XAUUSD
-- 2026-07-22T14:00Z). The persistent setup-eval cache (migration 119,
-- context_hash) keys rows by a hash that embeds the setup-engine version,
-- but the table itself carries no explicit evaluator/strategy identity, so
-- cache provenance is unprovable and unenforceable at the schema level.
--
-- These columns make lineage explicit so the PIT cache can run in strict
-- mode: a row with NULL lineage or a mismatched evaluator/strategy version
-- is a cache miss, not a silent reuse.
--
-- Additive-only per protected-table policy: nullable columns, no NOT NULL,
-- no defaults, no indexes, no constraints, no drops.

ALTER TABLE setup_evaluations
  ADD COLUMN IF NOT EXISTS evaluator_id TEXT,
  ADD COLUMN IF NOT EXISTS evaluator_version TEXT,
  ADD COLUMN IF NOT EXISTS setup_engine_version TEXT,
  ADD COLUMN IF NOT EXISTS strategy_id TEXT,
  ADD COLUMN IF NOT EXISTS strategy_family_id TEXT,
  ADD COLUMN IF NOT EXISTS strategy_spec_version TEXT,
  ADD COLUMN IF NOT EXISTS signal_context_hash TEXT,
  ADD COLUMN IF NOT EXISTS evaluation_environment TEXT;
