-- 089_backtest_results_heat.sql
-- Add portfolio-heat post-pass columns to backtest_results.
-- Heat is evaluated as a post-pass so raw trades are always persisted,
-- and dropped trades can be excluded from reporting.

BEGIN;

ALTER TABLE backtest_results
    ADD COLUMN IF NOT EXISTS heat_dropped BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS heat_run_id TEXT;

CREATE INDEX IF NOT EXISTS idx_backtest_results_heat_run_id
    ON backtest_results (heat_run_id)
    WHERE heat_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_results_heat_dropped
    ON backtest_results (run_id, heat_dropped)
    WHERE heat_dropped = true;

COMMIT;
