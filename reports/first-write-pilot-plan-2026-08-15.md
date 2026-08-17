# First Write-Enabled Pilot Plan — 2026-08-15

Status: `PLANNED_NOT_EXECUTED`

## Preconditions

- Identity gating specification frozen and reviewed.
- Detector version and parameters frozen.
- Target identities selected from `reports/canonical-blocker-reconciliation-2026-08-15.json`.
- Every target has complete evidence bundle, reviewer, reason, policy version, and rollback key.
- Pilot scope excludes DXY locked boundaries and `2026-07-19T01:59:00Z` structural hole.
- Independent review complete.

## Write controls

- One transaction.
- Explicit identity allowlist.
- No broad UPDATE by symbol or timestamp alone.
- Assert current row versions before write.
- Write aggregate decision plus audit event.
- Re-read identity after write.
- Rollback on any mismatch.
- Produce before/after hashes and decision report.

## Decision constraints

`REPLACED` requires immutable alternate provenance and replacement evidence. `KEEP` requires explicit reviewer approval. `EXCLUDE` must preserve original evidence and canonical exclusion reason. `UNKNOWN` remains default.

## Forbidden

No pilot execution yet. No canonical rebuild, feature backfill, trusted-window promotion, ATR cutover, parity execution, or shadow run.
