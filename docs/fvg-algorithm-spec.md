# Adaptive Causal FVG Algorithm Specification

Status: design specification. Strategy workstream only. No production registration, migration, YAML, or live promotion.

## Answer

Best general-purpose FVG detector across 10 pairs and 5 timeframes:

**Three-candle causal FVG detection + ATR normalization + pair/timeframe percentile ranking + displacement/body-strength filtering.**

Raw gap existence identifies candidate FVGs. Adaptive normalized and ranked filters identify tradable-quality FVGs. Detection, ranking, entry, and exit remain separate stages.

## Supported styles

| Style | Typical timeframe | Main objective |
|---|---|---|
| Scalp | 1m, 5m | Select rare, liquid gaps; fast fixed-R exit |
| Intraday | 15m, 1h | Select stronger displacement and directional continuation |
| Swing | 4h, 1d | Select large ranked gaps with wider risk and longer expiry |

Every `(symbol, timeframe)` gets independent thresholds. Do not use one global pip threshold.

## Causal boundary

At formation timestamp `t`, algorithm may use only candles whose close is known at or before `t`.

- Formation candle is candle `c3` in `[c1, c2, c3]`.
- No future candle may affect detection, score, eligibility, or entry.
- No future-confirmed pivot, structure, sweep, bias, direction state, lifecycle outcome, or retrospective zone metadata.
- ATR, body averages, percentiles, EMA, and spread must be calculated from completed candles available at `t`.
- Backtests must load post-formation candles strictly after `t`.
- Warmup history must be present before first candidate; default `200` completed bars.

## Stage 1: raw three-candle detection

For candle sequence `[c1, c2, c3]`:

### Bullish FVG

```text
c1.high < c3.low
bottom = c1.high
top = c3.low
gap = top - bottom
```

### Bearish FVG

```text
c1.low > c3.high
bottom = c3.high
top = c1.low
gap = top - bottom
```

Reject non-positive, non-finite, or malformed geometry. Formation timestamp is `c3.ts`.

## Stage 2: candle-only measurements

Let `ATR_t` be ATR computed only from completed candles through `c3`. Use Wilder ATR or existing canonical ATR implementation consistently.

```text
gapAtrRatio = gap / ATR_t
middleRange = c2.high - c2.low
middleBody = abs(c2.close - c2.open)
middleBodyRatio = middleBody / middleRange
middleBodyVsAverage = middleBody / median(previous N body sizes)
```

Use a fixed lookback such as `N = 20`, with sufficient warmup. Reject invalid denominators.

Displacement direction:

```text
bullish displacement: c2.close > c2.open
bearish displacement: c2.close < c2.open
```

Do not require direction alignment with structure or bias. Optional candle-only HTF EMA slope is a ranking component, not a detector dependency.

## Stage 3: adaptive eligibility

Measure distributions separately for every `(symbol, timeframe)` using a training period that ends before evaluation period.

Recommended baseline:

- Gap discovery floor: `gapAtrRatio >= p25`.
- Preferred trade candidate: `gapAtrRatio >= p50`.
- High-quality candidate: score threshold, commonly `>= 60`.
- Volatility spike rejection: ATR percentile `> p90`.
- Spread rejection: spread `> 5% of ATR`.
- Asia low-timeframe score surcharge: `+10` minimum points for `1m`, `5m`, `15m`.

Do not fit thresholds on the test window. Use walk-forward training windows and freeze parameters during each test segment.

## Stage 4: quality score

Score range: `0..100`.

| Component | Formula | Maximum |
|---|---:|---:|
| Gap significance | `clamp(gapAtrRatio * 20, 0, 30)` | 30 |
| Middle-body conviction | `clamp(middleBodyRatio * 15, 0, 25)` | 25 |
| Body versus recent average | `clamp(middleBodyVsAverage * 10, 0, 20)` | 20 |
| Middle-candle direction | aligned with FVG direction: `15`, else `0` | 15 |
| Optional candle-only HTF EMA slope | aligned slope: `10`, else `0` | 10 |

```text
score = clamp(gap + middleBody + bodyVsAverage + direction + ema, 0, 100)
```

Use score for ranking and ablation studies. Test thresholds `0`, `50`, and `70`; do not select one from a single period or pair.

## Stage 5: candidate ranking

Rank eligible candidates within each symbol/timeframe/session using:

