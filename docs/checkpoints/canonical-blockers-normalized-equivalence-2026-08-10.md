# Canonical Blocker Normalized Equivalence — 2026-08-10

Status: **FAIL**  
Authority: **NON_AUTHORITATIVE**

Read-only broker normalization reduced prior identity drift, but equivalence still fails. No source rows changed.

## Evidence

- Audit tool: `tools/authoritative-snapshot/audit-blocker-equivalence-normalized-v1.cjs`
- Baseline: `canonical_blockers_report_2026-08-10.json`
- Fresh manifest: `snapshot_manifest_2026-08-10.v4.json`
- Fresh commit: `39c5abe469ee1ec4bf1cfa970332e7d13cd08714`
- Fresh runner SHA-256: `5846efe4966c426c63ad9c02be8f2b1f8d5428af662e33e3fd8182321ba6ebee`
- Output: `blocker-equivalence-normalized-2026-08-10.v1.json`

## Result

Canonical broker mapping:

- `MT5` → `1x Trade Ltd.`
- `MT4` → `OANDA Corporation`

| Baseline | Fresh | Unchanged | Added | Removed |
|---:|---:|---:|---:|---:|
| 646 | 650 | 647 | 3 | 0 |

Remaining additions:

- `DXY`, broker `synthetic`: 3
- `candle-detector-v2-calendar`: 2
- `candle-detector-v3-robust`: 1

DXY synthetic scope remains unresolved. No scope filter or decision was applied. Full payload equivalence remains unproven because source schemas differ.

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
