# Strategy FVG Fixed-R Exit Rules

Workstream: `strategy-fvg-*`. No wave or structure dependency.

## Risk definition

For bullish FVG:

- Entry: configured FVG entry price, commonly midpoint.
- Stop: `fvg.bottom - buffer`.
- Risk: `entry - stop`.
- Targets: `entry + R * multiple`.

For bearish FVG, invert prices.

## Style profiles

| Style | Entry TF | Stop basis | TP1 | TP2 | TP3 | Management |
|---|---|---|---:|---:|---:|---|
| Scalp | 1m/5m | 1R | 1.5R | 2R | — | No trail |
| Intraday | 15m/1h | 1.5R | 2R | 3R | — | Move stop to breakeven at TP1 |
| Swing | 4h | 2R | 3R | 4R | 5R | Trail below/above fixed candle rule, not structure |

## Execution rules

1. Reject non-positive or non-finite risk.
2. Reject entries when spread gate fails.
3. Apply broker minimum stop distance.
4. Resolve same-bar TP/SL with declared deterministic policy.
5. Record entry, stop, each target, exit reason, and R result.
6. Do not use pivots, structure, waves, bias, or reversal events for exits.

## Required metadata

Record profile name, entry TF, risk distance, buffer, target multiples, management policy, and intrabar resolution mode.
