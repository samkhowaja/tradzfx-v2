# A+ ORB FVG Strategy Extraction + Backtest Report

> **Deprecation note (post 099_features_fvg_consolidation):** The standalone
> `features_fvg` table referenced in this report has been retired. FVG rows are
> now stored in `features_zone` with `zone_kind = 'fvg'`, and the
> `a_plus_orb_fvg_5m` spec has been updated accordingly. The historical findings
> below are preserved, but any mention of `features_fvg` should be read as
> `features_zone` FVG rows.

Generated: 2026-07-08

## Extracted Rules

Source: supplied YouTube transcript for `https://www.youtube.com/watch?v=ed66iN6hNFE`.

1. At 9:45 New York time, mark the high/low of the first 15-minute cash-session candle: 9:30-9:45.
2. Switch to 5-minute candles and wait until noon New York for a break outside that range.
3. Only trade if the break creates a same-direction 5m fair value gap.
4. Direction:
   - Bullish FVG above opening range high -> buy.
   - Bearish FVG below opening range low -> sell.
5. Entry: limit order at the FVG midpoint.
6. Stop: base of candle 1 in the three-candle FVG pattern.
7. Target: fixed 2R.
8. Choppy-day filter: no FVG, no trade; mix-up/steady days are allowed only if the valid FVG forms before noon.

Implemented spec: `packages/strategies/src/specs/a_plus_orb_fvg_5m.yaml`.

## Engine Changes Made

The existing strategy DSL could detect FVGs as entry conditions, but it could not use an FVG as the signal source. I added:

- `signalSource: fvg` to strategy typing.
- FVG price tokens:
  - `fvg_midpoint`
  - `fvg_top`
  - `fvg_bottom`
  - `fvg_c1_high`
  - `fvg_c1_low`
  - `fvg_c1_stop`
- PIT backtester support for FVG signals (now reading `features_zone` with `zone_kind = 'fvg'` after the FVG consolidation).
- Direct 9:30-9:45 NY opening candle lookup from `candles_15m`, because `features_opening_range` currently defines `ny` at 16:00 UTC, which is not the transcript’s 9:30 NY candle.

## Backtest Results

### PIT Engine Result

Command:

```powershell
node scripts/backtest-pit-v2.js ALL 90 a_plus_orb_fvg_5m --json --trades
```

Result:

- Raw signals: 2
- Executed trades: 0
- Setup-engine blocked: 2
- Win rate: 0%
- Net R: 0

Diagnostic bypass:

```powershell
$env:PIT_SKIP_SETUP_ENGINE='1'
node scripts/backtest-pit-v2.js ALL 90 a_plus_orb_fvg_5m --json --trades
Remove-Item Env:PIT_SKIP_SETUP_ENGINE
```

Result with setup-engine bypass:

- Raw signals: 2
- Executed trades: 0
- Timeouts/no fills: 2
- Win rate: 0%
- Net R: 0

### Raw Candle Diagnostic Result

Command:

```powershell
node scripts/backtest-a-plus-orb-fvg-raw.js 90
```

This bypasses feature tables and aggregates `candles_1m` into 5m/15m bars in memory.

Result:

- Setups/trades: 458
- Wins: 98
- Losses: 212
- No-fill/timeouts: 148
- Win rate on decided trades: 31.6%
- Win rate if no-fills are counted as failed opportunities: 21.4%
- Net R: -16R

By symbol:

| Symbol | Trades | Wins | Losses | Timeouts | WR decided |
| --- | ---: | ---: | ---: | ---: | ---: |
| AUDUSD | 48 | 10 | 24 | 14 | 29.4% |
| EURUSD | 49 | 12 | 22 | 15 | 35.3% |
| GBPUSD | 48 | 10 | 24 | 14 | 29.4% |
| NZDUSD | 48 | 8 | 24 | 16 | 25.0% |
| USDCAD | 53 | 10 | 25 | 18 | 28.6% |
| USDCHF | 54 | 9 | 27 | 18 | 25.0% |
| USDJPY | 48 | 11 | 24 | 13 | 31.4% |
| USDSEK | 58 | 19 | 20 | 19 | 48.7% |
| XAUUSD | 52 | 9 | 22 | 21 | 29.0% |

