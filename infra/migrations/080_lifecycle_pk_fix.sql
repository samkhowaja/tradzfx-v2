-- Fix lifecycle_refresh_state primary key so it matches the per-table checkpoint
-- schema that refresh_lifecycle_for_symbol() expects.
--
-- Migration 043 attempted to migrate the old single-column PK (symbol) to the
-- composite PK (symbol, table_name), but its guard only checked whether a
-- constraint named lifecycle_refresh_state_pkey already existed. Because the
-- old PK already had that name, the migration was skipped and the table kept
-- the single-column PK. This left the ON CONFLICT (symbol, table_name) clause
-- in the refresh functions without a matching unique constraint.

ALTER TABLE lifecycle_refresh_state
  DROP CONSTRAINT IF EXISTS lifecycle_refresh_state_pkey;

ALTER TABLE lifecycle_refresh_state
  ALTER COLUMN table_name SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'lifecycle_refresh_state'::regclass
      AND conname = 'lifecycle_refresh_state_pkey'
  ) THEN
    ALTER TABLE lifecycle_refresh_state
      ADD PRIMARY KEY (symbol, table_name);
  END IF;
END $$;
