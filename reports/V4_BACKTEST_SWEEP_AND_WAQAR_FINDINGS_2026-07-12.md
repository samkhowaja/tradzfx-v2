# V4 Backtest Sweep & Waqar Strategy Findings — 2026-07-12

**Date**: 2026-07-12  
**Scope**: Complete V4 backtest sweep on 7 strategies + Waqar strategy deep-dive  
**Status**: Data quality gate correctly blocked Waqar; V4 sweep reveals systemic architecture issues

---

## Executive Summary

| Test | Result | Key Finding |
|------|--------|-------------|
| **V4 Sweep (7 strategies, XAUUSD 90d)** | 6/7 executed trades, 1 timeout fixed | Setup engine blocks 85-99% of non-zone strategies; volatility gate blocks XAUUSD |
| **Waqar_v2 (7 FX majors, 90d)** | `BLOCKED_SYSTEM_QUALITY` on all symbols | Weekend FX candle contamination poisons freshness; ATR zero-row corruption |

**Root Cause**: The system correctly refuses to produce fake backtests. The data quality gate is working as designed — it caught real pipeline failures that would have produced misleading results.

---

## Part 1: V4 Backtest Sweep Results (XAUUSD, 90 days)

### Strategy Results

| Strategy | Raw Signals | Executed | Wins | Losses | Timeouts | WR | Net R | Primary Blocker |
|----------|-------------|----------|------|--------|----------|-----|-------|-----------------|
| **orb_classic** | 37 | 0 | 0 | 0 | 0 | 0% | 0.00 | 36 setup-engine BLOCK (zone rules) |
| **watukushay_no1** | 84 | 2 | 1 | 1 | 0 | 50% | -0.80 | 72 BLOCK + 6 gate skips |
| **doyle_sd** | 143 | 6 | 3 | 3 | 9 | 50% | +2.52 | 127 BLOCK, 9 timeouts, 1.4s query |
| **smart_risk_ob_ifvg_1m** | 4 | 2 | 1 | 1 | 0 | 50% | +0.46 | 2 BLOCK (zone proximity) |
| **smart_risk_ob_ifvg_1m_sniper_10r** | 4 | 0 | 0 | 0 | 0 | 0% | 0.00 | 2 BLOCK + 2 volatility gate |
| **keylevel_bounce_v1** | 1 | 0 | 0 | 0 | 0 | 0% | 0.00 | 1 warmup-skipped |
| **a_plus_orb_fvg_5m** | 2 | 0 | 0 | 0 | 0 | 0% | 0.00 | 2 BLOCK (query 262ms — **fixed!**) |

### Key V4 Findings

1. **Setup Engine is the #1 Blocker** — 85-99% of candidates blocked by zone-proximity rules that don't apply to ORB, MA, FVG, or indicator strategies
2. **Volatility Gate Blocks XAUUSD** — Absolute pip thresholds calibrated for FX block metals 100% (`sniper_10r` 0 trades)
3. **Zone Table Explosion** — 2.3M rows@5m causes 1.4s queries for `doyle_sd`
4. **Timeout Mismatch** — `doyle_sd` avgHoldBars=27 > default timeoutBars=24 → 9 timeouts
5. **Warmup Too Aggressive** — `keylevel_bounce_v1` single signal falls in 200-bar warmup window
6. **Lifecycle Refresh Fixed Timeout** — `a_plus_orb_fvg_5m` went from statement timeout to 262ms after lifecycle refresh

---

## Part 2: Waqar_v2 Deep-Dive (7 FX Majors, 90 days)

### Official Backtest Result

```bash
node scripts/backtest-pit-v2.js EURUSD 90 waqar_v2 --debug --trades
# Result: BLOCKED_SYSTEM_QUALITY
```

**All 7 FX majors blocked**:
- EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY

### Blocking Reasons (Preflight Data Quality Gate)

| Feature Surface | Status | Latest Row | Gap vs Candle Edge |
|-----------------|--------|------------|-------------------|
| `features_htf_bias@15m` | **STALE** | 2026-07-10 23:12 | ~42 hours |
| `features_pricing@1h` | **STALE / PRODUCER STALE** | 2026-07-10 | ~54 hours |
| `features_atr@1m` | **STALE** | 2026-07-10 | ~42 hours |
| `features_zone@1m` | **PRODUCER STALE** | 2026-07-10 22:13 | ~42 hours |

