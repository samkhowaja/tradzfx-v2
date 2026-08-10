# Residual Detector Differences — 2026-08-10

Status: **BLOCKED**  
Authority: **NON_AUTHORITATIVE**  
Decision: **KEEP_BLOCKED_UNKNOWN**

Read-only review isolated remaining normalized differences. No stored decision was adopted and no source row changed.

## Residual set

```text
v2-calendar rows = 2
v3-robust rows   = 1
total            = 3
```

All three rows are DXY synthetic rows at `2026-07-07T21:04:00.000Z` or `2026-07-07T21:05:00.000Z`. Fresh output contains `decision = EXCLUDE`, but that stored decision is not treated as an approved canonical transition.

## Decision

Keep all residual rows `UNKNOWN` and blocking. Detector labels alone do not prove equivalence. DXY component-level formula evidence, calendar interpretation, and synthetic scope remain unresolved.

Output: `residual-detector-differences-2026-08-10.v1.json`.

## Frozen state

```text
PERMISSION            = INACTIVE
TECHNICAL_ELIGIBILITY = BLOCKED_UNKNOWN
EXECUTION             = NO_SHADOW_RUN_YET
REPLAY                = NOT_PERFORMED
DB_WRITES             = 0
MIGRATION_193         = UNAPPLIED
ORDERS                = NONE
```

No approvals, exclusions, replacements, supersession, migration, replay, backfill, shadow execution, or orders occurred.
