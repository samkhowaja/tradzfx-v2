# First-Write Pilot Authorization Packet

- Status: `BLOCKED_NO_ELIGIBLE_PILOT_IDENTITIES`
- Authority: `NON_AUTHORITATIVE`
- Database writes: `0`
- Source state changes: `0`
- Authorization request: **DENIED / NOT READY FOR AUTHORIZATION**

## Evidence snapshot

- Reconciliation artifact: `reports/canonical-blocker-reconciliation-2026-08-15.json`
- Integrity artifact: `reports/canonical-identity-integrity-2026-08-15/integrity.json`
- Snapshot edge: `2026-08-15T07:53:27.144Z`
- Database: `tradzfx_v2`
- PostgreSQL: `17.9`
- Active blocker rows: `562`
- Active identities: `329`
- Identity-integrity findings: `268`
- Integrity status: `BLOCKED_IDENTITY_INTEGRITY`

## Exact allowlist

```json
[]
```

No identity satisfies required immutable tuple and exclusion rules. No allowlist fabricated.

Required tuple:

`symbol + effective broker + timeframe + event timestamp + source key + raw row hash + evidence ID + detector version`

Current quarantine schema provides `raw_source_key` and `detector_version`, but no immutable raw-row hash or evidence ID in `public.candle_quarantine`. Replacement evidence exists separately, but all observed alternate rows remain unresolved under current policy.

## Exclusions

- DXY synthetic rows
- XAUUSD 15m ATR lineage
- Structural holes
- Multi-flag or conflicting detector cases
- Any identity with multiple active evidence rows
- Any identity with missing source key, raw hash, evidence ID, or detector version
- Any identity with unresolved replacement evidence
- Any identity whose aggregate decision is not admissible under frozen policy

## Before manifest

Not generated. Empty allowlist means no permitted write target. Generating a write-oriented before manifest would imply pilot readiness not supported by evidence.

## Expected after manifest

Not generated. No proposed decision is admissible. Existing state must remain unchanged:

- active decisions remain `UNKNOWN` / unresolved;
- no quarantine row may change;
- no canonical row may change;
- no feature, trusted-window, ATR, detector, or index state may change.

## Negative-space manifest

Scope is all active identities outside allowlist: `329` identities / `562` rows.

Expected collateral change: `0` rows, `0` identities.

Any write touching negative-space identity is forbidden.

## Proposed decision diff

```text
NONE
```

`UNKNOWN -> KEEP`, `UNKNOWN -> EXCLUDE`, and `UNKNOWN -> REPLACED` are all withheld. Authorization cannot override `BLOCKED_UNKNOWN` or `BLOCKED_IDENTITY_INTEGRITY`.

## Rollback artifact

No executable rollback is issued because no forward diff is admissible. Existing before-state remains source of truth. Any future packet must capture exact row values, row-count assertions, identity assertions, before-hash checks, post-write verification, and rollback key before authorization.

## Authorization request

**Request: do not authorize first-write pilot.**

Future authorization requires all conditions:

1. 3–5 exact identities pass identity-integrity checks.
2. Immutable source key, raw hash, evidence ID, detector version, and event tuple are present.
3. Replacement evidence meets frozen admissibility policy.
4. No DXY, ATR, structural-hole, or ambiguous multi-flag identity is included.
5. Before/after/negative-space manifests and SHA-256 hashes exist.
6. Exact forward SQL and exact rollback artifact exist.
7. Reviewer and validity window are bound to packet hashes.
8. Technical state remains fail-closed; no authorization may override blocked gates.

## Deferred tracks

ATR authority, detector activation, trusted-window promotion, parity execution, feature backfill, Migration 193, `features_zone` changes, and index mutation remain deferred and isolated.
