# Causal Feature Rules

**Status:** Prototype contract; production implementation paused  
**Date:** 2026-07-27

## 1. Candle boundary

Canonical candle timestamps identify bar starts. For timeframe duration `D`, candle `c` covers `[c.ts, c.ts + D)`.

At anchor/knowledge time `T`, usable candles satisfy:

```text
c.ts + D <= T
```

No producer may inspect or derive output from a candle that fails this condition.

`endTs` means knowledge time, not necessarily the latest stored candle timestamp.

## 2. Pivot availability

For pivot center index `i` and right lookback `L`:

```text
centerTs = candles[i].ts
confirmationCandle = candles[i + L]
availableAt = confirmationCandle.ts + D
```

A pivot may enter downstream state only when `availableAt <= anchorTs`.

Use actual candle rows. Never locate confirmation by fixed elapsed time across gaps.

## 3. Active level state

State scope: `(symbol, tf)`.

- `activeLevels`: confirmed pivots not yet broken.
- `brokenLevels`: consumed levels.
- A level enters `activeLevels` only after pivot availability.
- A level moves to `brokenLevels` on first close beyond level.
- A broken level emits no second break event.
- Re-break behavior requires explicit future event type; default is no re-emission.
- Retention is bounded by configured bar count or time horizon.

Each pivot receives deterministic `levelId` from kind, center timestamp, and price, with symbol/timeframe supplied by state scope.

## 4. Structure availability

For BOS/CHoCH:

```text
availableAt = max(
  breakCandle.ts + D,
  brokenLevel.availableAt
)
```

For conservative MSS:

```text
availableAt = pivot.availableAt
```

Event `ts` remains event occurrence timestamp until schema changes. `availableAt` is separate knowledge timing and must not be inferred from `ts`.

## 5. Duplicate suppression

Event identity:

```text
symbol + tf + sourceLevelId + eventType + direction
```

Identity emits at most once per detector replay/state lifetime. Equal timestamps require deterministic secondary ordering: timestamp, kind, price, levelId.

## 6. Deterministic replay

Same candle sequence, timeframe, symbol, state seed, and anchor produce byte-equivalent output. No wall clock, random values, database ordering, or object insertion ordering may affect results.

## 7. Edge exclusion

Boundary applies to every candle-derived computation:

- ATR and volatility;
- pivots;
- FVG/iFVG;
- structure;
- sweeps;
- zones;
- lifecycle calculations;
- bias and direction state.

Shared runner filtering is required. Producer-local filters may enforce stricter event rules but may not widen input.

## 8. Gaps and market closures

Candle index order determines confirmation and state progression. Missing bars do not create synthetic candles or elapsed-time confirmations. Market gaps pause state; next tradable candle resumes processing.

## 9. Acceptance invariants

- No output depends on an unavailable candle.
- No pivot is consumed before `availableAt`.
- No active level is broken twice.
- No duplicate event identity.
- Event availability is monotonic in replay order.
- Same input and anchor produce same output.
- Weekend/closed periods create no synthetic events.
