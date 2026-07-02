-- Deduplicate setup_evaluations for rows tied to an order and enforce a unique
-- partial index so recordSetupEvaluation can use an explicit ON CONFLICT target.

-- 1. Remove duplicate rows that share an order_id, keeping the earliest inserted row.
DELETE FROM setup_evaluations
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM setup_evaluations
  WHERE order_id IS NOT NULL
  GROUP BY symbol, tf, ts, direction, order_id
)
AND order_id IS NOT NULL;

-- 2. Unique partial index: one setup snapshot per (symbol, tf, ts, direction, order_id)
-- when an order is associated. Rows without an order_id are allowed to repeat.
CREATE UNIQUE INDEX IF NOT EXISTS setup_evaluations_unique_order_setup
  ON setup_evaluations (symbol, tf, ts, direction, order_id)
  WHERE order_id IS NOT NULL;
