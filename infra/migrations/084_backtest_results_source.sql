-- Migration 084: Track which simulator wrote each backtest_results row.
-- The PIT runner and the analyzer-based runner have different semantics
-- (e.g., PIT hard-codes grade="A"), so mixing them silently corrupts
-- grade calibration. This column lets consumers select the source they need.

ALTER TABLE backtest_results
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'unknown';

-- Existing rows are indistinguishable, so mark them as unknown rather than
-- guess. Grade-calibration queries should filter on source='analyzer'.
UPDATE backtest_results SET source = 'unknown' WHERE source = 'unknown';

CREATE INDEX IF NOT EXISTS idx_backtest_results_source
    ON backtest_results(source, grade, outcome);
