# Frozen Volatility Shadow Replay — watukushay_no1 / XAUUSD

**Generated:** 2026-07-19T19:17:32.017Z
**Window:** trailing 90 days
**Backtest mode:** shadow
**Intrabar:** sl_first
**Setup profile:** skip

## Contract

Shadow mode simulates candidates with normal spread, slippage, and commission but does not enforce gate rejection. Same simulated outcome is then classified under frozen control and shadow volatility decisions. No live behavior changed.

Important: setup-engine grading is skipped so this isolates gate policy mechanics. Unresolved timeouts are absent from decisive trade cohorts.

## Coverage

Raw signals: 911. Shadow trades returned: 597. Exact normalized-feature joins: 574.

## Cohort economics

| Cohort | Candidates | Decisive | Wins | Win rate | Net R |
|---|---:|---:|---:|---:|---:|
| All joined | 574 | 574 | 367 | 63.94% | -132.37 |
| Both pass | 514 | 514 | 331 | 64.40% | -119.92 |
| Control only | 4 | 4 | 3 | 75.00% | 0.32 |
| Shadow only | 35 | 35 | 19 | 54.29% | -12.04 |
| Both block | 21 | 21 | 14 | 66.67% | -0.73 |
| Control policy | 518 | 518 | 334 | 64.48% | -119.60 |
| Shadow policy | 549 | 549 | 350 | 63.75% | -131.96 |

## Chronological test folds

Threshold and 1,000-observation causal window remain frozen across three equal-count chronological folds. No fold-specific tuning occurs.

| Fold | Start | End | Control N | Control Net R | Shadow N | Shadow Net R | Shadow minus control |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | 2026-05-01T06:00:00.000Z | 2026-05-26T13:00:00.000Z | 175 | -40.75 | 182 | -47.27 | -6.51 |
| 2 | 2026-05-26T14:00:00.000Z | 2026-06-22T22:00:00.000Z | 171 | -24.21 | 181 | -25.92 | -1.71 |
| 3 | 2026-06-23T00:00:00.000Z | 2026-07-16T14:00:00.000Z | 172 | -54.63 | 186 | -58.77 | -4.14 |

## Promotion status

**NOT READY.** Chronological folds use frozen policy and normal modeled costs, but setup grading is skipped and evidence covers one strategy/symbol. Require full-pipeline OOS replay and multi-symbol evidence before promotion.
