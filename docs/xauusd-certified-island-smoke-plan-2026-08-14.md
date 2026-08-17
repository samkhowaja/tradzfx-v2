# XAUUSD Certified-Island Smoke Plan

**Status:** planning only; no DB writes, approvals, backfills, or feature writes.

## Test bed

- Symbol: `XAUUSD`
- Timeframe: `1m`
- Broker: `1x Trade Ltd.`
- Window: `2026-07-18T01:34:00Z` → `2026-07-19T01:58:00Z`
- Rows: 1,465
- Certification: zero robust outliers; zero unresolved quarantine rows
- Purpose: machinery validation only; not promotion or live-readiness evidence

## Allowed tests

1. Read-only PIT backtest constrained exactly to certified window.
2. Detector v2/v3 comparison over exact window.
3. Canonical read and continuity checks.
4. Feature API/stub evaluation with writes disabled.
5. Shadow signal evaluation with order creation disabled.

## Required assertions

- Source is canonical XAUUSD `1m`, never raw fallback.
- Query interval does not expand beyond certified bounds.
- Quarantine gate remains active.
- Invalid, non-finite, excluded, replaced, or unresolved rows fail closed.
- Detector metadata remains `candle-detector-v3-robust`.
- Feature test performs no persistence.
- Signal test creates zero orders.

## Forbidden

- `--write`, `--apply`, migrations, backfills, quarantine decisions.
- Treating output as promotion-grade performance evidence.
- Extending window to adjacent blocked intervals.
- Relaxing detector or canonical gates.

## Pass record

Record command, exact arguments, generated-at timestamp, row counts, source table, detector comparison, blocker count, write count, order count, and exit status. Any failed assertion means smoke test `BLOCKED`.
