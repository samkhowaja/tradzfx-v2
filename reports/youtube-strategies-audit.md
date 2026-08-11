# Audit Report — Seeded YouTube Strategy Families

**Scope:** Verify candle aggregation, time-frame alignment, feature calculations and explain why the backtested results diverge from the “best case” expectations shown in the source videos.

**Strategies audited:**

| Family | Run ID | Trades | Wins | Net R |
|---|---|---:|---:|---:|
| `four_hour_opening_range_fade` | `4h-fade-1782872892627` | 27 | 13 | **+9.23** |
| `breakout_retest_continuation` | `bo-retest-1782877393173` | 27 | 9 | **-0.84** |
| `one_minute_fib_gold_zone_scalp` | `1m-fib-1782879920964` | 147 | 76 | **-4.05** |
| `nine_thirty_manipulation_fade` | `930-fade-1782882301223` | 19 | 2 | **-17.10** |

---

## 1. Candle aggregation verification

The multi-time-frame data in `tradementor_v2` is internally consistent.

**Spot-check — 5m vs 1m (2026-06-02 10:05 UTC):**

```text
5m 10:05  O=1.16485  H=1.16485  L=1.16461  C=1.16475
1m 10:00-10:05            H=1.16499  L=1.16466
1m 10:05-10:10  H=1.16485  L=1.16461
```

The 5m bar stamped `10:05` matches the 1m aggregate for `10:05-10:10`, not `10:00-10:05`.

**Spot-check — 15m vs 1m (2026-06-02 13:30 UTC):**

The 15m bar stamped `13:30` matches the 1m aggregate for `13:30-13:45`.

**Conclusion:** timestamps are **end-of-period** labels. Any code that treats them as start-of-period labels is off by one bar. The OHLC math itself is correct.

---

## 2. Time-frame / session alignment

### 2.1 `four_hour_opening_range_fade` (5m)

Script logic:

```js
const rangeBars = dayBars.slice(0, 48);
```

Because `candles_5m` starts each UTC day with a `00:00` rollover/placeholder bar, `slice(0,48)` grabs the bar covering `23:55-00:00` of the prior day plus bars through `03:50-03:55`. It **misses** the `03:55-04:00` bar and **includes** a pre-midnight bar.

The intended 4-hour opening range (`00:00-04:00 UTC`) should be selected explicitly, e.g.:

```sql
WHERE ts::time BETWEEN '00:05' AND '04:00'
```

(or shift to the session the video actually uses — the source video does not state UTC, so the current choice is an assumption).

**Impact:** usually small because the `00:00` bar is often flat, but on rollover days it can distort the range high/low by a few pips and change the exact breakout/re-entry candle.

### 2.2 `breakout_retest_continuation` (5m)

Same issue. The first hour of the day is taken as the first 12 bars:

```js
const rangeBars = dayBars.slice(0, 12);
```

That is approximately `23:55-01:00` rather than `00:00-01:00`. Again, should be time-filtered.

### 2.3 `nine_thirty_manipulation_fade` (15m / 1m)

The script anchors to the 15m bar with `ts = 13:30:00` UTC. With end-of-period labels that bar covers `13:30-13:45` UTC, which is exactly `09:30-09:45` EDT. The **timestamp mapping is correct**.

However, the strategy assumes EURUSD exhibits the classic NY-open liquidity-grab pattern. The available dataset is quiet/synthetic around that time, so the “manipulation” candle is often a genuine continuation move rather than a stop-run to fade.

### 2.4 `one_minute_fib_gold_zone_scalp` (1m)

Uses 1m candles directly and `features_pivot` (1m swing highs/lows). No higher-time-frame alignment issue.

---

## 3. Feature calculation audit (`features_pivot`)

`apps/engine/src/features/pivot.ts` detects swing highs/lows with a 5-bar lookback (`lookback=5`) and strict greater-than/less-than neighbors. Spot checks confirmed the pivot prices line up with actual candle highs/lows.

The `features_pivot` table can emit consecutive rows of the same kind. The 1m Fib script normalizes this by keeping only the most extreme price when the kind repeats. That is a reasonable pragmatic choice, but it means the backtest depends on post-processing logic that is not encoded in the generic feature pipeline.

---

## 4. Per-strategy backtest logic review

### 4.1 4-Hour Opening-Range Fade

Logic:
1. First 48 × 5m bars = opening range.
2. Wait for a **close** outside the range.
3. Wait for a **close** back inside.
4. Fade the breakout; SL at the breakout extreme; TP at 2R.

**Observations:**
- The SL is the true extreme reached **after** the breakout, not the breakout candle close. That is more conservative than the video description (“SL at the exact extreme of the breakout candle”) but it is defensible.
- A 2R target is fixed regardless of the structure of the day.
- Result: +9.23R / 27 trades. Positive, but with only ~1 trade/day and a wide SL, drawdowns can be large.

### 4.2 Breakout-Retest Continuation

Logic:
1. First 12 × 5m bars = 1-hour opening range.
2. Wait for close breakout.
3. Wait for close back inside the range (retest).
4. Trade the **continuation** direction; SL at the opposite side of the range; TP at 2R.