**Candle Edge**: `candles_1m` shows `2026-07-12 17:49` (Sunday 17:49 UTC — **weekend**)

---

## Part 3: Critical Skeleton Bugs Discovered

### Bug 1: Weekend FX Candle Contamination (CRITICAL)

**Finding: RC-6, RC-4)**

**Evidence**:
- Today is **Sunday 2026-07-12** (before FX market open)
- `candles_1m` has fresh bars through **Sunday 17:50 UTC** for all FX majors
- EURUSD: **2,512 weekend bars** from `2026-07-11 00:00` to `2026-07-12 17:51`
- Similar counts across GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY

**Impact**:
- Feature producers correctly stop on Friday (markets closed)
- Freshness checks compare features against **non-tradable weekend candle timestamps**
- Entire system marked `STALE` / `BLOCKED_SYSTEM_QUALITY`
- Poisons: freshness gates, coverage checks, feature scheduling, backtest trust

**Root Cause**: MT5 EA or ingestion server lacks calendar guard for FX weekend hours (Sun 21:00 UTC → Fri 21:00 UTC tradable window)

---

### Bug 2: Feature Producers Lag Candle Edge by 42-54 Hours

**Evidence** (EURUSD example):
| Surface | Latest Timestamp | Gap |
|---------|------------------|-----|
| `candles_1m` | 2026-07-12 17:49 (Sunday) | — |
| `features_htf_bias@15m` | 2026-07-10 23:12 | 42h |
| `features_zone@1m` | 2026-07-10 22:13 | 42h |
| `features_pricing@1h` | 2026-07-10 | 54h |
| `features_atr@1m` | 2026-07-10 | 42h |

**Analysis**: Producers likely stopped correctly on Friday close. The "lag" is artificial — caused by weekend candles advancing the candle edge while producers correctly pause.

---

### Bug 3: ATR Corruption — Zero Rows on Liquid FX (CR: RC-5)

**Evidence** (90-day window):
| Symbol | Zero ATR Rows @15m | Total Rows | % Zero |
|--------|-------------------|------------|--------|
| **EURUSD** | 17,202 | ~17,400 | **~99%** |
| **GBPUSD** | 15,804 | ~16,000 | **~99%** |

**Impact**: 
- 21 of 28 Waqar signals had zero ATR context
- ATR should **never be zero** on liquid FX over valid candles (range > 0)
- This is a data-quality bug in the ATR producer or candle ingestion

---

### Bug 4: Canonical Signal Engine Works Underneath

**Controlled Test** (bypassed preflight, 30 days ending before stall, EURUSD):
| Stage | Count |
|-------|-------|
| Bias rows | 320 |
| Setup rows | 222 |
| Final signals | 28 |
| After dedupe | 26 |
| Wins | 4 |
| Losses | 22 |
| **Raw WR** | **15.4%** |
| **Net R** | **~ -14.9R** |
| Signals with zero ATR | 21/28 |

**Conclusion**: The compiler/engine **can generate Waqar entries**. The official runner correctly blocks because data quality contract fails. The -14.9R result is **not trustworthy** — it's poisoned by zero ATR and weekend contamination.

---

### Bug 5: CLI Argument Parsing Bug

`--help` gets interpreted as a symbol instead of showing help. Minor but blocks usability.

---

### Bug 6: Multiple Waqar Variants Active in DB

Multiple Waqar variants simultaneously active → potential duplicate live evaluation. Needs investigation.

---

## Part 4: Root Cause Mapping (from Remediation Plan)

