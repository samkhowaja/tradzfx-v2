# DXY Synthetic Policy Checkpoint — 2026-08-10

Status: **BLOCKED**  
Authority: **NON_AUTHORITATIVE**  
Decision: **KEEP_BLOCKED_UNKNOWN**

Read-only policy review examined the three residual DXY synthetic blocker rows. No database rows changed and no blocker was excluded, approved, replaced, or superseded.

## Policy evidence

DXY is formula-derived from six components:

- `EURUSD`
- `USDJPY`
- `GBPUSD`
- `USDCAD`
- `USDSEK`
- `USDCHF`

Formula constant: `50.14348112`.

Existing policy evidence defines:

- boundary candidate: at least two components move by `0.1%`;
- unresolved blocker: DXY row exists and deviates from formula by more than `0.5%`;
- DXY robust-jump hard floor: `0.02`.

Repository evidence also describes DXY as synthetic, zero-volume, short-history data, not a production market feed. This supports caution, not exclusion of specific rows.

## Residual rows

```text
DXY synthetic residual blockers = 3
```

No component-level values, formula deviation, or synchronized-boundary proof is present in the frozen JSON artifacts. Therefore rows cannot be classified as safe `KEEP` or safe `EXCLUDE`.

## Decision

Retain all three rows as `UNKNOWN` blockers. Do not alter canonical data or quarantine decisions. DXY scope remains unresolved. Full equivalence remains blocked.

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

Audit output: `dxy-synthetic-policy-audit-2026-08-10.v1.json`.
