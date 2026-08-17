# Transactional Candle Provenance Finalizer

Status: design only. No database writes.

## Lock order

1. Lock `market.candle_ingestion_runs` row with `FOR UPDATE`.
2. Require `status = 'running'`.
3. Lock matching pending rows with `FOR UPDATE`.

## Validation

Require non-empty pending set. Require every row to match parent symbol, broker, timeframe, and batch bounds. Require unique `(source_key, candle_ts)`. Resolve authority using `market.resolve_candle_authority()` and verify each pending authority ID. Recompute every hash with `market.raw_candle_hash()`.

Validate `supersedes_raw_evidence_id` against the destination raw-evidence identity and reject self-reference or identity changes. Do not infer payload from `candles_1m`.

## Exact finalizer order

Within one PostgreSQL transaction, perform validation before any promotion insert:

1. Lock `market.candle_ingestion_runs` row and require `status='running'`.
2. Lock all pending rows for the run.
3. Require pending count > 0 and count it against the run's expected rows.
4. Validate every pending row's symbol, broker, timeframe, batch bounds, source key, and timestamp uniqueness.
5. Resolve authority with `market.resolve_candle_authority()` and compare every supplied snapshot ID.
6. Recompute every `content_sha256` with `market.raw_candle_hash()`.
7. Validate hash algorithm, finite values, supersession identity, and duplicate replay conditions.
8. Compute raw span, row counts, artifact hash, and evidence fingerprint.
9. Insert run evidence with complete metadata.
10. Insert raw evidence using real destination columns and capture returned `raw_evidence_id` values.
11. Update matching `market.candle_producer_lineage.raw_candle_id` and `ingestion_run_id`; require every expected lineage row to match.
12. Update `market.candle_ingestion_runs` with spans, counts, completion time, and `status='success'`.
13. Delete pending rows only after all ledger and lineage updates succeed.
14. Commit.

No validation failure may occur after an irreversible external action. Database inserts and updates remain rollbackable, but prevalidation prevents partial promotion and gives deterministic failure reasons.

Any error rolls back all writes, including run finalization and raw evidence publication.

## Reaper separation

Reaper is separate from finalizer. It selects stale `running` rows using `started_at`, `FOR UPDATE SKIP LOCKED`, marks them `failed`, records reason in `notes`, and deletes pending rows in bounded batches. It never touches successful runs.

## Required tests

Positive promotion, bad hash rollback, invalid authority rollback, duplicate replay, partial failure rollback, stale-run cleanup, and migration idempotency.
