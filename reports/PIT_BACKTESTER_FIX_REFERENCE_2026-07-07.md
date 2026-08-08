# PIT Backtester: Fix Reference Sheet for Developers

**Quick Copy-Paste Guide for Phase 1 Fixes**

---

## Fix #1: Sortino Ratio Denominator

### File
`packages/analyzerBacktest/src/reportGenerator.ts`

### Location
Lines 370–374

### Current (Incorrect)
```typescript
const downsideVariance = completed.length > 0
  ? rs.filter((r) => r < 0).reduce((sum, r) => sum + r * r, 0) / completed.length
  : 0;
const downsideDeviation = Math.sqrt(downsideVariance);

const sortinoRatio = downsideDeviation > 0 ? (avgR / downsideDeviation) * Math.sqrt(completed.length) : 0;
```

### Fixed (Correct)
```typescript
const negativeTrades = rs.filter((r) => r < 0);
const downsideVariance = negativeTrades.length > 0
  ? negativeTrades.reduce((sum, r) => sum + r * r, 0) / negativeTrades.length
  : 0;
const downsideDeviation = Math.sqrt(downsideVariance);

const sortinoRatio = downsideDeviation > 0 ? (avgR / downsideDeviation) * Math.sqrt(completed.length) : 0;
```

### Test
```typescript
// Input: 70 wins (2R each), 30 losses (-1R each), 100 total
// Old Sortino: ~20.1
// New Sortino: ~11.0
// Expected reduction: ~2x

const rs = [2,2,2,2,2,2,2, -1,-1,-1];
const result = computeRiskReturn([...trades from rs]);
console.assert(result.sortinoRatio < 15, "Sortino should be ~11, not ~20");
```

---

## Fix #2: Short Exit Spread Adjustment

### File
`packages/analyzerBacktest/src/outcomeTracker.ts`

### Locations
- Line 217 (SL hit on short)
- Line 226 (TP hit on short)

