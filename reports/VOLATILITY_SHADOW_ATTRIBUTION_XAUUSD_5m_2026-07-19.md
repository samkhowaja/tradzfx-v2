# Volatility Shadow Attribution — XAUUSD 5m

**Generated:** 2026-07-19T18:56:35.182Z
**ATR period:** 5
**Causal window:** 1000 same-session observations

## Attribution contract

- Static effective: current latest profile `p95` compared with `atr_effective` in pips.
- Causal effective: persisted same-session rolling `percentile_rank <= 0.95`.
- Causal raw: reconstructed same-session rolling rank from `atr_raw` using identical 1,000-row window.
- Static versus causal effective isolates profile policy/window/timing effects. Causal raw versus causal effective isolates ATR winsorization effects.

## Decision attribution

| Comparison | Anchors | Both pass | Left pass/right block | Left block/right pass | Both block | Disagreement |
|---|---:|---:|---:|---:|---:|---:|
| Static effective vs causal effective | 20745 | 18281 | 137 | 1325 | 1002 | 1462 (7.05%) |
| Causal raw vs causal effective | 20745 | 19539 | 6 | 67 | 1133 | 73 (0.35%) |

## Persisted backtest trade anchors

Matched 134 feature anchors to at least one persisted backtest result row by exact symbol, timeframe, and timestamp. Duplicate strategy trades count once here.

| Anchors | Both pass | Static pass/causal block | Static block/causal pass | Both block | Disagreement |
|---:|---:|---:|---:|---:|---:|
| 134 | 123 | 2 | 1 | 8 | 3 (2.24%) |

## Interpretation

This report attributes decision mechanics only. Persisted trades were generated under existing strategy/gate behavior; blocked counterfactual trades are absent. No causal economic uplift claim follows from matched-trade outcomes.

## Promotion status

**NOT READY.** Require frozen walk-forward policy, counterfactual signal capture, OOS economics, and multi-symbol evidence. Live gate remains unchanged.
