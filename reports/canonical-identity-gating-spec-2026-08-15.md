# Canonical Identity Gating Specification — 2026-08-15

Status: `FROZEN_POLICY_DRAFT`; no database state change.

## Gating unit

One canonical blocker identity is:

```text
(symbol, effective broker, timeframe, event timestamp)
```

`candle_quarantine` rows are evidence records, not gating units. Multiple rows may belong to one identity because detector versions, flags, and evidence records overlap.

## Active identity

Identity is active when at least one unsuperseded quarantine row exists and its normalized decision is not approved `KEEP` or valid approved `REPLACED` evidence. `EXCLUDE` remains a blocking absence and must not enter canonical selection.

## Decision rule

Certification evaluates exactly one aggregate identity decision. Aggregate decision must be derived from all active evidence rows and may not be chosen from one detector row alone.

Allowed outcomes:

- `KEEP`: every blocking claim resolved by evidence and explicit approval.
- `EXCLUDE`: identity proven structurally invalid or prohibited by policy.
- `REPLACED`: valid immutable alternate evidence bound to original identity.
- `UNKNOWN`: insufficient evidence; hard blocker.

## Current snapshot

Artifact: `reports/canonical-blocker-reconciliation-2026-08-15.json`

- Active identities: 329.
- Active quarantine rows: 562.
- Duplicate row excess: 233.
- `REVIEW_REQUIRED`: 56 identities.
- `NO_ALTERNATE_MANUAL_POLICY`: 273 identities.

Historical `372 = 85 + 287` is retired as an active contract.

## Gate effect

Any active `UNKNOWN`, missing aggregate decision, unresolved provenance, or invalid replacement binding blocks canonical certification for affected interval. Row count cannot substitute for identity count.
