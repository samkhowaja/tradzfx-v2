-- 082_backtest_variant_linkage.sql
-- Link backtest results/runs to strategy variants so per-variant reports can be
-- rendered inside the strategy detail view.

BEGIN;

ALTER TABLE backtest_results
    ADD COLUMN IF NOT EXISTS variant_id TEXT,
    ADD COLUMN IF NOT EXISTS family_id  TEXT,
    ADD COLUMN IF NOT EXISTS strategy_id TEXT;

CREATE INDEX IF NOT EXISTS idx_backtest_results_variant_id
    ON backtest_results(variant_id, symbol, tf, ts DESC);

CREATE INDEX IF NOT EXISTS idx_backtest_results_family_id
    ON backtest_results(family_id, symbol, tf, ts DESC);

ALTER TABLE backtest_runs
    ADD COLUMN IF NOT EXISTS variant_id TEXT,
    ADD COLUMN IF NOT EXISTS family_id  TEXT,
    ADD COLUMN IF NOT EXISTS strategy_id TEXT;

CREATE INDEX IF NOT EXISTS idx_backtest_runs_variant_id
    ON backtest_runs(variant_id, symbol, tf, generated_at DESC);

COMMIT;