The volume claim is plausible on raw candles: 458 setups over 90 calendar days, roughly 7.4 setups per available OR day across 9 symbols. The 65-80% WR claim is not supported by this dataset under the extracted rules.

## Failure Inventory

1. **The engine had no FVG signal source.** Before this change, a transcript-faithful FVG midpoint entry with candle-1 stop could not be represented.
2. **`features_opening_range` uses the wrong NY anchor for this strategy.** It hardcodes `ny: 16` UTC, while the transcript uses the 9:30-9:45 New York candle. During the current April-July data window that is 13:30-13:45 UTC.
3. **`candles_5m` is shallow/incomplete.** Raw `candles_1m` has about 84k-98k rows per symbol over 90 days, but `candles_5m` only has a few hundred rows per symbol starting around July 5-8. That alone prevents a normal 90-day 5m feature backtest.
4. **`features_zone` FVG 5m is shallow/incomplete.** Stored 5m FVG rows mostly begin July 6-8. Only USDCHF had stored qualifying OR-break FVG rows, just 7 rows over 2 days.
5. **`features_fvg.age_bars` is not safe as a formation filter (historical).** Before consolidation, qualifying stored rows showed `age_bars=80`, not `0`, because feature rows were updated/recomputed over a rolling window. A strategy predicate like `age_bars = 0` silently blocked valid setups. The unified `features_zone` does not rely on `age_bars` for FVG freshness.
6. **`features_spread` is unreliable for setup grading.** 5m/15m spread rows contain absurd values such as USDCHF 133.85p, USDSEK 283.3p, and USDCAD 77.5p. The setup engine blocked the only PIT signals because of these bad spread rows.
7. **`candles_1m.spread` is healthier than `features_spread`.** Median raw 1m spreads are normal for majors, but `features_spread` HTF rows appear sparse and polluted by outliers or wrong aggregation.
8. **The generic setup engine is not strategy-specific.** It can block an ORB/FVG limit-entry strategy for HTF/spread/volatility reasons that are outside the video’s rule set. That is fine for live safety, but it should be optional in research backtests.
9. **DST handling is hardcoded in this spec.** The spec uses 13:45-16:00 UTC for NY 9:45-noon during daylight time. A year-round version needs an exchange/session calendar, not fixed UTC windows.
10. **Raw strategy has high signal volume but poor edge.** Even when feature tables are bypassed, the extracted rules produce 458 setups but only 31.6% decided WR at 2R.
11. **No-fill/timeouts are material.** 148 of 458 raw setups never filled or resolved inside the diagnostic windows. The video does not define order expiry or session close handling, so results are sensitive to this assumption.
12. **The video’s “any market” claim is too broad.** USDSEK was the only symbol near breakeven/positive profile in this raw test, and it is not a typical low-spread prop-firm FX major.

## Recommendations

1. Regenerate full 5m and 15m candle history from `candles_1m`, then rerun the FVG zone detector across the full 90 days (rows now land in `features_zone` with `zone_kind = 'fvg'`).
2. Fix or quarantine `features_spread` HTF rows before using setup-engine grading or spread gates in historical tests.
3. Keep `signalSource: fvg`; it is required for transcript-faithful FVG strategies.
4. Replace fixed UTC windows with NY session calendar logic before testing across DST boundaries.
5. Do not trust the 80% win-rate claim for this extracted rule set. On raw data it is far below the requested 65% threshold.
6. If optimizing, test filters that the video glosses over: first break only, exclude both-side range sweeps before FVG, minimum OR size, minimum FVG size in ATR/pips, trend/day bias, news exclusion, and stricter order expiry.
