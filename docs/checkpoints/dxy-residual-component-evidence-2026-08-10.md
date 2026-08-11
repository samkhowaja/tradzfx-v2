# DXY Residual Component Evidence — 2026-08-10

Status: **BLOCKED**  
Authority: **NON_AUTHORITATIVE**  
Decision: **KEEP_BLOCKED_UNKNOWN**

Read-only evidence capture completed in one `REPEATABLE READ READ ONLY` transaction. Transaction rolled back. No database writes occurred.

## Captured timestamps

The normalized residual artifact contains three blocker rows but only two distinct timestamps:

```text
2026-07-07T21:04:00.000Z
2026-07-07T21:05:00.000Z
```

The third residual is a second detector flag at `21:04`, not a third timestamp. Evidence was keyed by timestamp and therefore covers all three residual rows.

## Evidence summary

| Timestamp | Components | DXY row | Formula close | Anomaly rows |
|---|---:|---|---:|---:|
| 2026-07-07T21:04:00.000Z | 6 | absent | 101.02332454071478 | 3 |
| 2026-07-07T21:05:00.000Z | 6 | absent | 101.0792191571708 | 17 |

All six required components were present at both anchors. Stored canonical DXY row was absent at both anchors. Therefore stored-vs-formula deviation cannot be evaluated, and no `KEEP` or `EXCLUDE` decision is justified.

## Output

`dxy-residual-component-evidence-2026-08-10.v1.json`

Tool: `tools/authoritative-snapshot/audit-dxy-residual-component-evidence-v1.cjs`.

## Decision

Remain `UNKNOWN` and blocking. Component presence alone does not prove canonical admissibility. Missing DXY rows, component anomaly records, and absent stored-vs-formula comparison require fail-closed handling.

```text
PERMISSION            = INACTIVE
TECHNICAL_ELIGIBILITY = BLOCKED_UNKNOWN
EXECUTION             = NO_SHADOW_RUN_YET
REPLAY                = NOT_PERFORMED
DB_WRITES             = 0
MIGRATION_193         = UNAPPLIED
ORDERS                = NONE
```
