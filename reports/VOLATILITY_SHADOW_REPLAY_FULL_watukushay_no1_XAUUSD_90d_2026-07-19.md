# Frozen Volatility Shadow Replay — watukushay_no1 / XAUUSD

**Generated:** 2026-07-19T19:27:37.979Z
**Window:** trailing 90 days
**Backtest mode:** shadow
**Intrabar:** sl_first
**Setup profile:** strict

## Contract

Shadow mode simulates candidates with normal spread, slippage, and commission but does not enforce gate rejection. Same simulated outcome is then classified under frozen control and shadow volatility decisions. No live behavior changed and no counterfactual result or setup evaluation is persisted.

Setup-engine grading remains active. BLOCK candidates are removed before dual-policy classification, matching full setup filtering while isolating volatility policy. Unresolved timeouts are absent from decisive trade cohorts.

## Coverage

Raw signals: 911. Shadow trades returned: 443. Exact normalized-feature joins: 430.

## Cohort economics

| Cohort | Candidates | Decisive | Wins | Win rate | Net R |
|---|---:|---:|---:|---:|---:|
| All joined | 430 | 430 | 292 | 67.91% | -64.40 |
| Both pass | 381 | 381 | 263 | 69.03% | -52.76 |
| Control only | 4 | 4 | 3 | 75.00% | 0.32 |
| Shadow only | 28 | 28 | 14 | 50.00% | -12.23 |
| Both block | 17 | 17 | 12 | 70.59% | 0.28 |
| Control policy | 385 | 385 | 266 | 69.09% | -52.44 |
| Shadow policy | 409 | 409 | 277 | 67.73% | -65.00 |

## Chronological test folds

Threshold and 1,000-observation causal window remain frozen across three equal-count chronological folds. No fold-specific tuning occurs.

| Fold | Start | End | Control N | Control Net R | Shadow N | Shadow Net R | Shadow minus control |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | 2026-05-01T06:00:00.000Z | 2026-05-26T15:00:00.000Z | 126 | -15.25 | 133 | -21.76 | -6.51 |
| 2 | 2026-05-26T17:00:00.000Z | 2026-06-19T02:00:00.000Z | 133 | -0.91 | 138 | -1.48 | -0.57 |
| 3 | 2026-06-19T03:00:00.000Z | 2026-07-16T14:00:00.000Z | 126 | -36.28 | 138 | -41.75 | -5.47 |

## Promotion status

**NOT READY.** Chronological folds use frozen policy, normal modeled costs, and strict setup grading, but evidence covers one strategy/symbol. Require multi-strategy and multi-symbol evidence before promotion.
