# Read-only stale-run reaper design

Status: design only. No database writes.

Candidate selection uses `market.candle_ingestion_runs.started_at`, never `updated_at`.

A candidate requires:

- `status = 'running'`
- `started_at IS NOT NULL`
- `started_at < now() - :stale_threshold`
- no finalized run evidence
- associated pending rows counted and classified
- no superseding or terminal resolution marker

Output fields only:

- `run_id`
- `would_reap`
- `would_preserve`
- `blocked_reason`
- `pending_count`
- `started_at`
- `age_seconds`

The audit uses `REPEATABLE READ READ ONLY`. It does not update runs, delete staging rows, acquire destructive locks, or mark evidence. Production reaper implementation remains separate and requires explicit authorization.
