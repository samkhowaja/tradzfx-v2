# Index Cleanup Proposal — 2026-08-15

Status: `READ_ONLY_PROPOSAL`; no drop or reindex approved.

## Evidence

- 354 indexes.
- ~10.1 GB index storage.
- 0 exact duplicate groups.
- 8 left-prefix candidates, ~177.4 MB.
- 153 never-scanned non-constraint indexes.
- `pg_stat_statements` unavailable; query mapping requires representative EXPLAIN runs.

## Classification

Never-scanned indexes are `REVIEW_REQUIRED`, not obsolete. Possible tags: defensive, historical workload, likely obsolete. Tag requires table-reader audit, deployment history, and real-query EXPLAIN.

Prefix candidates are `REVIEW_REQUIRED`. Prefix overlap does not prove redundancy.

## Do not touch

- Primary-key and unique constraint indexes.
- Any `features_*_symbol` index with sibling `*_pit_cover`.
- Critical join/filter indexes until real query EXPLAIN and reader audit pass.
- Any index with unknown workload ownership.

## Required before any controlled change

1. Query-text audit for every affected table.
2. `EXPLAIN (FORMAT JSON)` on real query shapes.
3. `pg_stat_user_indexes` scan evidence over suitable observation period.
4. Stored recreation DDL and rollback plan.
5. Explicit per-index user approval.
6. `DROP INDEX CONCURRENTLY` only; no CASCADE.
7. Recheck plans and application health after change.

Current recommendation: no cleanup execution.