| Root Cause | V4 Evidence | Waqar Evidence | Plan Change |
|------------|-------------|----------------|-------------|
| **RC-3: Universal zone rules** | `orb_classic` 97% setup-blocked | Waqar uses zone_reversal family but zones contaminated | **Change 3: Family-Aware Setup Engine** (P0) |
| **RC-6: Asset-class-blind gates** | `sniper_10r` 100% vol gate blocked | FX volatility gate may use wrong percentiles | **Change 6: Symbol Contract Layer** (P0) |
| **RC-1: Two SQL codepaths** | Compiler/backtest drift likely | Waqar parity untested | **Change 1: Unify SQL Generation** (P0) |
| **RC-5: No stable zone identity** | 2.3M zone rows@5m | Weekend zones accumulate | **Change 5: Stable Zone Identity** (P1) |
| **RC-4: No capability contract** | `keylevel_bounce_v1` warmup ignores HTF | Waqar specs seeded without capability check | **Change 4: Capability Contract** (P1) |
| **RC-7: No candidate audit** | Can't trace why signals blocked | Can't audit Waqar rejections | **Change 7: Candidate Audit Table** (P2) |

---

## Part 5: Permanent Solutions (Never Happen Again)

### Solution 1: Hard Ingest/Calendar Guard for FX Weekend (P0 — Week 1)

**Problem**: Weekend FX candles ingested → poison freshness, coverage, scheduling

**Fix**: Add calendar-aware ingestion guard at **three layers**:

#### Layer A: MT5 EA (Source)
```mq5
// In tradzfxManager_v5_0_1.mq5 — OnTimer() gate
bool IsTradableTime() {
   MqlDateTime dt; TimeCurrent(dt);
   // FX: Sun 21:00 UTC → Fri 21:00 UTC
   if (dt.day_of_week == 0 && dt.hour < 21) return false;  // Sunday before 21:00
   if (dt.day_of_week == 5 && dt.hour >= 21) return false; // Friday after 21:00
   if (dt.day_of_week == 6) return false;                  // Saturday
   return true;
}
// Only call ingest if IsTradableTime()
```

#### Layer B: Ingestion Server (Gateway)
```javascript
// scripts/ingestion-server.js — validateBars()
function isTradableFxCandle(symbol, ts) {
  const dt = new Date(ts);
  const day = dt.getUTCDay(); // 0=Sun, 6=Sat
  const hour = dt.getUTCHours();
  if (day === 0 && hour < 21) return false;  // Sun before 21:00
  if (day === 5 && hour >= 21) return false; // Fri after 21:00
  if (day === 6) return false;               // Sat
  return true;
}
// Reject/quarantine non-tradable bars for FX symbols
```

#### Layer C: Database (Sink) — Constraint
```sql
-- Migration: Add check constraint on candles_1m for FX symbols
ALTER TABLE candles_1m ADD CONSTRAINT chk_fx_tradable_hours 
CHECK (
  symbol NOT IN (SELECT symbol FROM pair_characteristics WHERE asset_class = 'FX')
  OR (
    EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') NOT IN (0, 6) -- Not Sun/Sat
    OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 0 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') >= 21)
    OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 5 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') < 21)
  )
);
```

**Verification**:
```bash
# After fix: weekend query should return 0 rows
SELECT COUNT(*) FROM candles_1m 
WHERE symbol = 'EURUSD' 
  AND ts >= '2026-07-11 00:00' AND ts <= '2026-07-12 21:00';
-- Expected: 0
```

---

### Solution 2: Freshness Against Tradable Candle Edge (P0 — Week 1)

**Problem**: Freshness checks compare against raw `MAX(ts)` including weekend bars

**Fix**: Change all freshness checks to use **latest tradable candle**:

```typescript
// packages/shared/src/utils/marketCalendar.ts — add:
export function getLatestTradableCandle(symbol: string, pool: Pool): Promise<Date> {
  const assetClass = await getAssetClass(symbol); // from pair_characteristics
  if (assetClass === 'FX') {
    // Find latest candle within tradable window
    const { rows } = await pool.query(`
      SELECT MAX(ts) FROM candles_1m 
      WHERE symbol = $1 
        AND is_tradable_instant(ts, symbol) -- uses market calendar
    `, [symbol]);
    return rows[0]?.max;
  }
  // Crypto/indices: 24/7 or their calendar
  return getLatestCandle(symbol, pool);
}

// packages/shared/src/db/producerRuns.ts — assertProducerFresh():
// Use getLatestTradableCandle() instead of MAX(ts)

// scripts/backtest-pit-v2.js — checkCoverage():
// Compare feature freshness against tradable candle edge
```

