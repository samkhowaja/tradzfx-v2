# Deep-dive: `smart_risk_ob_ifvg_1m` — 90-day XAUUSD PIT backtest

Date: 2026-06-15  
Instrument: XAUUSD 1m  
Range: 2026-03-21 → 2026-06-19 (90 days)  
Runner: `scripts/backtest-pit-v2.js`  

## 1. Goals of this deep-dive

1. Explain why losing streaks occur and why every winner is the same size.
2. Test whether winners can be "left to run" to a structural level instead of a fixed R target.
3. Catalogue the architectural / algorithmic defects found in the V2 engine and backtester so they can be fixed before live deployment.

---

## 2. Baseline spec (`smart_risk_ob_ifvg_1m`)

```yaml
risk:
  sl: "atr(5m) * 1.5"
  tp: "sl * 2.0"
  minRR: 2.0
  timeoutBars: 120
```

### 2.1 90-day results

| Metric | Value |
|---|---|
| Raw signals | 236 |
| Executed | 115 |
| Skipped (portfolio heat) | 121 |
| Wins | 46 |
| Losses | 48 |
| Timeouts | 21 |
| Win rate | 48.9% |
| Net R | **+52.89R** |
| Avg win | +2.00R |
| Avg loss | -1.00R |
| Max consecutive losses | **4** (2026-04-14 09:40–11:25) |

### 2.2 Why every winner is exactly +2.00R

The spec declares `tp: "sl * 2.0"` and `minRR: 2.0`. The risk compiler clamps the effective take-profit to the `minRR` value, so every winning trade exits at precisely 2R. This is not a bug, but it removes any possibility of capturing larger structural moves.

### 2.3 Losing-streak profile

- Average hold: **wins 10.4 bars, losses 25.6 bars, timeouts 120 bars**.
- Losses resolve ~2.5× slower than wins, indicating the strategy is often entering just before the intended reversal accelerates against it.
- The worst streak (4 losses in a row) happened on 2026-04-14 in the London/overlap window. All four trades flipped direction quickly and were stopped.
- There is **no daily-loss gate** or circuit-breaker in this spec, so a 4-loss streak would cost -4% of account balance at 1% risk per trade.

### 2.4 Session breakdown

| Session | Trades | Wins | Losses | Timeouts | WR |
|---|---:|---:|---:|---:|---:|
| LONDON | 73 | 30 | 35 | 8 | 46.2% |
| NY | 42 | 16 | 13 | 13 | 55.2% |

London is materially weaker. The current spec does not reduce size or tighten filters for London.

---

## 3. Can winners be left to run?

Three TP variants were tested while keeping the same setup / entry / gate logic.

### 3.1 Variant A — fixed 3R (`smart_risk_ob_ifvg_1m_3r`)

```yaml
risk:
  tp: "sl * 3.0"
  minRR: 3.0
  timeoutBars: 180
```

| Metric | Value |
|---|---|
| Executed | 116 |
| Wins | 36 |
| Losses | 62 |
| Timeouts | 18 |
| Win rate | 36.7% |
| Net R | **+55.47R** |
| Avg win | +3.00R |
| Max consecutive losses | **7** |

Verdict: only marginally better net R than baseline, with a much lower win rate and longer loss streaks. Pure 3R is **not** the right answer for this setup.

### 3.2 Variant B — run to nearest swing pivot, minRR 1.0 (`smart_risk_ob_ifvg_1m_runon`)

```yaml
risk:
  tp: "nearest_profit_pivot"
  tpOffsetPips: 0
  minRR: 1.0
  timeoutBars: 240
```

| Metric | Value |
|---|---|
| Executed | 199 |
| Wins | 146 |
| Losses | 48 |
| Timeouts | 5 |
| Win rate | 75.3% |
| Net R | **+102.02R** |
| Avg win | +1.04R |
| Max consecutive losses | **4** |
| Session WR (LONDON / NY) | 65.7% / 85.3% |

Targeting the nearest opposing swing pivot dramatically improves both win rate and net expectancy. Most targets are small (~1R), but the high hit rate compensates.

### 3.3 Variant C — run to nearest swing pivot, minRR 1.5 (`smart_risk_ob_ifvg_1m_runon_15r`)

```yaml
risk:
  tp: "nearest_profit_pivot"
  tpOffsetPips: 0
  minRR: 1.5
  timeoutBars: 240
```

| Metric | Value |
|---|---|
| Executed | 172 |
| Wins | 112 |
| Losses | 51 |
| Timeouts | 9 |
| Win rate | 68.7% |
| Net R | **+120.80R** |
| Avg win | +1.52R |
| Max consecutive losses | **4** |
| Session WR (LONDON / NY) | 56.5% / 82.1% |

Raising the floor from 1.0R to 1.5R filters out the smallest pivot targets and produces the **best net R (+120.80R)** while keeping the max loss streak at 4. This is the strongest candidate for the next version of the strategy.

### 3.4 Comparison

| Variant | Net R | WR | Avg Win | Max Loss Streak | Timeouts |
|---|---:|---:|---:|---:|---:|
| Baseline 2R | +52.89 | 48.9% | 2.00R | 4 | 21 |
| Fixed 3R | +55.47 | 36.7% | 3.00R | 7 | 18 |
| Pivot minRR 1.0 | +102.02 | 75.3% | 1.04R | 4 | 5 |
| Pivot minRR 1.5 | +120.80 | 68.7% | 1.52R | 4 | 9 |

