# Read-Only Parity Harness Plan — 2026-08-15

Status: `PREPARED_NOT_EXECUTED`

## Frozen inputs

- Git SHA: `a5d916533d8f39f80b0f340ba8ab8b5f5ee293cb`
- Canonical edge: `2026-08-04T07:54:00Z`
- Closed bars only.
- Immutable strategy, feature, detector, calendar, and policy snapshot IDs.

## Comparison keys

For each symbol, timeframe, variant, and anchor timestamp compare:

- canonical candle IDs and timestamps;
- source broker identity and source keys;
- feature engine version and input hashes;
- feature lineage IDs;
- setup state and rejection reason;
- signal state, direction, entry, stop, target, and risk decision.

## Acceptance

- Exact identity match required for candle IDs, input hashes, lineage IDs, setup state, and rejection reason.
- Numeric differences require explicit tolerance, deterministic rounding, and documented reason.
- Missing, extra, stale, unresolved, or non-authoritative evidence fails closed.
- Any mismatch produces a non-authoritative artifact; no repair or production write follows.

## Execution prohibition

Preparation only. Do not run live parity, shadow execution, feature backfill, setup mutation, order placement, or broker writes while candle and ATR gates remain blocked.