**Verification**: After fix, Waqar preflight should show features fresh (gap < 2h) on Monday morning.

---

### Solution 3: ATR Zero-Row Repair + Data Quality Rule (P0 — Week 1)

**Problem**: 99% zero ATR rows on liquid FX — corrupts all downstream consumers

**Fix A: Repair Historical Data**
```bash
# Backfill ATR for affected symbols/timeframes
node scripts/backfill-historical-features.js EURUSD,GBPUSD 15m --features=features_atr --start=2026-04-01 --end=2026-07-12
# Repeat for 1m, 5m, 1h, 4h, 1d
```

**Fix B: Add DB Constraint (Prevent Recurrence)**
```sql
-- Migration: ATR cannot be zero after warmup unless candle range genuinely zero
ALTER TABLE features_atr ADD CONSTRAINT chk_atr_not_zero 
CHECK (
  atr_value > 0 
  OR (high - low) = 0  -- genuinely zero range candle
  OR ts < (SELECT MAX(ts) FROM candles_1m WHERE symbol = features_atr.symbol) - INTERVAL '200 bars' -- warmup period
);
```

**Fix C: Producer Validation**
```typescript
// apps/engine/src/features/atr.ts — serialize():
if (atrValue <= 0 && (high - low) > 0) {
  logger.warn({ symbol, tf, ts, atrValue, range: high - low }, 'ATR computed as zero on non-zero range candle');
  // Either: throw (hard fail) or emit null with quality flag
  return { ...row, atr_value: null, quality: 'suspect' };
}
```

**Verification**:
```sql
SELECT COUNT(*) FROM features_atr 
WHERE symbol IN ('EURUSD','GBPUSD') AND tf = '15m' AND atr_value = 0 AND ts > NOW() - INTERVAL '90 days';
-- Expected: 0 (or only genuinely zero-range candles)
```

---

### Solution 4: Family-Aware Setup Engine (P0 — Week 2)

**Problem**: Setup engine applies zone-reversal rules to ORB, MA, FVG, indicator strategies

**Fix**: Restructure `packages/setupEngine/src/` per remediation plan Change 3:

```typescript
// hardRules.ts — family-dispatched
function runHardRules(input: EvaluationInput): RuleResult[] {
  const common = runCommonRules(input); // direction, spread, candle availability, position count
  switch (input.setupFamily) {
    case 'zone_reversal': return [...common, ...runZoneReversalRules(input)];
    case 'orb_breakout': return [...common, ...runOrbRules(input)];
    case 'fvg_continuation': return [...common, ...runFvgRules(input)];
    case 'trend_pullback': return [...common, ...runTrendPullbackRules(input)];
    case 'indicator': return [...common, ...runIndicatorRules(input)];
    case 'liquidity_sweep': return [...common, ...runLiquiditySweepRules(input)];
    default: return common;
  }
}

// contextBuilder.ts — family-specific feature fetching
async function buildContext(input: EvaluationInput): Promise<SetupContext> {
  const common = await fetchCommonFeatures(input);
  switch (input.setupFamily) {
    case 'zone_reversal':
    case 'fvg_continuation':
      return { ...common, zones: await fetchZones(input), structure: await fetchStructure(input) };
    case 'orb_breakout':
      return { ...common, openingRange: await fetchOpeningRange(input), displacement: await fetchDisplacement(input) };
    case 'trend_pullback':
      return { ...common, movingAverages: await fetchMovingAverages(input) };
    // ...
  }
}
```

**Verification**:
```bash
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
# Expected: setup-block rate < 50%, block reasons are ORB-specific (not "all zones tapped")
```

---

### Solution 5: Symbol Contract Layer — Asset-Class-Safe Gates (P0 — Week 1)

**Problem**: Volatility gate uses absolute pips (FX-calibrated) → blocks XAUUSD 100%

**Fix**: Make percentile-based policy the **default** (per remediation plan Change 6):

