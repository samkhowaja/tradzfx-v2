# Strategy FVG Quality Specification

Workstream: `strategy-fvg-*`

This specification uses candle-derived inputs only. It must not consume `features_structure`, `features_pivot`, `features_sweep`, `features_bias`, `features_direction_state`, or structure-derived ranking.

## Database schema contract

- FVG geometry comes from `features_zone`.
- `features_zone.ts` is formation timestamp. Table has no `formation_ts`, `type`, `mid`, or `id` columns.
- Compute midpoint as `(top + bottom) / 2`.
- Use `(symbol, tf, ts, top, bottom)` as zone identity.
- Candle tables map by timeframe: `candles_1m`, `candles_5m`, `candles_15m`, `candles_1h`, `candles_4h`, `candles_1d_utc`.
- Candle OHLC columns are `o`, `h`, `l`, `c`; volume is `v`; timestamp is `ts`.
- `gap_atr_ratio`, `middle_body_ratio`, `middle_body_vs_average`, and related columns in `features_zone` are not authoritative. Simulator computes them from candles.

## Inputs

- `gap_atr_ratio`
- `middle_body_ratio`
- `middle_body_vs_average`
- `gap_size`
- FVG direction and middle-candle direction
- Candle-close HTF EMA slope
- Session and timestamp
- Current spread
- ATR and ATR percentile from completed candles

## Score

Score range: 0–100.

| Component | Formula | Maximum |
|---|---:|---:|
| Gap significance | `min(gap_atr_ratio * 20, 30)` | 30 |
| Middle-body conviction | `min(middle_body_ratio * 15, 25)` | 25 |
| Body vs average | `min((middle_body_vs_average ?? 1) * 10, 20)` | 20 |
| Middle-candle direction | aligned direction: `15` | 15 |
| HTF EMA alignment | aligned slope: `10` | 10 |

Clamp final score to `[0, 100]`.

## Eligibility

1. Reject missing or non-finite required values.
2. Reject FVG below measured pair/TF threshold. Default discovery threshold: p25.
3. Require score at or above configured minimum.
4. For Asia on `1m`, `5m`, or `15m`, add 10 points to minimum score.
5. Reject spread above 5% of current ATR.
6. Reject ATR percentile above 90th percentile.
7. Use completed candles only.

## Measurement rule

Thresholds must be measured by `(symbol, tf)`. Do not hardcode pair personality or XAUUSD pip assumptions.

## Contamination boundary

This spec is `CANDLE_ONLY`. Results must carry explicit backtest metadata. Do not compare against results using contaminated structure or bias inputs.
