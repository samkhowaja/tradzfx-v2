# Feature Producer Characterization

**Status:** Observed behavior audit  
**Date:** 2026-07-27  
**Purpose:** Record current output semantics before causal repair. This is not correctness approval.

## Pivot v1.2.0

`apps/engine/src/features/pivot.ts` scans candle indices `[lookback, length - lookback)`.

For center index `i`, it requires `lookback` candles on both sides, then emits:

```text
pivot.ts = candles[i].ts
```

Observed consequence:

```text
availableAt = candles[i + lookback].ts + timeframeDuration
```

but output stores only center `ts`. Consumers cannot distinguish pivot occurrence from pivot availability. If input contains future candles, returned pivot set includes pivots whose confirmation lies after current knowledge time.

## Structure v2.1.0

`apps/engine/src/features/structure.ts` sorts supplied pivots by `pivot.ts`, then compares successive pivot prices.

For higher-high / lower-low transitions it searches candles between prior pivot and later pivot for first close beyond prior level. It emits BOS/CHoCH at that break candle timestamp.

MSS behavior differs:

```text
MSS ts = later pivot.ts
```

The later pivot is itself future-confirmed by the pivot producer, but structure does not carry its availability timestamp. MSS therefore appears available at pivot center time despite requiring future candles.

`confirmationTs` is a later close beyond the level. It is not a general causal availability field for the event. Lifecycle is evaluated from `event.ts`, which can be earlier than knowledge of the pivot or event.

## Sweep v1.4.0

`apps/engine/src/features/sweep.ts` builds liquidity levels from supplied pivots, prior-day levels, and equal-pivot clusters.

Pivot-derived levels use:

```text
formedTs = pivot.ts
```

Sweep scanning begins at first candle with `c.ts >= formedTs`. Thus unconfirmed pivot levels become active at pivot center time, not pivot confirmation time.

Sweep event timestamp is close-back candle `ts`; this part is intentionally event-at-close-back behavior. However, level availability can leak before pivot confirmation.

Structure score filters events by event `ts <= sweep.ts`, but this does not repair future-confirmed pivot availability.

## Existing tests: characterization limits

Current `structure.test.ts` and `sweep.test.ts` inject pivots directly at candle timestamps, including pivots at index 0. These fixtures test output shape and event classification, but do not test pivot confirmation or availability boundaries.

Current sweep PIT test checks future structure-event timestamp filtering. It does not test future-confirmed pivot levels. A new fixture must hold pivot center constant while varying candles after its confirmation point, then assert causal output remains unchanged.

## Required characterization fixtures

1. Pivot center with right-side confirmation candles.
2. Same pivot input evaluated at each knowledge boundary.
3. BOS where break occurs before later pivot confirmation.
4. MSS whose pivot center precedes pivot availability.
5. Sweep against pivot level before and after pivot availability.
6. Duplicate equal-high/equal-low levels.
7. Same candle piercing multiple active levels.
8. Missing timeframe candle between pivot and break.

Expected fixture outputs must first capture current behavior. Do not label current rows as truth. Compare future causal implementation against these observations with explicit divergence reasons.