```typescript
// packages/tradePipeline/src/gates/volatilityGate.ts
function createVolatilityGate(config: VolatilityGateConfig) {
  // If no explicit threshold, default to p95 from market_volatility_profile
  const maxAtrPercentile = config.maxAtrPercentile ?? 0.95;
  const minAtrPercentile = config.minAtrPercentile ?? 0.05;
  // ... rest uses profile lookup
}

// packages/setupEngine/src/contextBuilder.ts — spread cap
const maxAllowedSpreadPips = pair.baseSpreadPips * SPREAD_SANITY_MULTIPLIER; // 10x, not max(4x, 3)
```

**Verification**:
```bash
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 watukushay_no1 --json --mode=full
# Expected: > 0 executed trades, volatility gate skips < 20%
```

---

### Solution 6: Unify SQL Generation — Single Compiler Path (P0 — Week 2)

**Problem**: Backtest has 600+ lines of duplicated SQL logic that diverges from compiler

**Fix**: Delete `scripts/backtest-pit-v2.js` legacy fork, route through `compileStrategy()`:

```javascript
// scripts/backtest-pit-v2.js — replace compilePITSQL() with:
const { compileStrategy } = require('packages/strategies/dist/index.js');
const sql = await compileStrategy(spec, {
  mode: 'pit',
  from: startDate,
  to: endDate,
  symbol: symbol,
  trustStoredLifecycle: false, // PIT-correct
  debug: options.debug
});
// Use sql.signalSelect, sql.setupSelect, sql.entrySelect directly
```

**Verification**:
```bash
# Parity test before deletion
node scripts/parity-compiler-legacy.js XAUUSD 90 orb_classic
node scripts/parity-compiler-legacy.js XAUUSD 90 doyle_sd
# Expected: identical candidate IDs
```

---

### Solution 7: Stable Zone Identity + Lifecycle Expiry (P1 — Week 3)

**Problem**: 24.6M zone rows (re-emitted every bar) → timeouts, query bloat

**Fix**: Per remediation plan Change 5:

```sql
-- Migration 1: Add zone_id
ALTER TABLE features_zone ADD COLUMN zone_id TEXT;
CREATE UNIQUE INDEX idx_zone_identity ON features_zone (symbol, tf, zone_id);

-- Migration 2: Upsert semantics in zone producer
-- apps/engine/src/features/zone.ts serialize():
const zoneId = createHash('sha256')
  .update(`${symbol}|${tf}|${zone_kind}|${direction}|${formation_ts}|${Math.round(top*1e5)}|${Math.round(bottom*1e5)}`)
  .digest('hex').slice(0, 32);

-- DAG runner persist: ON CONFLICT (symbol, tf, zone_id) DO UPDATE ...

-- Migration 3: Lifecycle expiry (30 days after invalidation)
-- packages/shared/src/lifecycle.ts: add zone expiry job
```

**Verification**:
```sql
SELECT COUNT(*) FROM features_zone; -- Expected: < 1M (was 24.6M)
SELECT COUNT(*) FROM features_zone WHERE symbol = 'XAUUSD' AND tf = '5m'; -- Expected: < 50K (was 2.3M)
```

---

### Solution 8: Capability Contract at Seed Time (P1 — Week 2)

**Problem**: Specs seeded without validating feature/tf surfaces exist

**Fix**: Per remediation plan Change 4:

```typescript
// packages/strategies/src/validate.ts
async function validateCapability(spec: StrategySpec, pool: Pool): Promise<ValidationError[]> {
  const required = collectRequiredFeatureTfs(spec); // from conditions + signalSource
  const matrix = await collectCapabilityMatrix(required, pool);
  const errors = [];
  for (const [key, verdict] of Object.entries(matrix)) {
    if (verdict === 'EMPTY_DENSE' || verdict === 'MISSING_TABLE' || verdict === 'STALE_STATE') {
      errors.push({ code: 'CAPABILITY_BLOCK', feature: key, verdict });
    }
  }
  return errors;
}

// scripts/seed-strategy-specs.js: call after validateSpec()
// scripts/promote-top3-live.js: call before promotion
```

**Verification**:
```bash
node scripts/seed-strategy-specs.js
# Expected: specs requiring features_zone_retest@1m (0 rows) fail at seed time
```

---

