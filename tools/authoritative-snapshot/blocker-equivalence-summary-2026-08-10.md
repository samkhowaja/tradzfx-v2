# Blocker Equivalence Checkpoint — 2026-08-10

Status: **FAIL**

Authority: **NON_AUTHORITATIVE**

This document records a read-only comparison between the historical blocker report and v4 snapshot evidence. It authorizes no data change, gate transition, replay, migration, backfill, shadow run, or order.

## Evidence

- Baseline: `canonical_blockers_report_2026-08-10.json`
- Fresh manifest: `snapshot_manifest_2026-08-10.v4.json`
- Diff artifact: `blocker-equivalence-audit-2026-08-10.v1.json`
- Fresh commit: `39c5abe469ee1ec4bf1cfa970332e7d13cd08714`
- Fresh runner SHA-256: `5846efe4966c426c63ad9c02be8f2b1f8d5428af662e33e3fd8182321ba6ebee`

## Identity comparison

Stable key:

`symbol|broker|event_time|timeframe|flags`

| Set | Rows |
|---|---:|
| Baseline | 646 |
| Fresh v4 | 650 |
| Unchanged | 635 |
| Added | 15 |
| Removed | 11 |

## Difference classification

Added rows:

- `candle-detector-v3-robust`: 13
- `candle-detector-v2-calendar`: 2
- Symbols: `AUDUSD` 1, `DXY` 3, `EURUSD` 2, `USDSEK` 4, `XAUUSD` 5

Removed rows:

- `candle-detector-v3-robust`: 11
- Symbols: `AUDUSD` 1, `EURUSD` 1, `USDSEK` 4, `XAUUSD` 5

Notable identity behavior: several added rows use broker `MT5`, while removed baseline rows use `1x Trade Ltd.` at the same symbol and timestamp. Broker identity normalization is therefore unresolved and must not be treated as detector equivalence. DXY rows are `synthetic` and include `EXCLUDE`; they require explicit scope-policy review before any comparison can be promoted.

## Decision

Identity equivalence fails. Full payload equivalence is not proven because baseline and v4 row schemas differ. v4 remains evidence only. Historical baseline remains unchanged. No blocker is approved, replaced, excluded, or superseded by this audit.

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

## Required before any gate review

1. Normalize broker identity under the canonical broker policy without mutating source rows.
2. Compare complete payloads for matched normalized identities.
3. Prove detector, scope, decision, and calendar-policy equivalence.
4. Produce an independently hashed reconciliation artifact.
5. Obtain explicit approval for any future policy or canonical cutover.
