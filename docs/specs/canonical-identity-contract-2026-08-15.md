# Canonical Candle Identity Contract

**Version:** `canonical-identity-contract-v1`
**Date:** `2026-08-15`
**Authority:** policy specification only; no activation or write authorization
**Current state:** `BLOCKED_IDENTITY_INTEGRITY`

## Identity key

Canonical candle identity is:

`(symbol, effective broker, timeframe, event timestamp)`

Identity serialization is deterministic UTC ISO-8601:

`symbol|effective_broker|timeframe|event_time.toISOString()`

## Immutable evidence tuple

Each admissible canonical identity must bind exactly one active evidence contract containing:

- `symbol`
- `effective_broker`
- `timeframe`
- `event_time`
- `raw_source_key`
- `raw_row_hash`
- `evidence_id`
- `detector_version`

`raw_row_hash` is SHA-256 over a canonical serialization of immutable raw source identity and candle values. Hash algorithm and serialization version must be stored with contract evidence. No inferred or guessed hash is admissible.

`evidence_id` identifies evidence contract, not merely a detector observation. It is immutable after creation.

## Active-row invariant

- Exactly one active evidence contract per canonical identity.
- Active means not superseded and not voided.
- Multiple active contracts are `UNRESOLVED_IDENTITY` and block canonical use.
- Evidence rows are never deleted to resolve conflict.

## Supersession

A replacement creates a new evidence contract with a new `evidence_id` and explicit `supersedes_evidence_id`. Previous contract becomes superseded. Supersession requires:

1. exact identity match;
2. immutable source key and raw hash for new contract;
3. replacement evidence record;
4. explicit decision: `REPLACED`, `EXCLUDE`, or `KEEP`;
5. reviewer, policy version, and timestamp;
6. before/after hashes and row-count assertions.

Floating replacement evidence remains `UNKNOWN` and blocks.

## Decision admissibility

Identity aggregate decision is computed across all active evidence rows and replacement records:

- `KEEP`: one admissible active contract, no unresolved conflict;
- `EXCLUDE`: explicit policy exclusion, no conflicting active evidence;
- `REPLACED`: explicit admissible replacement chain with one active successor;
- `UNKNOWN`: missing, conflicting, incomplete, or unresolved evidence.

`UNKNOWN` is fail-closed. Authorization cannot override it.

## Detector decision diff

Detector comparison must use one frozen read-only input snapshot and record one of:

- `EQUIVALENT`
- `STRICTER`
- `LOOSER`
- `CONFLICT`
- `UNPROVEN`

Only `EQUIVALENT` or policy-approved `STRICTER` can become pilot candidates. `LOOSER`, `CONFLICT`, and `UNPROVEN` block.

## Required controls

Future identity migrations must be separate from ATR, feature, trusted-window, parity, detector activation, and index work. They must not modify raw candles. Every write requires explicit allowlist, transaction isolation, before-hash, exact rollback artifact, post-write verification, and negative-space assertions.

## Current non-authoritative conclusion

The current database does not expose a complete immutable `raw_row_hash` plus `evidence_id` contract on `public.candle_quarantine`. No identity is eligible for first-write authorization until the contract is represented, populated from proven provenance, and re-audited.
