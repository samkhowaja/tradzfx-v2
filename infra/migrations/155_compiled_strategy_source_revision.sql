-- Separate semantic compatibility versions from exact source revision.
-- Contract versions answer compatibility; source_revision identifies build code.

ALTER TABLE compiled_strategy_snapshot
  ADD COLUMN IF NOT EXISTS source_revision TEXT NOT NULL DEFAULT 'legacy-unknown';

ALTER TABLE compiled_strategy_snapshot
  DROP CONSTRAINT IF EXISTS compiled_strategy_snapshot_source_revision_nonempty;

ALTER TABLE compiled_strategy_snapshot
  ADD CONSTRAINT compiled_strategy_snapshot_source_revision_nonempty
  CHECK (length(trim(source_revision)) > 0);

COMMENT ON COLUMN compiled_strategy_snapshot.source_revision IS
  'Exact build revision when available; semantic compatibility remains compiler_version + registry_version.';
