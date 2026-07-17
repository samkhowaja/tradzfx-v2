-- Migration 119: Unique partial index on setup_evaluations.context_hash.
--
-- Enables ON CONFLICT (context_hash) DO NOTHING so the backtester's
-- persistent setup-eval cache can insert idempotently without a separate
-- existence check or bloating the table with duplicate rows.

-- Drop duplicates first: keep the earliest row per non-null context_hash.
DELETE FROM setup_evaluations
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM setup_evaluations
  WHERE context_hash IS NOT NULL
  GROUP BY context_hash
)
AND context_hash IS NOT NULL;

-- Unique index: one row per context_hash (skip-dedup key).
CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_evaluations_context_hash
  ON setup_evaluations (context_hash)
  WHERE context_hash IS NOT NULL;
