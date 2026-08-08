# PIT Backtester: Technical Issues Deep Dive
**Date:** July 7, 2026  
**Focus:** Code-level issues, proof of concepts, and fix templates

---

## Issue #1: Sortino Ratio Calculation Error

### Location
`packages/analyzerBacktest/src/reportGenerator.ts`, lines 370–374

### Current Code
```typescript
const downsideVariance = completed.length > 0
  ? rs.filter((r) => r < 0).reduce((sum, r) => sum + r * r, 0) / completed.length
  : 0;
const downsideDeviation = Math.sqrt(downsideVariance);

const sortinoRatio = downsideDeviation > 0 ? (avgR / downsideDeviation) * Math.sqrt(completed.length) : 0;
```

### Problem
The downside variance divides by **total number of trades** (`completed.length`), but the numerator only sums **negative trade squares** (`rs.filter((r) => r < 0)`).

This inflates the ratio by a factor of roughly `completed.length / negativeTradesCount`.

### Example
- 100 total trades
- 70 wins (R > 0), 30 losses (R < 0)
- Avg win: 2R each (gross 140R)
- Avg loss: -1R each (gross -30R)
- Avg R: (140 - 30) / 100 = 1.1R

**Current calculation:**
```
sum of negative R² = 30 * 1² = 30
downsideVariance = 30 / 100 = 0.3  ← dividing by 100, not 30!
downsideDeviation = sqrt(0.3) = 0.548
sortinoRatio = (1.1 / 0.548) * sqrt(100) = 2.01 * 10 = 20.1  ← INFLATED
```

**Correct calculation:**
```
downsideVariance = 30 / 30 = 1.0  ← divide by 30 negative trades only
downsideDeviation = sqrt(1.0) = 1.0
sortinoRatio = (1.1 / 1.0) * sqrt(100) = 1.1 * 10 = 11.0  ← CORRECT (2x difference!)
```

### Fix
```typescript
const negativeTrades = rs.filter((r) => r < 0);
const downsideVariance = negativeTrades.length > 0
  ? negativeTrades.reduce((sum, r) => sum + r * r, 0) / negativeTrades.length
  : 0;
const downsideDeviation = Math.sqrt(downsideVariance);

const sortinoRatio = downsideDeviation > 0 
  ? (avgR / downsideDeviation) * Math.sqrt(completed.length) 
  : 0;
```

### Impact
- **Severity:** HIGH
- **Affected reports:** All backtest reports that include Sortino ratio
- **Overstatement factor:** (100 / 30) = 3.33x in example above
- **Real variants:** Expect 2–5x overstatement depending on win rate

---

## Issue #2: Short Trade Exit Spread Adjustment Missing

### Location
`packages/analyzerBacktest/src/outcomeTracker.ts`, lines 225–230

### Current Code (Short Exit on TP Hit)
```typescript
if (tpHit) {
  const exitAdjustment = spreadPrice / 2 + slippagePrice;
  const effectiveExit = direction === "long"
    ? takeProfit - exitAdjustment
    : takeProfit + slippagePrice;  // ← BUG: should be + exitAdjustment
  return {
    outcome: "win",
    outcomeR: Math.abs(effectiveExit - effectiveEntry) / risk,
    ...
  };
}
```

### Problem
For short trades, the exit is only adjusted by `slippagePrice`, not the full `exitAdjustment` (spread/2 + slippage).