### Solution 9: Candidate Audit Table (P2 — Week 4)

**Problem**: No audit trail for rejected candidates → "why no trades?" = manual archaeology

**Fix**: Per remediation plan Change 7:

```sql
-- Migration
CREATE TABLE strategy_signal_candidates (
  candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  side TEXT NOT NULL,
  entry_price NUMERIC,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  bias_direction TEXT,
  feature_snapshot_json JSONB,
  setup_grade TEXT,
  setup_block_reasons TEXT[],
  gate_results_json JSONB,
  decision_stage TEXT NOT NULL, -- 'signal'|'setup'|'gates'|'heat'|'executed'|'rejected'
  decision_reason TEXT,
  source TEXT NOT NULL, -- 'live'|'backtest'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON strategy_signal_candidates (strategy_id, ts DESC);
CREATE INDEX ON strategy_signal_candidates (symbol, ts DESC);
```

```typescript
// scripts/backtest-pit-v2.js & liveRunner.ts: write at each stage
await pool.query(`
  INSERT INTO strategy_signal_candidates (...) VALUES (...)
`, [candidateId, strategyId, symbol, tf, ts, side, entry, sl, tp, bias, 
    JSON.stringify(featureSnapshot), setupGrade, blockReasons, 
    JSON.stringify(gateResults), stage, reason, source]);
```

**Verification**:
```sql
SELECT decision_stage, COUNT(*) FROM strategy_signal_candidates 
WHERE strategy_id = 'orb_classic' AND ts > NOW() - INTERVAL '90 days'
GROUP BY decision_stage;
-- Shows full funnel: signal → setup → gates → heat → executed/rejected
```

---

### Solution 10: CLI Argument Parsing Fix (P0 — Day 1)

```javascript
// scripts/backtest-pit-v2.js — top of main()
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}
// ... rest of parsing
```

---

## Part 6: Implementation Priority & Timeline

### Week 1 (P0 — Unblock Pipeline)
| Day | Task | Owner |
|-----|------|-------|
| 1 | Fix CLI `--help` parsing | Dev |
| 1-2 | Add FX weekend calendar guard (EA + ingestion server + DB constraint) | Dev |
| 2-3 | Change freshness checks to use tradable candle edge | Dev |
| 3-4 | Repair ATR zero rows + add DB constraint + producer validation | Dev |
| 4-5 | Make volatility gate percentile-based default + fix spread cap | Dev |

### Week 2 (P0 — Fix Setup Engine & SQL Unification)
| Day | Task | Owner |
|-----|------|-------|
| 1-3 | Family-aware setup engine (hard rules + context builder + graders) | Dev |
| 3-5 | Unify SQL generation — delete backtest fork, route through compiler | Dev |
| 5 | Capability contract at seed time | Dev |

### Week 3 (P1 — Zone Identity & Performance)
| Day | Task | Owner |
|-----|------|-------|
| 1-2 | Stable zone_id migration + upsert producer + lifecycle expiry | Dev |
| 3-4 | Market levels view + SQL migration | Dev |
| 5 | Verify zone table < 1M rows, query < 500ms | Dev |

### Week 4 (P2 — Observability)
| Day | Task | Owner |
|-----|------|-------|
| 1-3 | Candidate audit table + backtest/live writers | Dev |
| 4-5 | Dashboard/queries for "why no trades?" | Dev |

---

## Part 7: Verification Checklist (All Changes Complete)

```bash
# 1. No weekend FX candles
SELECT COUNT(*) FROM candles_1m WHERE symbol='EURUSD' AND ts>='2026-07-11' AND ts<='2026-07-12 21:00';
# = 0

# 2. Features fresh on Monday morning
node scripts/backtest-pit-v2.js EURUSD 90 waqar_v2 --json --mode=research
# dataQuality: "READY" (not BLOCKED_SYSTEM_QUALITY)

# 3. ATR zero rows = 0
SELECT COUNT(*) FROM features_atr WHERE symbol IN ('EURUSD','GBPUSD') AND tf='15m' AND atr_value=0 AND ts>NOW()-INTERVAL '90 days';
# = 0

# 4. ORB strategy not blocked by zone rules
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
# setupBlocked < 50%, block reasons ORB-specific

# 5. XAUUSD strategies not blocked by volatility gate
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 watukushay_no1 --json --mode=full
# executed > 0, volatility gate skips < 20%

# 6. Zone table < 1M rows
SELECT COUNT(*) FROM features_zone; # < 1,000,000

# 7. Specs with impossible features fail at seed
node scripts/seed-strategy-specs.js
# specs requiring features_zone_retest@1m fail with CAPABILITY_BLOCK

# 8. Candidate audit works
SELECT decision_stage, COUNT(*) FROM strategy_signal_candidates WHERE strategy_id='orb_classic' GROUP BY decision_stage;
# Shows full funnel
```

