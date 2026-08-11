# ORB Retest/RVOL Professional Analysis — 2026-07-19

## Scope

Read-only, PIT-safe XAUUSD ORB research. Production strategy specs, live execution, order path, and existing shadow evidence remain unchanged.

Requested window: 2025-07-18 through 2026-07-18. Usable feature intersection produced trades only from April through June 2026. Results therefore do not represent a full year.

Contract:

1. Completed London opening range.
2. As-of bias-aligned 1m close breakout.
3. Later boundary retest.
4. Directional reclaim after retest.
5. Structural stop beyond retest extreme.
6. 2R target.
7. Registry spread and commission.
8. Natural SL/TP resolution with `sl_first` intrabar handling.

Volume means broker tick volume, not centralized traded volume. Rolling RVOL denominator uses previous 20 candles only.

## Main Results

| Variant | Trades | Wins | Losses | Net R | Expectancy | PF | Max DD |
|---|---:|---:|---:|---:|---:|---:|---:|
| Retest + reclaim | 15 | 9 | 6 | +7.98R | +0.53R | 2.20 | 2.28R |
| Breakout RVOL >= 1.2 | 5 | 4 | 1 | +5.32R | +1.06R | 5.96 | 1.07R |
| Contracting retest volume | 11 | 7 | 4 | +7.22R | +0.66R | 2.67 | 1.11R |
| Contracting + renewed volume | 4 | 2 | 2 | +1.22R | +0.31R | 1.56 | 1.11R |
| Reclaim extension <= 0.5 ATR | 13 | 8 | 5 | +7.22R | +0.56R | 2.28 | 2.28R |

No variant has enough trades for promotion.

## Baseline Diagnostics

- Win rate: 60.0%.
- Median hold: 4 bars.
- 90th-percentile hold: 10.2 bars.
- Median MAE: 0.95R.
- 90th-percentile MAE: 1.74R.
- Median MFE: 1.84R.
- Open/right-censored trades: 0.

Median MAE near 1R shows many trades test structural risk deeply before resolution. Results are sensitive to spread, stop placement, and `sl_first`; existing conservative assumptions must remain.

## Stability

### Month

| Month | Trades | Net R | Expectancy | PF |
|---|---:|---:|---:|---:|
| 2026-04 | 2 | +0.66R | +0.33R | 1.57 |
| 2026-05 | 7 | +3.10R | +0.44R | 1.92 |
| 2026-06 | 6 | +4.23R | +0.70R | 2.96 |

All observed months positive, but April contains only two trades.

### Direction

| Direction | Trades | Win Rate | Net R | Expectancy | PF |
|---|---:|---:|---:|---:|---:|
| Bullish | 7 | 71.4% | +5.43R | +0.78R | 3.35 |
| Bearish | 8 | 50.0% | +2.55R | +0.32R | 1.59 |

Both directions positive. Bullish side stronger, but sample too small for direction gating.

### Session

All trades use London opening range by strategy contract. No cross-session conclusion is possible.

## Matched-Cohort Finding

Contracting-retest-volume candidate retained 11 of 15 baseline trades. On those same 11 setup keys:

- Baseline: 7W/4L, +7.22R, expectancy +0.66R, PF 2.67.
- Candidate: identical results.
- Entry timestamps: identical.

Meaning: contracting-volume rule is a selection filter, not execution improvement. Apparent improvement comes entirely from excluding four baseline trades. This is valid research behavior, but highly exposed to selection overfit.

## Interpretation

1. Plain retest/reclaim remains best-supported mechanism by count, but only 15 trades.
2. Contracting retest volume improves observed risk profile while retaining most profit. Eleven trades remain insufficient.
3. Breakout RVOL >= 1.2 looks strongest numerically but has only five trades. Treat as hypothesis, not edge.
4. Renewed-entry-volume condition over-filters and lacks evidence.
5. Extension cap adds little.
6. Forex results from prior all-symbol run were broadly negative. Mechanism currently appears XAUUSD-specific, not universal.

## Decision

Do not modify `orb_scalper_1m`. Do not promote any variant. Do not merge results into existing shadow acceptance evidence.

## Data Ceiling Finding (2026-07-19 follow-up)

Coverage audit:

- Canonical XAUUSD 1m candles: fragments only before 2026-04-07 (a few hundred bars in Jan/Jul 2025 and Jan 2026). Contiguous dense history begins **2026-04-07**.
- `features_opening_range` (london 15m): from 2026-03-20.
- `features_bias` (15m) / `features_atr` (1m): from 2026-03-19.

Feature backfill before 2026-04-07 is impossible — there is no candle history to compute from. The maximum historical window is therefore **2026-04-07 → 2026-07-18**.

Rerun over that maximum window (report `orb-retest-rvol-xauusd-maxhistory-2026-07-19.json`):

| Variant | Trades | Wins | Losses | Net R | Expectancy | PF | Max DD |
|---|---:|---:|---:|---:|---:|---:|---:|
| Retest + reclaim | 16 | 9 | 7 | +6.78R | +0.42R | 1.86 | 2.31R |
| Contracting retest volume | 12 | 7 | 5 | +6.01R | +0.50R | 2.09 | 2.31R |
| Breakout RVOL >= 1.2 | 6 | 4 | 2 | +4.10R | +0.68R | 2.78 | 1.22R |

Extending from 2026-04-18 to 2026-04-07 added exactly **1 trade**. The setup is inherently selective: ~4–5 trades/month on XAUUSD. The historical sample ceiling is ~16 trades; no amount of backfill can change that with existing data.

**Consequence:** the ≥50-trade evidence gate cannot be met historically. The only path is a separate orderless forward shadow (~10–12 months at current frequency), run alongside the existing baseline shadow, with frozen thresholds.

## Next Evidence Gate

Historical data is exhausted. With user approval, launch a separate orderless forward shadow for the two candidates (plain reclaim; contracting-volume reclaim) with frozen thresholds, preserving the existing baseline shadow. Acceptance remains: ≥50 unseen resolved shadow trades, positive expectancy, PF ≥ 1.20, zero chronology defects, DB reconciliation, fresh producers.

## Artifacts

- Harness: `scripts/backtest-orb-retest-rvol.js`
- Regression tests: `scripts/backtest-orb-retest-rvol.test.js`
- Extended report: `reports/orb-retest-rvol-xauusd-extended-2026-07-19.json`
- Earlier all-symbol report: `reports/orb-retest-rvol-all-symbols-2026-07-19.json`

Validation: focused tests 8/8 passed; full `pnpm test` passed.
