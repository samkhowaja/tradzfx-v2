-- Migration 078: Add forward-simulation excursion columns to backtest_results.
-- These columns capture the effective entry price after spread/slippage and
-- the maximum favorable/adverse excursion in R for deeper trade analytics.

ALTER TABLE backtest_results
    ADD COLUMN IF NOT EXISTS effective_entry DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS max_adverse_r DOUBLE PRECISION DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_favorable_r DOUBLE PRECISION DEFAULT 0;
