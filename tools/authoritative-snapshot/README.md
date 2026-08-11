# Authoritative Snapshot Audit Tools

Read-only audit machinery for frozen candle-blocker and XAUUSD 15m ATR/HTF evidence.

## Tools

- `run-authoritative-snapshot-v3.cjs`: clean-worktree preflight. Does not open DB.
- `run-authoritative-snapshot-v4.cjs`: committed-runner snapshot. Opens one `REPEATABLE READ READ ONLY` transaction, rolls back, and performs no DB writes.
- `audit-blocker-equivalence-v1.cjs`: compares baseline and v4 blocker identities from frozen JSON artifacts. Does not open DB.

## Policy

- Never run with migration, backfill, replay, shadow, order, or write flags.
- Every snapshot must bind commit SHA, runner SHA-256, clean worktree, query hashes, output hashes, DB identity, isolation, read-only state, and rollback result.
- `PASS` does not authorize gate changes. Any mismatch remains `NON_AUTHORITATIVE`.
- Checkpoint documents are immutable. Supersede by adding a new dated document; do not edit signed checkpoints.
- Frozen gates remain unchanged unless separate approval process explicitly changes them.

Frozen state for current phase:

```text
PERMISSION            = INACTIVE
TECHNICAL_ELIGIBILITY = BLOCKED_UNKNOWN
EXECUTION             = NO_SHADOW_RUN_YET
REPLAY                = NOT_PERFORMED
DB_WRITES             = 0
MIGRATION_193         = UNAPPLIED
ORDERS                = NONE
```