1. quality score descending;
2. gap ATR ratio descending;
3. formation timestamp ascending for deterministic tie-breaking.

Limit candidates only after ranking. Never rank using future outcomes, lifecycle state, structure, pivots, sweeps, or bias.

## Entry rules

Default entry: midpoint touch.

```text
mid = (top + bottom) / 2
```

- Bullish entry: first post-formation candle whose range reaches `mid`.
- Bearish entry: same rule.
- Entry candle must have `ts > formationTs`.
- Reject non-positive risk.
- Apply spread and broker minimum-distance checks at entry.
- Record whether entry occurred, entry timestamp, entry price, and bars to entry.

A zone touch without midpoint touch is not an executed trade.

## Exit rules

Use fixed-R profiles. No structure or future event dependency.

| Style | Stop buffer | Target set | Management |
|---|---:|---:|---|
| Scalp | `1R` baseline | `1.5R`, `2R` | no trail |
| Intraday | `1.5R` baseline | `2R`, `3R` | optional breakeven at TP1 |
| Swing | `2R` baseline | `3R`, `4R`, `5R` | fixed-candle trailing rule only |

For bullish FVG:

```text
stop = bottom - buffer
risk = entry - stop
```

For bearish FVG:

```text
stop = top + buffer
risk = stop - entry
```

Targets invert by direction. Reject risk if non-finite or `risk <= 0`.

## Intrabar policy

OHLC data cannot reveal whether stop or target occurred first inside one candle. Backtests must declare policy in metadata.

Recommended default: **conservative stop-first**.

- If same candle reaches both stop and target, record stop.
- Entry cannot be assumed before an exit level unless candle ordering permits it under declared policy.
- Report same-candle entries, same-candle wins, same-candle losses, and their rates.
- Never silently use optimistic target-first behavior.

Close-only mode may be used as sensitivity analysis, not as an undisclosed replacement.

## Overlap and position policy

Report overlapping candidates before scaling:

- temporal overlap: second candidate forms before first trade exits;
- price overlap: zone ranges intersect;
- trade overlap: active positions coexist.

Baseline policy: one active position per `(symbol, timeframe)`; retain highest-ranked candidate and mark suppressed candidates. Compare against unlimited-overlap mode as sensitivity analysis.

## Required result metadata

Every result must include:

- algorithm version;
- symbol and timeframe;
- training/evaluation windows;
- threshold source and percentile values;
- formation timestamp;
- entry timestamp and price;
- zone top, bottom, midpoint, gap, ATR, gap ATR ratio;
- body ratio and body-vs-average;
- quality score and components;
- spread and ATR percentile;
- risk, stop, targets, exit reason, R result;
- intrabar policy;
- overlap/position policy;
- incomplete post-window status;
- causal boundary status.

## Validation gates before scaling

Run at least 100 candidates per symbol/timeframe before 500-candidate scaling. Review:

- zero formation candles in post window;
- midpoint touch rate;
- same-candle win rate;
- finite risk/zone ratio;
- MAE sign and magnitude;
- MFE magnitude;
- bars-held distribution;
- overlap rate;
- direction-alignment distribution;
- result stability across symbols, timeframes, sessions, and walk-forward folds.

Suggested diagnostic flags, not universal laws:

- same-candle wins `< 30%`;
- midpoint touch `> 70%` of executed trades;
- risk/zone ratio `> 0.8`;
- average MAE `< -0.3R`;
- average MFE `< 5R` unless strategy explicitly targets larger moves;
- overlap rate `< 20%`.

Any failed gate triggers investigation. Do not scale or promote based on aggregate expectancy alone.

## Recommended research sequence

1. Implement raw causal detector.
2. Verify candle-boundary invariants.
3. Build pair/timeframe training distributions.
4. Add ATR-normalized and percentile filters.
5. Add body-strength score.
6. Run walk-forward ablations:
   - raw FVG;
   - ATR only;
   - ATR + body strength;
   - percentile ranking;
   - optional candle-only EMA slope.
7. Compare fixed-R exits under conservative, close-only, and declared alternate policies.
8. Compare overlap policies.
9. Select parameters by out-of-sample stability, not highest single-period R.
10. Only then integrate into production engine.

## Explicitly out of scope

This document does not repair engine producers, register production features, backfill DB tables, modify strategy YAML, promote variants, or approve live trading. Those belong to separate engine-causality and deployment workstreams.
