-- Execution-profile columns for the orders table.
-- Supports server-side pre-trade quality decisions and rich EA instructions.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS execution_strategy TEXT,
    ADD COLUMN IF NOT EXISTS limit_price DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS max_entry_drift_pips DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS min_effective_rr DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS time_in_force TEXT,
    ADD COLUMN IF NOT EXISTS actual_rr DOUBLE PRECISION;

-- Backfill existing rows with sensible defaults so the API never returns nulls.
UPDATE orders
SET execution_strategy = COALESCE(execution_strategy, entry_type),
    max_entry_drift_pips = COALESCE(max_entry_drift_pips, 2.0),
    min_effective_rr = COALESCE(min_effective_rr, 1.0),
    time_in_force = COALESCE(time_in_force, 'GTC')
WHERE execution_strategy IS NULL;
