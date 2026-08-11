# Canonical Blocker Equivalence Checkpoint — 2026-08-10

Status: **FAIL**  
Authority: **NON_AUTHORITATIVE**

Read-only comparison found blocker identity mismatch between historical baseline and v4 snapshot. This checkpoint authorizes no data change, gate transition, replay, migration, backfill, shadow run, or order.

## Evidence

- Baseline: `canonical_blockers_report_2026-08-10.json`
- Fresh manifest: `snapshot_manifest_2026-08-10.v4.json`
- Diff: `blocker-equivalence-audit-2026-08-10.v1.json`
- Runner: `tools/authoritative-snapshot/run-authoritative-snapshot-v4.cjs`
- Commit: `39c5abe469ee1ec4bf1cfa970332e7d13cd08714`
- Runner SHA-256: `5846efe4966c426c63ad9c02be8f2b1f8d5428af662e33e3fd8182321ba6ebee`

## Result

Stable identity key:

`symbol|broker|event_time|timeframe|flags`

| Baseline | Fresh | Unchanged | Added | Removed |
|---:|---:|---:|---:|---:|
| 646 | 650 | 635 | 15 | 11 |

Broker identity mismatch remains unresolved: added rows use `MT5`, while corresponding removed rows use `1x Trade Ltd.`. DXY `synthetic` rows with `EXCLUDE` require explicit scope-policy review.

Full payload equivalence is unproven because source schemas differ. Historical baseline remains unchanged. No blocker was approved, replaced, excluded, or superseded.

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

This checkpoint is immutable. Future findings require a new dated checkpoint.