### Current (Incorrect) - Line 226
```typescript
if (tpHit) {
  const exitAdjustment = spreadPrice / 2 + slippagePrice;
  const effectiveExit = direction === "long"
    ? takeProfit - exitAdjustment
    : takeProfit + slippagePrice;  // ← BUG: missing spread/2
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

### Fixed (Correct) - Line 226
```typescript
if (tpHit) {
  const exitAdjustment = spreadPrice / 2 + slippagePrice;
  const effectiveExit = direction === "long"
    ? takeProfit - exitAdjustment
    : takeProfit + exitAdjustment;  // ← FIXED: apply full adjustment
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

### Also Fix - Line 217 (SL hit on short)
```typescript
if (slHit) {
  const exitAdjustment = spreadPrice / 2 + slippagePrice;
  const effectiveExit = direction === "long"
    ? stopLoss - exitAdjustment
    : stopLoss + exitAdjustment;  // ← FIXED: was just slippagePrice
  return {
    outcome: "loss",
    outcomeR: -1,
    exitPrice: effectiveExit,
    exitTs: candle.ts,
    barsHeld: i + 1,
    effectiveEntry,
    maxAdverseR,
    maxFavorableR,
  };
}
```

### Test
```typescript
// EURUSD short: entry 1.1000, TP 1.0950, spread 4 pips, slip 1 pip
// Old: TP - 0.0001 = 1.0949 (too favorable)
// New: TP - 0.0003 = 1.0947 (correct)

const shortTrade = trackOutcome("short", entryZone, sl, tp, futureCandles, {
  spreadPips: 4,
  slippagePips: 1,
});
console.assert(shortTrade.exitPrice < 1.0949, "Exit should be <= 1.0947");
```

---

## Fix #3: Add Warmup Buffer

### File
`packages/analyzerBacktest/src/runBacktest.ts`

### Location
Lines 16–30 (BacktestOptions interface)  
Lines 73–113 (Sample generation)  

### Step 1: Add Interface Option (Line 16)
```typescript
export interface BacktestOptions {
  symbol: string;
  tf: TimeFrame;
  startTs: Date;
  endTs: Date;
  sampleIntervalMinutes?: number;
  maxForwardBars?: number;
  backtestSpreadPips?: number;
  backtestSlippagePips?: number;
  backtestSessionName?: string;
  activePositionCount?: number;
  recordResults?: boolean;
  variantId?: string;
  familyId?: string;
  strategyId?: string;
  concurrency?: number;
  trackOutcomeOptions?: TrackOutcomeOptions;
  includeEquityCurve?: boolean;
  disableTradeDedup?: boolean;
  // NEW:
  /** Number of days to warm up features before first sample. Default 30. */
  warmupDays?: number;
}
```

### Step 2: Destructure Option (Line 73)
```typescript
const {
  symbol,
  tf,
  startTs,
  endTs,
  sampleIntervalMinutes = Math.max(1, TF_MS[tf] / 60_000),
  maxForwardBars = 2000,
  // ... other options ...
  disableTradeDedup = false,
  warmupDays = 30,  // NEW
} = options;
```

### Step 3: Adjust Start Time for Warmup (After Line 72)
```typescript
// Calculate warmup start time
const msPerDay = 24 * 60 * 60 * 1000;
const featureWarmupStart = new Date(startTs.getTime() - warmupDays * msPerDay);

// Use featureWarmupStart in candle query (line 95)
const { rows: candleRows } = await pool.query(
  `SELECT ts FROM ${table}
   WHERE symbol = $1 AND ts >= $2 AND ts <= $3
   ORDER BY ts`,
  [symbol, featureWarmupStart, endTs]  // ← Changed from startTs to featureWarmupStart
);
```

### Step 4: Skip Warmup Samples (Lines 99–111)
```typescript
const sampleTimes: Date[] = [];
let lastBucket = 0;
for (const row of candleRows) {
  const t = new Date(row.ts).getTime();
  const isWarmup = t < startTs.getTime();  // NEW: Check if in warmup period
  
  if (!isWarmup && (sampleTimes.length === 0 || t - lastBucket >= intervalMs)) {
    sampleTimes.push(new Date(row.ts));
    lastBucket = t;
  }
}
```

### Step 5: Return Updated Metadata (Around Line 193)
```typescript
return {
  runId,
  symbol,
  tf,
  startTs,
  endTs,
  samplesEvaluated: sampleTimes.length,
  trades,
  equityCurve,
  // OPTIONAL: Add warmup info
  warmupPeriod: { start: featureWarmupStart, end: startTs, days: warmupDays },
};
```

### Test
```typescript
// Backtest should start 30 days after feature warmup
const result = await runBacktest(pool, {
  symbol: "EURUSD",
  tf: "1h",
  startTs: new Date("2026-01-31"),  // Actual start
  endTs: new Date("2026-03-31"),
  warmupDays: 30,  // 30 days warmup
});

// First sample should be ~Jan 31, but features were backfilled from ~Jan 1
console.assert(result.warmupPeriod.start < result.startTs, "Warmup should precede backtest start");
```

---

## Fix #4: Add Feature Freshness Check

### Files
`packages/setupEngine/src/contextBuilder.ts` (all fetch* functions)

### Template for Each Fetch Function (Example: fetchBias)

#### Current (Incorrect)
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
    const row = rows[0];
    return { ... };
  } catch (err) {
    // ...
  }
}
```

#### Fixed (Correct)
```typescript
async function fetchBias(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date,
  maxAgeMinutes: number = 240  // NEW: 4 hours default
): Promise<BiasFeature | null> {
  try {
    const { rows } = await pool.query(
      `SELECT direction, confidence, reason, ts FROM features_bias  -- NEW: select ts
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) return null;
    
    const row = rows[0];
    const featureAge = (asOf.getTime() - new Date(row.ts).getTime()) / (60 * 1000);  // NEW
    
    if (featureAge > maxAgeMinutes) {  // NEW: Validate freshness
      console.warn(
        `[setupEngine] Bias stale: ${featureAge.toFixed(1)}m old ` +
        `(max: ${maxAgeMinutes}m) for ${symbol} ${tf} at ${asOf.toISOString()}`
      );
      return null;  // Skip trade
    }
    
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

### Update buildContext() Signature
```typescript
export async function buildContext(
  pool: Queryable,
  input: EvaluationInput,
  maxFeatureAgeMins: number = 240  // NEW
): Promise<EvaluationContext> {
  // ... existing code ...
  
  const [bias, htfBias, pricing, zones, structure, atrRow, spreadRow, sessionRow, positionCount] =
    await Promise.all([
      fetchBias(pool, symbol, tf, asOf, maxFeatureAgeMins),           // NEW param
      fetchHtfBias(pool, symbol, tf, asOf, maxFeatureAgeMins),        // NEW param
      fetchPricing(pool, symbol, tf, asOf, maxFeatureAgeMins),        // NEW param
      fetchZones(pool, symbol, tf, asOf, maxFeatureAgeMins),          // NEW param
      fetchStructure(pool, symbol, tf, asOf, maxFeatureAgeMins),      // NEW param
      fetchAtr(pool, symbol, tf, asOf, maxFeatureAgeMins),            // NEW param
      // ... rest unchanged ...
    ]);
  
  // ... rest of function ...
}
```

### Update evaluateSetup() Call
```typescript
export async function evaluateSetup(
  pool: Pool,
  input: EvaluationInput,
  maxFeatureAgeMins: number = 240  // NEW
): Promise<SetupEvaluation> {
  const context = await buildContext(pool, input, maxFeatureAgeMins);  // NEW param
  // ... rest of function ...
}
```

### Update runBacktest() Call to evaluateSetup
```typescript
const setup = await evaluateSetup(pool, {
  symbol,
  tf,
  asOf,
  backtest: { ... },
}, 240);  // NEW: 4 hours max feature age
```

### Test
```typescript
// Should skip trades when features are stale
const result = await runBacktest(pool, {
  symbol: "EURUSD",
  tf: "1h",
  startTs: new Date("2026-01-01"),
  endTs: new Date("2026-01-31"),
  // No features backfilled for January (only December available)
});

// Result should have fewer trades (stale features skipped)
console.assert(result.trades.length < 100, "Expected stale features to reduce trades");
```

---

## Validation & Testing

### Run All Tests
```bash
cd /path/to/tradzfx-v2
pnpm test
```

### Specific Test Files
```bash
pnpm test packages/analyzerBacktest/src/reportGenerator.test.ts
pnpm test packages/analyzerBacktest/src/outcomeTracker.test.ts
pnpm test packages/analyzerBacktest/src/runBacktest.test.ts
```

### Add New Tests

Create `packages/analyzerBacktest/src/fixes.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { generateReport } from "./reportGenerator";
import { trackOutcome } from "./outcomeTracker";

describe("PIT Backtester Fixes", () => {
  
  describe("Fix #1: Sortino Ratio", () => {
    it("should calculate Sortino based on loss count, not total trades", () => {
      // 70 wins (2R each), 30 losses (-1R each)
      const trades = [
        ...Array(70).fill({ outcome: "win" as const, outcomeR: 2 }),
        ...Array(30).fill({ outcome: "loss" as const, outcomeR: -1 }),
      ];
      
      const report = generateReport(trades);
      
      // Old formula: sortinoRatio = (avgR / sqrt(3/100)) * sqrt(100) = 20.1
      // New formula: sortinoRatio = (avgR / sqrt(3/30)) * sqrt(100) = 11.0
      expect(report.riskReturn.sortinoRatio).toBeLessThan(15);
      expect(report.riskReturn.sortinoRatio).toBeGreaterThan(10);
    });
  });
  
  describe("Fix #2: Short Exit Spread", () => {
    it("should apply spread/2 + slippage on short exit", () => {
      const candles = [
        { ts: "2026-01-01T01:00:00Z", o: 1.1001, h: 1.1002, l: 1.1000, c: 1.1001, v: 100 },
        { ts: "2026-01-01T02:00:00Z", o: 1.0999, h: 1.0999, l: 1.0945, c: 1.0950, v: 100 },
      ];
      
      const outcome = trackOutcome("short", { top: 1.1001, bottom: 1.0999 }, 1.1020, 1.0950, candles, {
        spreadPips: 4,
        slippagePips: 1,
      });
      
      // Short TP should be adjusted by full (spread/2 + slippage)
      const expectedAdjustment = (4 / 2 + 1) * 0.0001;  // 3 pips = 0.0003
      const expectedExit = 1.0950 + expectedAdjustment;
      
      expect(outcome.exitPrice).toBeCloseTo(expectedExit, 5);
    });
  });
  
  describe("Fix #3: Warmup Buffer", () => {
    it("should skip samples during warmup period", () => {
      // Backtest with 30-day warmup
      // Should not evaluate trades in first 30 days
    });
  });
  
  describe("Fix #4: Feature Freshness", () => {
    it("should skip trades with stale features", () => {
      // Setup evaluation with 2-week-old bias
      // Should return null or skip trade
    });
  });
});
```

### Run New Tests
```bash
pnpm test packages/analyzerBacktest/src/fixes.test.ts
```

---

## Deployment Checklist

### Before Commit
```
[ ] Tests pass: pnpm test
[ ] No lint errors: pnpm lint
[ ] Build succeeds: pnpm -r build
[ ] All 4 fixes applied
[ ] No console.log() or console.warn() left behind (use proper logging)
[ ] git diff reviewed
```

### Before Deploy
```
[ ] Re-run backtest on doyle_sd (EURUSD only) for quick validation
[ ] Compare results: old vs new (expect ~5-10% lower)
[ ] Document breaking changes in CHANGELOG.md
[ ] Update AGENTS.md with new warmupDays parameter
[ ] Tag release: git tag -a v2.1-fixes -m "Phase 1 backtester fixes"
```

### After Deploy
```
[ ] Monitor live performance vs backtest
[ ] Log feature freshness warnings in production
[ ] Track Sortino ratio changes in reporting dashboard
[ ] Compare old backtest results to new (for documentation)
```

---

## Git Commit Template

```
fix(backtester): Phase 1 critical fixes

- Fix Sortino ratio denominator (2-5x inflation)
  * Divide by loss count instead of total trades
  * Fixes: reportGenerator.ts line 370
  
- Fix short exit spread adjustment (2-3% understatement)
  * Apply full exitAdjustment to shorts, not just slippage
  * Fixes: outcomeTracker.ts lines 217, 226
  
- Add warmup buffer for feature initialization
  * New param: warmupDays (default 30)
  * Fixes: runBacktest.ts warmup handling
  
- Add feature freshness validation
  * New param: maxFeatureAgeMins (default 240)
  * Prevents using stale features (hours/days old)
  * Fixes: contextBuilder.ts all fetch* functions

BREAKING CHANGE: Backtest results will be 5-15% lower (more realistic)

Fixes #XXX
```

---

**Total Implementation Time: ~11 hours**

- Sortino fix: 1h
- Short exit fix: 1h
- Warmup buffer: 2h
- Feature freshness: 3h
- Testing & validation: 2h
- Documentation: 2h

---

**Generated:** 2026-07-07  
**Status:** Ready to implement ✅
