# Cost and Payoff Geometry — watukushay_no1 / XAUUSD

**Generated:** 2026-07-19T19:46:41.634Z
**Window:** trailing 90 days
**Mode:** shadow with strict setup grading, normal modeled costs, gate rejection observed but not enforced

## Method

Every decisive trade exits at authored TP or SL. Gross R therefore equals planned reward/risk for wins and -1R for losses. Cost drag equals gross R minus simulator net R and includes modeled entry/exit spread, slippage, and commission effects. This is attribution, not a second simulation.

## Overall

| Trades | Win rate | Gross R | Cost drag | Net R | Median stop | Median planned RR | Median cost drag/trade |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 443 | 68.85% | 167.00 | 224.34 | -57.34 | 91.76p | 1.00 | 0.536R |

Median-RR gross breakeven win rate: 50.00%. Observed win rate: 68.85%.

## Direction

| Group | Trades | Win rate | Gross R | Cost drag | Net R | Median stop pips | Median planned RR |
|---|---:|---:|---:|---:|---:|---:|---:|
| buy | 80 | 56.25% | 10.00 | 40.48 | -30.48 | 89.85 | 1.00 |
| sell | 363 | 71.63% | 157.00 | 183.87 | -26.87 | 92.05 | 1.00 |

## Session

| Group | Trades | Win rate | Gross R | Cost drag | Net R | Median stop pips | Median planned RR |
|---|---:|---:|---:|---:|---:|---:|---:|
| ASIA | 131 | 79.39% | 77.00 | 70.33 | 6.67 | 85.96 | 1.00 |
| LONDON | 88 | 64.77% | 26.00 | 43.46 | -17.46 | 97.98 | 1.00 |
| NY | 96 | 59.38% | 18.00 | 47.04 | -29.04 | 84.73 | 1.00 |
| OFF_HOURS | 32 | 62.50% | 8.00 | 15.66 | -7.66 | 103.38 | 1.00 |
| OVERLAP | 96 | 69.79% | 38.00 | 47.85 | -9.85 | 94.50 | 1.00 |

## Month

| Group | Trades | Win rate | Gross R | Cost drag | Net R | Median stop pips | Median planned RR |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-05 | 176 | 67.61% | 62.00 | 89.34 | -27.34 | 92.51 | 1.00 |
| 2026-06 | 207 | 69.57% | 81.00 | 105.06 | -24.06 | 91.01 | 1.00 |
| 2026-07 | 60 | 70.00% | 24.00 | 29.94 | -5.94 | 94.50 | 1.00 |

## Stop-width bucket

| Group | Trades | Win rate | Gross R | Cost drag | Net R | Median stop pips | Median planned RR |
|---|---:|---:|---:|---:|---:|---:|---:|
| 20–<40p | 3 | 66.67% | 1.00 | 1.80 | -0.80 | 38.28 | 1.00 |
| 40p+ | 440 | 68.86% | 166.00 | 222.54 | -56.54 | 91.86 | 1.00 |

## Viability rule

**NOT COST-VIABLE IN THIS WINDOW.** Do not add filters first. Validate broker cost assumptions and stop geometry; pause strategy if realistic-cost sensitivity remains negative.
