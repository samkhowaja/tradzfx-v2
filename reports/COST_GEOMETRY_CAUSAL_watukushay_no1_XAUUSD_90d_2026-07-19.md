# Cost and Payoff Geometry — watukushay_no1 / XAUUSD

**Generated:** 2026-07-19T20:08:51.273Z
**Window:** trailing 90 days
**Mode:** shadow with strict setup grading, normal modeled costs, gate rejection observed but not enforced

## Method

Every decisive trade exits at authored TP or SL. Gross R therefore equals planned reward/risk for wins and -1R for losses. Cost drag equals gross R minus simulator net R and includes modeled entry/exit spread, slippage, and commission effects. This is attribution, not a second simulation.

## Overall

| Trades | Win rate | Gross R | Cost drag | Net R | Median stop | Median planned RR | Median cost drag/trade |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 45 | 22.22% | -25.00 | -8.07 | -16.93 | 94.64p | 1.00 | -0.432R |

Median-RR gross breakeven win rate: 50.00%. Observed win rate: 22.22%.

## Direction

| Group | Trades | Win rate | Gross R | Cost drag | Net R | Median stop pips | Median planned RR |
|---|---:|---:|---:|---:|---:|---:|---:|
| buy | 9 | 22.22% | -5.00 | -1.48 | -3.52 | 94.13 | 1.00 |
| sell | 36 | 22.22% | -20.00 | -6.60 | -13.40 | 104.86 | 1.00 |

## Session

| Group | Trades | Win rate | Gross R | Cost drag | Net R | Median stop pips | Median planned RR |
|---|---:|---:|---:|---:|---:|---:|---:|
| ASIA | 12 | 25.00% | -6.00 | -0.66 | -5.34 | 89.86 | 1.00 |
| LONDON | 7 | 14.29% | -5.00 | -2.61 | -2.39 | 152.30 | 1.00 |
| NY | 10 | 20.00% | -6.00 | -2.62 | -3.38 | 90.71 | 1.00 |
| OFF_HOURS | 3 | 33.33% | -1.00 | -0.68 | -0.32 | 130.47 | 1.00 |
| OVERLAP | 13 | 23.08% | -7.00 | -1.51 | -5.49 | 94.13 | 1.00 |

## Month

| Group | Trades | Win rate | Gross R | Cost drag | Net R | Median stop pips | Median planned RR |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-05 | 21 | 28.57% | -9.00 | -1.14 | -7.86 | 96.66 | 1.00 |
| 2026-06 | 20 | 15.00% | -14.00 | -6.28 | -7.72 | 102.67 | 1.00 |
| 2026-07 | 4 | 25.00% | -2.00 | -0.65 | -1.35 | 76.30 | 1.00 |

## Stop-width bucket

| Group | Trades | Win rate | Gross R | Cost drag | Net R | Median stop pips | Median planned RR |
|---|---:|---:|---:|---:|---:|---:|---:|
| 20–<40p | 1 | 100.00% | 1.00 | 0.78 | 0.22 | 38.28 | 1.00 |
| 40p+ | 44 | 20.45% | -26.00 | -8.85 | -17.15 | 95.65 | 1.00 |

## Viability rule

**NOT COST-VIABLE IN THIS WINDOW.** Do not add filters first. Validate broker cost assumptions and stop geometry; pause strategy if realistic-cost sensitivity remains negative.
