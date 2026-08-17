# Canonical Blocker Population Reconciliation — 2026-08-15

Mode: `REPEATABLE READ READ ONLY`

## Count reconciliation

- Requested prior estimate: **372 identities** = 85 alternate + 287 manual.
- Observed active blocker rows: **562**.
- Observed active blocker identities: **329**.
- Duplicate active-row excess: **233**.
- Superseded rows retained separately: **681**.

## Evidence-based buckets

- NO_ALTERNATE_MANUAL_POLICY: 273 identities
- REVIEW_REQUIRED: 56 identities

These buckets do not equal historical 85/287 claims. They are review buckets only.

## Active rows by symbol

- AUDUSD: 40
- DXY: 3
- EURUSD: 43
- GBPUSD: 62
- NZDUSD: 42
- USDCHF: 20
- USDJPY: 68
- USDSEK: 73
- XAUUSD: 211

## Active rows by blocker reason

- LARGE_JUMP_ROBUST: 240
- LARGE_JUMP_RELATIVE: 305
- LARGE_JUMP_ROBUST+UNEXPECTED_GAP: 8
- LARGE_JUMP_RELATIVE+UNEXPECTED_GAP: 3
- UNEXPECTED_GAP: 6

## Decision

**No decision migration is authorized.** Population mismatch remains unresolved.

Database writes: `0`. Source state changes: `0`.