**Answer to the runner question:** yes — but only when the run-on target is a **structural level** (nearest opposing swing pivot) rather than a fixed higher R ratio. A 1.5R floor appears to be the sweet spot on this 90-day sample.

---

## 4. Architectural / algorithmic defects found

These defects were identified during the deep-dive and should be fixed before promoting any variant to live trading.

### 4.1 Feature-engine defects

| # | File | Defect | Impact | Severity |
|---|---|---|---|---|
| 1 | `features_liquidity_pools.ts` | `recentSweepMatched` uses the same extreme price for bullish and bearish sweeps (`latestSweep.extreme` in both branches). | Bullish/bearish sweep matching is indistinguishable; pool-sweep signals are unreliable. | High |
| 2 | `features_structure.ts` | MSS bullish logic compares two consecutive pivot prices (`pivot.price > prevPivot.price`) instead of confirming a close above the previous swing high. | Weak expansions can be mis-labelled as MSS, producing premature entries. | High |
| 3 | `features_structure.ts` | `choch` events are detected in the loop but never emitted (`eventType` map only allows `bos`/`mss`). | Strategy misses change-of-character context; OB coverage drops. | Medium |
| 4 | `features_order_block.ts` | Only reacts to `bos` and `mss`; ignores `choch`. | Fewer order blocks, especially on 15m, contributing to sparse signals. | Medium |
| 5 | `features_order_block.ts` | OB range uses the full candle high/low, not the body. | Zones are very wide; SL is pushed far away, giving price more room to run against the trade. | Medium |
| 6 | `features_ifvg.ts` | iFVG reversal is decided by a **single closing price** relative to the zone. | Signal flickers; late/fading iFVGs are accepted, causing entries after the reversal is already fading. | High |
| 7 | `features_zone.ts` | Supply/demand zones require a strong-body candle (`body/range > 0.6`) with a pivot within 5 minutes. | Misses valid consolidation-born zones; one reason the other two Smart-Risk specs produced very few signals. | Medium |
| 8 | `features_pricing.ts` | XAUUSD premium/discount uses a 20-bar range and classifies >75% / <25%; on Gold this is too coarse for 15m entries. | Discount/premium filter is noisy and may admit poor locations. | Low-Medium |

### 4.2 Backtester / gate defects

| # | File | Defect | Impact | Severity |
|---|---|---|---|---|
| 9 | `scripts/backtest-pit-v2.js` | Pending limit/stop orders are not tracked correctly in `activeOrders`; `closedAt` uses `holdBars`, which is undefined/unreliable for `no_fill` outcomes. | Fill timing and gate interactions may be wrong for limit/stop entries. | Medium |
| 10 | `scripts/backtest-pit-v2.js` | Portfolio-heat gate counts executed orders by timestamp overlap, which can over-throttle multiple signals that land on the same bar. | Throughput may be artificially suppressed and the backtest may not reflect real portfolio-heat behaviour. | Medium |
| 11 | `scripts/backtest-pit-v2.js` | Date-range expansion appears broken: `365` and `90` day runs return the same 236 raw signals. | Cannot run genuine out-of-sample / longer-history tests until fixed. | High |

### 4.3 Recommended fix order

1. `features_liquidity_pools.ts` sweep-direction fix (high, easy).
2. `features_ifvg.ts` reversal confirmation logic (high).
3. `features_structure.ts` MSS close-based confirmation + CHoCH emission (high).
4. `features_order_block.ts` use CHoCH and body-based OB range (medium).
5. Backtester date-range and portfolio-heat fixes (high for validation).
6. `features_zone.ts` and `features_pricing.ts` refinements (medium).

---

## 5. Immediate next steps

1. **Adopt `smart_risk_ob_ifvg_1m_runon_15r` as the primary candidate.** It produced the best 90-day result (+120.80R, 68.7% WR) with the same max loss streak (4) as baseline.
2. **Add a daily-loss / circuit-breaker gate** (e.g. pause after -3R in a session) before paper trading.
3. **Investigate London underperformance.** Consider either tightening London filters or reducing position size during 08:00–11:30 UTC.
4. **Tighten the iFVG trigger** as an experiment: require `strength_score >= 0.6` and `age_bars <= 10` to reduce late/fading entries.
5. **Fix the 11 defects above** and re-run the full history once the backtester date-range bug is resolved.
6. **Do not promote to live** until the engine defects are fixed and the strategy is validated on a genuinely longer / out-of-sample window.

---

## 6. Files produced by this deep-dive

- `packages/strategies/src/specs/smart_risk_ob_ifvg_1m_3r.yaml`
- `packages/strategies/src/specs/smart_risk_ob_ifvg_1m_runon.yaml`
- `packages/strategies/src/specs/smart_risk_ob_ifvg_1m_runon_15r.yaml`
- `reports/smart_risk_ob_ifvg_1m_90d_trades.json`
- `reports/smart_risk_ob_ifvg_1m_3r_90d_trades.json`
- `reports/smart_risk_ob_ifvg_1m_runon_90d_trades.json`
- `reports/smart_risk_ob_ifvg_1m_runon_15r_90d_trades.json`
- `scripts/analyze-trades.js`