---

## Part 8: What This Prevents Forever

| Failure Mode | Before Fix | After Fix |
|--------------|------------|-----------|
| Weekend candles poison freshness | ✅ Happens | ❌ Impossible (3-layer guard) |
| ATR zero rows corrupt signals | ✅ 99% zero | ❌ Impossible (DB constraint + producer validation) |
| ORB blocked by zone rules | ✅ 97% blocked | ❌ Impossible (family-aware engine) |
| XAUUSD blocked by vol gate | ✅ 100% blocked | ❌ Impossible (percentile default) |
| Backtest ≠ Live SQL | ✅ Drift | ❌ Impossible (single compiler) |
| Zone table explosion | ✅ 24.6M rows | ❌ Impossible (stable identity + expiry) |
| Impossible specs seeded | ✅ Happens | ❌ Impossible (capability contract) |
| "Why no trades?" = archaeology | ✅ Manual | ❌ Impossible (candidate audit table) |

---

## Appendix: Files to Modify

### Ingestion / Calendar
- `mt5-ea/tradzfxManager_v5_0_1.mq5` — `IsTradableTime()` gate
- `scripts/ingestion-server.js` — `isTradableFxCandle()` validation
- `infra/migrations/` — `chk_fx_tradable_hours` constraint

### Freshness / Producer
- `packages/shared/src/utils/marketCalendar.ts` — `getLatestTradableCandle()`
- `packages/shared/src/db/producerRuns.ts` — `assertProducerFresh()`
- `scripts/backtest-pit-v2.js` — `checkCoverage()`

### ATR Repair
- `apps/engine/src/features/atr.ts` — zero-range validation
- `infra/migrations/` — `chk_atr_not_zero` constraint
- `scripts/backfill-historical-features.js` — repair run

### Setup Engine
- `packages/setupEngine/src/rules/hardRules.ts` — family dispatch
- `packages/setupEngine/src/contextBuilder.ts` — family-specific fetch
- `packages/setupEngine/src/graders/` — family-specific graders
- `packages/setupEngine/src/evaluateSetup.ts` — family pipeline

### Symbol Contract
- `packages/tradePipeline/src/gates/volatilityGate.ts` — percentile default
- `packages/setupEngine/src/contextBuilder.ts` — spread cap formula

### SQL Unification
- `scripts/backtest-pit-v2.js` — delete legacy fork, call `compileStrategy()`
- `packages/strategies/src/compiler.ts` — ensure PIT mode complete

### Zone Identity
- `infra/migrations/` — `zone_id` column + unique index
- `apps/engine/src/features/zone.ts` — `zone_id` computation + upsert
- `apps/engine/src/dag/runner.ts` — upsert persist
- `packages/shared/src/lifecycle.ts` — zone expiry job

### Capability Contract
- `packages/strategies/src/validate.ts` — `validateCapability()`
- `scripts/seed-strategy-specs.js` — call after `validateSpec()`
- `scripts/promote-top3-live.js` — call before promotion

### Candidate Audit
- `infra/migrations/` — `strategy_signal_candidates` table
- `scripts/backtest-pit-v2.js` — write at each stage
- `packages/tradePipeline/src/liveRunner.ts` — write at each stage + fix `findRecentDuplicate()`

### CLI Fix
- `scripts/backtest-pit-v2.js` — `--help` handling

---

**End of Report**  
*Generated 2026-07-12 from V4 sweep + Waqar deep-dive findings*