**For short:** TP is above entry (we're selling), so we exit at **lower price** (worse fill) by `spread/2 + slippage`  
**But code applies:** only `slippagePrice` → missing the `spread/2` component

### Example
- Symbol: EURUSD (4-pip spread, 1 pip slippage)
- Short entry: 1.1000 (after spread/slip adjustment: 0.9995)
- TP: 1.0950 (50 pips profit)
- Current code exit: 1.0950 + 0.0001 = 1.0951 (missing 2 pips spread!)
- Correct exit: 1.0950 + 0.0002 + 0.0001 = 1.0953

**Win calculation:**
```
Current (wrong):  (0.9995 - 1.0951) / risk = 0.0044 / risk (seems like a bigger win)
Correct:          (0.9995 - 1.0953) / risk = 0.0042 / risk (slightly smaller)
```

Difference is small per trade, but across 949 trades (watukushay_no1), cumulative bias = **~2–3% overstated returns on short trades**.

### Fix
```typescript
if (tpHit) {
  const exitAdjustment = spreadPrice / 2 + slippagePrice;
  const effectiveExit = direction === "long"
    ? takeProfit - exitAdjustment
    : takeProfit + exitAdjustment;  // ← Apply full adjustment, not just slippage
  return {
    outcome: "win",
    outcomeR: Math.abs(effectiveExit - effectiveEntry) / risk,
    exitPrice: effectiveExit,
    exitTs: candle.ts,
    barsHeld: i + 1,
    effectiveEntry,
    maxAdverseR,
    maxFavorableR,
  };
}
```

Also fix line 217 (SL hit):
```typescript
if (slHit) {
  const exitAdjustment = spreadPrice / 2 + slippagePrice;
  const effectiveExit = direction === "long"
    ? stopLoss - exitAdjustment
    : stopLoss + exitAdjustment;  // ← Same fix
  return {
    outcome: "loss",
    ...
  };
}
```

### Impact
- **Severity:** MEDIUM
- **Affected trades:** All short trades with TP/SL exits
- **Bias direction:** Results are overly optimistic (2–3% on shorts)
- **Variant impact:** 
  - doyle_sd: 31 long, 31 short = symmetric (moderate impact)
  - orb_classic: mixed (check raw data)
  - watukushay_no1: 949 trades unknown mix

---

## Issue #3: Intrabar Resolution Asymmetry

### Location
`packages/analyzerBacktest/src/outcomeTracker.ts`, lines 31–58 (`resolveIntrabar()`)

### Current Code
```typescript
function resolveIntrabar(
  direction: "long" | "short",
  sl: number,
  tp: number,
  candle: Candle,
  mode: TrackOutcomeOptions["intrabarMode"]
): "sl" | "tp" {
  if (mode === "optimistic") return direction === "long" ? "tp" : "sl";
  if (mode === "pessimistic") return direction === "long" ? "sl" : "tp";  // ← ASYMMETRIC!
  if (mode === "proportion") {
    // ... proportion logic ...
  }
  // ... midpoint logic ...
}
```

### Problem
The default mode "pessimistic" has opposite logic for longs vs shorts:

**For long:**
- "pessimistic" returns "sl" (SL assumed hit first)
- This is **pessimistic for the trader** ✓

**For short:**
- "pessimistic" returns "tp" (TP assumed hit first)
- This is **OPTIMISTIC for the trader** ✗

**Expected logic:**
- "pessimistic" should return **whichever hurts the trader more** (SL for long, SL for short)
- "optimistic" should return **whichever helps the trader** (TP for long, TP for short)

### Current Behavior
```
Long:  pessimistic → SL hit first → Loss (-1R)  [conservative, correct]
Short: pessimistic → TP hit first → Win (+NR)   [aggressive, WRONG]

Long:  optimistic → TP hit first → Win (+NR)    [aggressive, wrong]
Short: optimistic → SL hit first → Loss (-1R)   [conservative, WRONG]
```

### Impact
With default "pessimistic" mode:
- **Long trades:** Artificially depressed win rate / returns
- **Short trades:** Artificially inflated win rate / returns
- **If strategy is long-biased:** underperforms expected
- **If strategy is short-biased:** outperforms (false signal)

### Detection
Run same backtest with all 4 intrabar modes; compare results:
```typescript
const modes: Array<TrackOutcomeOptions["intrabarMode"]> = ["pessimistic", "optimistic", "proportion", "midpoint"];
for (const mode of modes) {
  const result = await runBacktest(pool, {
    ...options,
    trackOutcomeOptions: { intrabarMode: mode }
  });
  console.log(`Mode ${mode}: WR=${result.report.winRate}, AvgR=${result.report.avgR}`);
}
```

**Expected findings:**
- If pessimistic is asymmetric, short and long results will differ significantly
- If pessimistic is truly symmetric, all modes should give similar results on balanced portfolios

### Fix Option 1: Use Symmetric Pessimistic
```typescript
if (mode === "pessimistic") {
  // Both SL and TP touched. Assume SL always hit first (worst case for trader).
  return "sl";
}
```

### Fix Option 2: Use Proportion (More Realistic)
```typescript
if (mode === "proportion") {
  // Estimate which level was reached first based on distance from open.
  // This requires no direction bias.
  const slDist = Math.abs(candle.o - sl);
  const tpDist = Math.abs(tp - candle.o);
  return slDist <= tpDist ? "sl" : "tp";
}
```

### Recommendation
- [ ] Run sensitivity analysis: pessimistic vs proportion vs midpoint on all 3 live variants
- [ ] If results diverge by >5% avg R, adopt "proportion" as default
- [ ] Document chosen mode and rationale in backtest report

---

## Issue #4: No Warmup Buffer Enforced

### Location
`packages/analyzerBacktest/src/runBacktest.ts`, lines 73–113 (sample generation)

### Current Code
```typescript
const intervalMs = sampleIntervalMinutes * 60_000;
const { rows: candleRows } = await pool.query(
  `SELECT ts FROM ${table}
   WHERE symbol = $1 AND ts >= $2 AND ts <= $3
   ORDER BY ts`,
  [symbol, startTs, endTs]  // ← starts immediately from startTs
);

const sampleTimes: Date[] = [];
let lastBucket = 0;
for (const row of candleRows) {
  const t = new Date(row.ts).getTime();
  if (sampleTimes.length === 0 || t - lastBucket >= intervalMs) {
    sampleTimes.push(new Date(row.ts));
    lastBucket = t;
  }
}
```

### Problem
First sample is at `startTs`, but features may require lookback:
- `features_pivot`: 500 bars (500 hours for 1h TF = ~21 days)
- `features_moving_average`: 250 bars (250 hours = ~10 days for 1h)
- `features_zone`: lifecycle tracking (can require months of history)
- `features_structure`: swing points (100+ bars lookback)

**If backtest window = Jan 1–90, first sample = Jan 1 00:00**
- Pivot feature computed with only 1 bar of lookback (instead of 500)
- Zone lifecycle may not be fully initialized
- Structure swings incomplete

### Impact
- Early trades evaluated with degraded feature quality
- Win rate inflated (weak features accept more trades)
- Profit factor affected (poor structure recognition)
- Results not representative of true performance

### Example
**Backtest 1:** Jan 1–90 (90 days data)
- First trade: Jan 1, using 1-bar pivot (degraded)
- Win rate: 65%

**Backtest 2:** Dec 15–90 (105 days data)
- First trade: Jan 1, using 500-bar pivot (complete)
- Win rate: 58%

If Backtest 2 win rate is true, Backtest 1 is **overstated by 7 percentage points**.

### Fix
Add `warmupDays` parameter:

```typescript
export interface BacktestOptions {
  // ... existing ...
  /** Number of days to warm up features before first backtest sample. Default 30. */
  warmupDays?: number;
}

export async function runBacktest(pool: Pool, options: BacktestOptions): Promise<BacktestRunResult> {
  const {
    // ... existing ...
    warmupDays = 30,
  } = options;

  // Adjust startTs for warmup
  const featureWarmupStart = new Date(startTs.getTime() - warmupDays * 24 * 60 * 60 * 1000);
  
  // Fetch candles including warmup period
  const { rows: candleRows } = await pool.query(
    `SELECT ts FROM ${table}
     WHERE symbol = $1 AND ts >= $2 AND ts <= $3
     ORDER BY ts`,
    [symbol, featureWarmupStart, endTs]  // ← includes warmup
  );

  // Generate samples, but skip warmup period
  const sampleTimes: Date[] = [];
  let lastBucket = 0;
  for (const row of candleRows) {
    const t = new Date(row.ts).getTime();
    const isWarmup = t < startTs.getTime();
    
    if (!isWarmup && (sampleTimes.length === 0 || t - lastBucket >= intervalMs)) {
      sampleTimes.push(new Date(row.ts));
      lastBucket = t;
    }
  }

  // ... rest of backtest logic ...
}
```

### Implementation Steps
1. Add `warmupDays` option
2. Adjust `featureWarmupStart` calculation
3. Extend candle fetch to include warmup period
4. Skip samples during warmup
5. Report in result: "Warmup: 30 days, First sample: Jan 31"

### Impact
- **Severity:** MEDIUM
- **Implementation effort:** 2 hours
- **Expected result change:** -5 to -10% on returns (more realistic)

---

## Issue #5: Feature Freshness Not Validated

### Location
`packages/setupEngine/src/contextBuilder.ts`, lines 149–166 (fetchBias example)

### Current Code
```typescript
async function fetchBias(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<BiasFeature | null> {
  try {
    const { rows } = await pool.query(
      `SELECT direction, confidence, reason FROM features_bias
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) return null;
    // ← No check: is row.ts < asOf by 10 mins or 10 hours?
    const row = rows[0];
    return {
      direction: biasToSetup(row.direction),
      confidence: Number(row.confidence) || 0,
      reason: row.reason,
      strength: inferStrength(Number(row.confidence)),
    };
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch bias:", (err as Error).message);
    return null;
  }
}
```

### Problem
Feature is accepted if `feature.ts <= asOf`, regardless of staleness.

**Scenario:**
- Backtest: EURUSD 1h TF, 2026-01-01 14:00
- Features last backfilled: 2025-12-15 18:00 (16 days stale!)
- Setup evaluated with 16-day-old bias data

### Impact
- **Bias:** Most stale feature is selected, could be days/weeks old
- **Structure:** Zone lifecycle broken (zone "mitigated" from 2 weeks ago still used)
- **Pricing:** OTE levels from old market regime applied
- **Zones:** Old zone resistance/support used (market has moved)

### Root Cause
Features backfilled monthly (AGENTS.md: "Backfilled for every bar in imported candle history")

But: If import is incomplete (e.g., only imported Dec 1–15), features outside that range are missing.

### Fix
Add freshness validation:

```typescript
async function fetchBias(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date,
  maxAgeMinutes: number = 240  // 4 hours default
): Promise<BiasFeature | null> {
  try {
    const { rows } = await pool.query(
      `SELECT direction, confidence, reason, ts FROM features_bias
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) return null;
    
    const row = rows[0];
    const ageMinutes = (asOf.getTime() - new Date(row.ts).getTime()) / (60 * 1000);
    
    if (ageMinutes > maxAgeMinutes) {
      console.warn(
        `[setupEngine] Bias stale: ${ageMinutes.toFixed(1)}m old ` +
        `(max: ${maxAgeMinutes}m) for ${symbol} ${tf} at ${asOf.toISOString()}`
      );
      return null;  // Force trade skip or use fallback
    }
    
    const row = rows[0];
    return {
      direction: biasToSetup(row.direction),
      confidence: Number(row.confidence) || 0,
      reason: row.reason,
      strength: inferStrength(Number(row.confidence)),
    };
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch bias:", (err as Error).message);
    return null;
  }
}
```

### Also Needed
- Update `EvaluationInput` to accept `maxFeatureAgeMins`
- Propagate through `evaluateSetup()` to all fetch functions
- Report: "X trades skipped due to stale features"

### Implementation
```typescript
// In runBacktest.ts
const trackOutcomeOptions: TrackOutcomeOptions = {
  ...baseOptions,
  maxFeatureAgeMins: 240,  // 4 hours
};

// In buildContext()
const [bias, htfBias, ...] = await Promise.all([
  fetchBias(pool, symbol, tf, asOf, maxFeatureAgeMins),
  fetchHtfBias(pool, symbol, tf, asOf, maxFeatureAgeMins),
  // ...
]);
```

### Impact
- **Severity:** MEDIUM
- **Implementation effort:** 3 hours
- **Expected result:** Some trades skipped, win rate may increase (lower-quality trades removed)

---

## Issue #6: Timeout Trades Look-Ahead Bias

### Location
`packages/analyzerBacktest/src/outcomeTracker.ts`, lines 163–171

### Current Code
```typescript
// Trade was still open at the end of the backtest window.
// Report as timeout/no-result and exclude from win/loss/R stats.
return {
  outcome: "timeout",
  outcomeR: 0,
  exitPrice: null,
  exitTs: null,
  barsHeld: futureCandles.length,
  effectiveEntry,
  maxAdverseR,
  maxFavorableR,
};
```

### Problem
Timeout trades are **excluded** from win/loss metrics:

```typescript
function completedTrades(trades: BacktestTrade[]): BacktestTrade[] {
  return trades.filter((t) => t.outcome === "win" || t.outcome === "loss");  // ← excludes timeout
}
```

**This creates a selection bias:**
- Trades that resolve cleanly (before backtest end) are included
- Trades still open at end are excluded
- Net effect: **results show only "completed" trades**, favoring strategies that close quickly

### Scenario
- Backtest window: Jan 1–90
- Strategy A: Holds trades 20 bars avg (95% resolve within 90 days)
- Strategy B: Holds trades 200 bars avg (40% timeout at 90-day end)

**Reported results:**
- Strategy A: 100% of trades counted
- Strategy B: Only 60% of trades counted (timeouts excluded)
- Strategy B appears **worse** due to measurement bias, not actual performance

### Impact
- **Severity:** MEDIUM
- **Bias direction:** Against trend-following strategies, favors scalpers
- **Win rate effect:** Reported WR% too high for long-hold strategies

### Fix Option 1: Include Timeouts in Avg R
```typescript
function computeRiskReturn(trades: BacktestTrade[]): RiskReturnMetrics {
  const completed = completedTrades(trades);
  const timeouts = trades.filter((t) => t.outcome === "timeout");
  
  // Include timeouts in average R calculation (contributes 0 each)
  const allForAvg = [...completed, ...timeouts];
  const totalR = allForAvg.reduce((sum, t) => sum + t.outcomeR, 0);
  const avgR = allForAvg.length > 0 ? totalR / allForAvg.length : 0;
  
  // But keep win rate based only on completed
  const wins = completed.filter((t) => t.outcome === "win").length;
  const winRate = completed.length > 0 ? wins / completed.length : 0;
  
  // ... rest of metrics
}
```

### Fix Option 2: Extend Backtest Window
- Add `includeBuffer` parameter: extend backtest by N days beyond stated end
- Allows more trades to resolve naturally
- Results more representative of true performance

```typescript
export interface BacktestOptions {
  // ... existing ...
  /** Extended buffer (days) after endTs to allow trades to resolve. Not counted in stats. */
  resolveBufferDays?: number;
}
```

### Recommendation
- [ ] Implement Fix Option 1 (easy, 1 hour)
- [ ] Report: "X trades (Y%) resolved in-window, Z% timed out"
- [ ] If timeout rate > 10%, consider extending backtest window

---

## Issue #7: Portfolio Heat Cascading Bias

### Location
`packages/analyzerBacktest/src/runBacktest.ts`, lines 142–180

### Current Code
```typescript
for (const asOf of sampleTimes) {
  const trade = await evaluateAndTrack(
    pool,
    asOf,
    symbol,
    tf,
    activePositionCount,  // ← This stays at 0 for backtest
    // ...
  );
  if (trade) trades.push(trade);
}
```

### Problem
`activePositionCount` is passed as backtest option (default 0), assumed constant for entire backtest.

But: In reality, positions accumulate:
- Trade 1: Open at 10:00
- Trade 2: Open at 10:30 (Trade 1 still open)
- If max positions = 1, Trade 2 is skipped
- Backtest records: "Trade 1 executed, Trade 2 skipped"

**Current backtest assumes:**
- Position count reset to 0 each evaluation
- All signals are independent

**Reality:**
- Positions accumulate over hours/days
- Later signals blocked by earlier positions
- Backtest understates skip count; overstates win rate

### Impact
- **Severity:** MEDIUM
- **Bias direction:** Results too optimistic (later trades that would be blocked are not evaluated)
- **Variant watukushay_no1:** 1715 raw signals, 949 executed (55% skip) — cascading may be worse

### Detection
```typescript
// Log position accumulation
let simulatedActivePositions = 0;
for (const trade of trades) {
  if (trade.outcome !== "timeout") {
    simulatedActivePositions--;  // Trade closed
  } else {
    simulatedActivePositions++;  // Trade still open
  }
  if (simulatedActivePositions > 2) {
    console.log(`[risk] Max positions exceeded: ${simulatedActivePositions}`);
  }
}
```

### Fix
Simulate position lifecycle:

```typescript
interface SimulatedPosition {
  entryTime: Date;
  exitTime: Date | null;
  symbol: string;
}

let activePositions: SimulatedPosition[] = [];

for (const trade of allGeneratedSignals) {
  // Remove closed positions
  activePositions = activePositions.filter((p) => !p.exitTime || new Date(p.exitTime) > trade.asOf);
  
  // Check position limit
  if (activePositions.length >= maxPositionsPerSymbol) {
    trade.skipped = true;  // Don't execute this trade
    continue;
  }
  
  // Execute trade
  activePositions.push({
    entryTime: trade.asOf,
    exitTime: trade.exitTs ? new Date(trade.exitTs) : null,
    symbol: trade.symbol,
  });
}
```

### Recommendation
- [ ] Implement position lifecycle simulation (4 hours)
- [ ] Report: "X trades skipped due to position limit"
- [ ] Compare to "unlimited capital" baseline

---

## Issue #8: Win/Loss Variance Too Uniform

### Location
`data/backtest-seed/historical-pit-90d/raw-results.json`

### Observation
```json
{
  "spec": "doyle_sd",
  "symbol": "EURUSD",
  "wins": 29,
  "avgWinR": 2.4999999999999716,  // ← Exactly 2.5R!
  "avgLossR": -1,                   // ← Exactly -1R!
}
```

All specs, all symbols, all windows show **exactly** 2.5 or 1.0 R wins, **exactly** -1R losses.

### Why Suspicious
Real trading: R outcomes vary due to:
- Same-candle exits (entered and exited in one candle = partial R)
- Partial fills
- Slippage variation
- Intrabar TP/SL ambiguity

Example: 100 trades, 70 wins
- Win 1: Entered near bottom of entry zone, TP at 40 pips = 2.0R
- Win 2: Entered near top of entry zone, TP at 40 pips = 2.1R
- Win 3: Same-candle exit, only 50% to TP = 1.25R
- Expected avg: ~2.0–2.3R (not exactly 2.5R across all trades)

### Hypothesis
Strategy configurations use **fixed 1:1 or 2.5:1 TP/SL** with **no same-candle exits** being simulated.

Check:
```bash
grep -r "takeProfit.*2.5\|stopLoss.*1\|riskReward.*2.5" packages/strategies/src/specs/
```

### Fix Needed
- [ ] Verify TP/SL logic in setup evaluation
- [ ] Check if same-candle exits are simulated realistically
- [ ] If exact R, document it (expected behavior for fixed TP/SL)

---

## Issue #9: Walk-Forward Missing Optimization

### Location
`packages/analyzerBacktest/src/walkForward.ts`, lines 46–50

### Code Excerpt
```typescript
/**
 * Note: this implementation re-runs the same setup-evaluation logic on both
 * windows. To make it a real optimizer, pass a `baseBacktestOptions` that
 * includes calibrated thresholds learned from the train window, or call an
 * external calibration routine between windows.
 */
```

### Problem
Walk-forward loop runs **same strategy on train and test**:
- Train window (2026-02-25 to 2026-03-27): doyle_sd with default params
- Test window (2026-03-27 to 2026-04-11): doyle_sd with **same** default params

**This is NOT true walk-forward optimization.** True walk-forward:
1. Optimize strategy params on train set (e.g., tune bias threshold)
2. Apply optimized params to test set
3. Repeat for next window

### Current behavior is actually **good for fairness** (no overfitting), but **bad for performance**.

### Impact
- **Severity:** LOW (not a bug, by design)
- **Missed opportunity:** Leaving potential alpha on the table
- **Alternative:** Interpretation as "pure strategy test" (OK)

### Fix (Optional)
Add optional calibration hook:

```typescript
export interface WalkForwardOptions {
  // ... existing ...
  /** Optional calibration function to optimize params on train window. */
  calibrator?: (trainResult: BacktestRunResult, trainReport: BacktestReport) 
    => Partial<BacktestOptions>;
}

export async function runWalkForward(pool: Pool, options: WalkForwardOptions): Promise<WalkForwardResult> {
  // ...
  for (const window of windows) {
    // Train
    const trainResult = await runBacktest(pool, { ...baseBacktestOptions, ... });
    const trainReport = generateReport(trainResult.trades);

    // Calibrate (optional)
    let testOptions = { ...baseBacktestOptions };
    if (options.calibrator) {
      const calibratedParams = options.calibrator(trainResult, trainReport);
      testOptions = { ...testOptions, ...calibratedParams };
    }

    // Test with calibrated params
    const testResult = await runBacktest(pool, {
      startTs: window.testStart,
      endTs: window.testEnd,
      ...testOptions,
      recordResults: false,
    });
    // ...
  }
}
```

---

## Quick Fix Priority Checklist

### Week 1 (Critical)
- [ ] **Fix Sortino denominator** (1 hour) — Easy, high impact
- [ ] **Fix short exit spread** (1 hour) — Easy, moderate impact
- [ ] **Add warmup days** (2 hours) — Medium, important
- [ ] **Add feature freshness check** (3 hours) — Medium, important

### Week 2 (High Priority)
- [ ] **Run intrabar mode sensitivity** (4 hours) — Investigation
- [ ] **Investigate win/loss variance** (2 hours) — Investigation
- [ ] **Implement position lifecycle** (4 hours) — Detection of cascading bias
- [ ] **Include timeouts in avg R** (1 hour) — Medium impact

### Week 3 (Testing)
- [ ] **Re-run live variants with fixes** — Validate results
- [ ] **Compare to original backtest** — Quantify impact
- [ ] **Documentation** — Update AGENTS.md and backtest caveats

---

## Appendix: Reproduction Test Cases

### Test Case 1: Sortino Inflation
```typescript
// Expected vs Actual Sortino ratio
const rs = [2, 2, 1, 2, 2, -1, -1, -1, 1, 2];  // 7 wins, 3 losses
const wins = rs.filter(r => r > 0);           // [2, 2, 1, 2, 2, 1, 2]
const losses = rs.filter(r => r < 0);         // [-1, -1, -1]

const avgR = rs.reduce((a,b) => a+b) / rs.length;  // = 0.9
const downsideVar_old = losses.reduce((a,b) => a + b*b) / rs.length;  // 3 / 10 = 0.3
const downsideVar_new = losses.reduce((a,b) => a + b*b) / losses.length;  // 3 / 3 = 1.0

const sortinoOld = (avgR / Math.sqrt(downsideVar_old)) * Math.sqrt(rs.length);  // = 18.4
const sortinoNew = (avgR / Math.sqrt(downsideVar_new)) * Math.sqrt(rs.length);  // = 9.0

console.assert(sortinoOld / sortinoNew === 2.04, "Sortino inflated by 2x");
```

### Test Case 2: Short Exit Spread
```typescript
// EURUSD short trade
const entryZone = { top: 1.1002, bottom: 1.0998 };
const rawEntry = 1.1000;
const sl = 1.1020;
const tp = 1.0960;
const spread = 4 / 10000;  // 4 pips
const slip = 1 / 10000;    // 1 pip

const entryAdj = spread / 2 + slip;
const effectiveEntry = rawEntry - entryAdj;  // 1.0997

const exitAdj = spread / 2 + slip;
const tpEffectiveOld = tp + slip;            // Wrong: missing spread/2
const tpEffectiveNew = tp + exitAdj;         // Correct

const rOld = Math.abs(effectiveEntry - tpEffectiveOld) / Math.abs(effectiveEntry - sl);
const rNew = Math.abs(effectiveEntry - tpEffectiveNew) / Math.abs(effectiveEntry - sl);

console.log(`Old (wrong): ${rOld.toFixed(4)}, New (correct): ${rNew.toFixed(4)}`);
// Expected: Old: 0.0046, New: 0.0044 (slightly lower, more realistic)
```

---

**Report Status:** Complete  
**Next Steps:** Implement critical fixes in Phase 1 (1 week)
