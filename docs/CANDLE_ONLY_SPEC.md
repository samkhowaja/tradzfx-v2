# CANDLE_ONLY Execution Specification

## Scope

This contract defines candle-based execution simulation using **stored FVG zones**. It does not define FVG detection. FVG detection is inherited from `features_zone`, so results remain dependent on zone-producer correctness and causal status.

## Data sources

- FVG geometry: `features_zone` (`zone_kind = 'fvg'`, direction/type, top, bottom, `ts`)
- Formation and post-formation OHLC: canonical candle relation for requested timeframe (`market.candles_*_canonical`)
- ATR: computed from pre-formation candles, 14-period true range
- Spread: setup spread value, compared with ATR gate

## Time and formation rules

- Candle `ts` is bar-open time.
- Candle becomes usable after `ts + timeframe duration`.
- Formation uses three candles: `c1`, `c2`, `c3`; formation timestamp is `c3.ts`.
- Bullish gap: `c3.low - c1.high`.
- Bearish gap: `c1.low - c3.high`.
- All joins and lookbacks must be point-in-time. No future candle may influence formation, ATR, quality, entry, or exit.

## Entry

- Entry location: zone midpoint.
- Entry model: limit order at midpoint.
- Fill requires candle range to touch midpoint.
- A gap through midpoint without a range touch is unfilled.

## Stop and risk

- Bullish stop: `zone.bottom - stopBufferAtr * ATR(14)`.
- Bearish stop: `zone.top + stopBufferAtr * ATR(14)`.
- Risk: `abs(entry - stop)`; non-finite or non-positive risk rejects setup.
- Default `stopBufferAtr`: `0.1`.

## Gap-stop protection

If a post-fill candle opens beyond stop, exit at stop price, not gap-open price. Reason is `gap_stop`. This caps ordinary gap-stop loss near `-1R` and prevents artificial extreme losses.

## Target and intrabar behavior

- Default target: `[2.0]`.
- Exit uses first target hit.
- Multiple targets are **not** partial-profit logic. `[1.5, 2.0]` exits at first hit and therefore behaves as `[1.5]`.
- Stop has priority over target (`sl_first`).
- Current implementation uses candle high/low for hit detection. Any close-only mode must be explicit and separately validated.
- Default maximum holding window: `100` bars.

## Filters and quality

- Default `minQualityScore`: `50`.
- Quality uses gap/ATR ratio, middle-body ratio, middle-body-vs-average, and direction alignment.
- No HTF structure dependency is added by simulator execution; stored-zone detection may still depend on structure.
- Spread rejects when `spread > ATR * spreadGateAtrPct`.
- Default spread gate: `0.05`.
- Default volatility percentile gate: `0.90`.

## Sessions

Session labels derive from formation timestamp in UTC. Session boundaries must come from one canonical project utility; do not duplicate or silently change them in reports.

## Validation gates

A cell is valid only when data and diagnostics pass, and results meet all applicable gates:

- `maxMaeR > -5R`
- `avgMaeR < -0.5R`
- `avgR > 0`
- same-candle win rate `< 30%`
- midpoint touch rate `> 70%`
- average risk/zone ratio `> 0.5`
- win rate between `20%` and `60%`
- stderr contains no anomaly records
- minimum trade count and out-of-sample validation are recorded separately

Positive June expectancy is a baseline result, not production proof. Validate additional periods, timeframes, pairs, and portfolio correlation before live use.

## Health terminology

`READY_FOR_CANDLE_ONLY` means candles and stored FVG zones are available. It does not mean feature strategies are causally safe. `READY_FOR_FEATURE_STRATEGY` requires separate causal and freshness evidence.