**Observations:**
- The SL is the full opposite side of the 1-hour range, which can be very wide.
- The continuation/fade decision is the opposite of the 4h strategy; on a choppy EURUSD dataset that explains why the two strategies partially offset each other.
- Result: -0.84R / 27 trades — essentially break-even.

### 4.3 1-Minute Fib Gold-Zone Scalp

Logic:
- Needs a break-of-structure sequence: lower highs + lower lows (short) or higher lows + higher highs (long).
- Entry at the 61.8% retracement of the last swing.
- SL at the swing origin (H1 for shorts, L1 for longs).
- TP at the previous swing extreme.
- 15-bar time-out; setups invalidated if price retraces past the swing origin.

**Observations:**
- The reward target is only the prior swing low/high. Because the market is making lower lows, the prior low is often not far below the 61.8% entry, producing reward/risk ratios below 1.
- Time-out after 15 bars exits many trades before they can reach target, turning potential winners into small losses.
- Average win = **+0.54R**, average loss = **-0.64R**.
- With a 50% hit rate and negative average expectancy, the strategy is mathematically unprofitable on this dataset.

**Fix ideas:** target a 1.272 / 1.618 extension instead of the prior swing; require minimum RR > 1 before taking a setup; widen time-out or trail the SL.

### 4.4 9:30 Manipulation Fade

Logic:
- 15m opening range = `13:30` UTC bar (NY 9:30-9:45 EDT).
- Look for the first post-open 15m bar whose range is larger than the trailing 96-period average range and which wicks beyond the opening range but closes back inside.
- Fade the manipulation direction; enter at the manipulation close; SL at the opening-range extreme; TP at the 61.8% level of the opening range.

**Observations:**
- ATR is a simple mean of 96 ranges, not Wilder smoothing. This is acceptable but less standard.
- The entry is the **close** of the manipulation candle. In a true stop-run, the close is already back inside the range, but it can still be far from the best fade price.
- TP is only the 61.8% internal level of the opening range, so reward is small relative to the risk (which is the full opening range).
- The strategy does not re-evaluate after the manipulation candle; if the next candle continues the manipulation direction, the SL is hit quickly.
- Result: **19 trades, 2 wins, -17.10R**. The EURUSD dataset at 13:30 UTC is not producing the expected reversal pattern; the “manipulation” candle is usually followed by continuation.

---

## 5. Why results diverge from the “best” YouTube expectations

1. **Cherry-picked examples.** YouTube demonstrations select the cleanest, most favourable charts. A rules-based backtest fires on every valid setup, including the mediocre ones.
2. **Instrument/session mismatch.** The videos use gold, crypto and various forex pairs; we are running every strategy only on EURUSD. NY-open manipulation patterns may not appear on EURUSD in this dataset.
3. **Timestamp/session assumptions.** Opening-range strategies assume UTC midnight or 13:30 UTC equals the correct session. That is an approximation; the source videos rarely specify the broker/session timezone.
4. **Execution assumptions are too optimistic.** Limit fills are assumed as soon as price touches the level. Spread, slippage, commission and partial fills are ignored.
5. **Risk/reward math is weak.** The 1m Fib and 930-fade strategies target small rewards while risking large structural swings. A 50% win rate is not enough when average wins are smaller than average losses.
6. **Generic SQL compiler is disabled.** Each family uses dummy `setup`/`entry` predicates so the live pipeline cannot actually generate signals. The backtests come from standalone scripts, not the unified engine, which means live forward-testing is not yet possible.

---

## 6. Recommended fixes (priority order)

| Priority | Fix | Affects |
|---|---|---|
| High | Replace `slice(0,N)` day-bar slicing with explicit `ts::time` filters for opening ranges. | 4h range, 1h breakout |
| High | Make the generic SQL compiler predicates real so the strategies can run in the live pipeline. | all four |
| Medium | For 930 fade, require a confirming 1m close back inside the range before entry and target the opposite side of the opening range (or use fixed 1R). | 930 fade |
| Medium | For 1m Fib, target a Fib extension (1.272 / 1.618) and require RR > 1; remove or extend the 15-bar hard time-out. | 1m Fib |
| Medium | Add spread/slippage and realistic limit-fill assumptions to all backtests. | all four |
| Low | Re-run on the instruments and sessions actually shown in each video (XAUUSD, BTC, etc.) instead of forcing everything onto EURUSD. | all four |

---

## 7. Verdict

- **Candle aggregation:** correct.
- **Feature calculations:** correct, but need post-processing normalization.
- **Time-frame alignment:** mostly correct, except for the off-by-one 5m bar in opening-range strategies.
- **Backtest logic:** mechanically faithful to the written rules, but the rules themselves have weak expectancy on this EURUSD dataset.
- **Divergence from “best” results:** explained by cherry-picked video examples, EURUSD/session mismatch, optimistic execution assumptions and sub-optimal risk/reward targets.

**None of the four strategies currently proves an edge on the EURUSD data.** The only positive performer (4h range fade, +9.23R) is borderline with a wide-stop, low-frequency profile and should be re-run after fixing the timestamp alignment before any capital is allocated.
