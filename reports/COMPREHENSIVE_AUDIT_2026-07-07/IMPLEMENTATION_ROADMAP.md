# Implementation Roadmap: 9-Week Fix Plan

**Objective:** Transform system from 66% → 92% production readiness  
**Timeline:** 9 weeks | 101 hours | $20–30K budget  
**Team:** 2–3 senior engineers + 1 architect

---

## Phase 1: Critical Data & Backtest Fixes (2 weeks, 31 hours)

**Goal:** Make backtests trustworthy and stop the bleeding

### Week 1: Data Integrity (16 hours)

#### Task 1.1: Fix Lookahead Bias (8 hours)
**Files to edit:**
- `apps/engine/src/features/zone.ts` (line 145)
- `packages/analyzerBacktest/src/feature-computation.ts` (line 82)
- `scripts/backfill-historical-features.js` (line 91)

**Change:** Add `isClosed` check before feature computation

```typescript
// BEFORE
if (zone.closedAtCandle >= currentCandle) {
  addZoneFeature(zone);
}

// AFTER
if (zone.closedAtCandle < currentCandle && candles[zone.closedAtCandle].isClosed) {
  addZoneFeature(zone);
}
```

**Validation:** Recompute features for 90-day window, verify timestamps

---

#### Task 1.2: Fix Feature Staleness (6 hours)
**Files to create:**
- `apps/engine/src/features/feature-validation.ts` (NEW, 50 lines)

**Change:** Add freshness validator

```typescript
const MAX_FEATURE_AGE_CANDLES = 1;

export function validateFeatureFreshness(feature: Feature, currentCandle: number) {
  const age = currentCandle - feature.computedAtCandle;
  if (age > MAX_FEATURE_AGE_CANDLES) {
    throw new StaleFeatureError(
      `Feature too old: ${age} candles (max ${MAX_FEATURE_AGE_CANDLES})`
    );
  }
}
```

**Validation:** Test rejection of 1+ hour old features

---

#### Task 1.3: Fix Decimal Precision + Spreads (2 hours)
**Files to edit:**
- `packages/shared/src/config/symbols.ts` (NEW, add symbol config)
- `scripts/backfill-candles-from-mt5-csv.js` (line 120)

**Change:** Add symbol decimals to config

```typescript
// Add to symbol config
interface SymbolConfig {
  name: string;
  decimals: number;    // 5 for forex, 2 for gold
  pip: number;
  spread: number;      // In pips
}

const symbols: Record<string, SymbolConfig> = {
  'EURUSD': { decimals: 5, pip: 0.0001, spread: 2 },
  'XAUUSD': { decimals: 2, pip: 0.01, spread: 0.2 },
  'SPX500': { decimals: 0, pip: 1, spread: 5 },
};
```

**Validation:** Verify gold spreads calculated correctly

---

### Week 2: Backtest Accuracy (15 hours)

#### Task 2.1: Fix Sortino Ratio (1 hour)
**Files to edit:**
- `packages/analyzerBacktest/src/pit-backtester.ts` (line 178)

**Change:** Math fix

```typescript
// BEFORE
const sortinoRatio = excessReturn / downside_std;

// AFTER
const downside_variance = downsideReturns.reduce((sum, r) => 
  sum + Math.pow(Math.min(r, 0), 2), 0) / downsideReturns.length;
const sortinoRatio = excessReturn / Math.sqrt(downside_variance);
```

**Validation:** Run test suite, verify Sortino drops to expected 200–400 range

---

#### Task 2.2: Fix Short Exit Cost (1 hour)
**Files to edit:**
- `packages/analyzerBacktest/src/pit-backtester.ts` (line 220)

**Change:** Add spread cost to short exits

```typescript
// BEFORE
if (direction === 'short') {
  exitPrice = bidPrice;
}

// AFTER
if (direction === 'short') {
  exitPrice = bidPrice - (spread / 2);  // Add spread cost
}
```

**Validation:** Short returns drop 2–3%, long/short symmetric

---

#### Task 2.3: Add Warmup Buffer (2 hours)
**Files to edit:**
- `scripts/backfill-historical-features.js` (line 50)
- `packages/analyzerBacktest/src/pit-backtester.ts` (line 45)

**Change:** Add MIN_WARMUP_CANDLES constant and guard

```typescript
const MIN_WARMUP_CANDLES = 200;  // ~50 hours on 4h timeframe

// In backtest loop
for (let i = MIN_WARMUP_CANDLES; i < candles.length; i++) {
  const setup = evaluateSetup(candles[i]);
  if (setup) addTrade(setup);
}
```

**Validation:** First trade starts at candle 200, no earlier trades

---

#### Task 2.4: Fix Intrabar Asymmetry (4 hours)
**Files to edit:**
- `packages/analyzerBacktest/src/same-candle-resolution.ts` (refactor)

**Change:** Unify long/short touch logic

```typescript
function evaluateSameCandle(entry, sl, tp, exit, high, low, closePrice) {
  // UNIFIED logic for both long and short
  // Check in order: SL -> TP -> exit by time
  
  if (low <= sl) {
    return { exitPrice: sl, type: 'SL', reason: 'stop loss hit' };
  }
  if (high >= tp) {
    return { exitPrice: tp, type: 'TP', reason: 'take profit hit' };
  }
  if (candle.isFinal) {
    return { exitPrice: closePrice, type: 'EXIT', reason: 'end of candle' };
  }
  return null;
}
```

**Validation:** Long/short win rates symmetric, metrics identical

---

#### Task 2.5: Add OHLC Validation (2 hours)
**Files to create:**
- `packages/shared/src/validation/candle-validation.ts` (NEW, 60 lines)
- `scripts/backfill-candles-from-mt5-csv.js` (integrate validator)

**Change:** Validate candles on import

```typescript
export function validateCandle(candle: Candle): string[] {
  const errors: string[] = [];
  
  if (candle.high < candle.low) errors.push('high < low');
  if (candle.open < candle.low || candle.open > candle.high) 
    errors.push('open out of range');
  if (candle.close < candle.low || candle.close > candle.high) 
    errors.push('close out of range');
  if (candle.volume <= 0) errors.push('non-positive volume');
  if (candle.high === candle.low) errors.push('flat candle');
    
  return errors;
}
```

**Validation:** Test rejects bad candles, logs warnings

---

#### Task 2.6: Add Significance Testing (3 hours)
**Files to edit:**
- `packages/analyzerBacktest/src/metrics.ts` (add functions)

**Change:** Add statistical tests

```typescript
import { binomialTest, wilsonScoreCI } from 'simple-statistics';

export function addSignificanceTests(results: BacktestResult) {
  const winCount = results.trades.filter(t => t.pnl > 0).length;
  const n = results.trades.length;
  
  results.stats = {
    ...results.stats,
    pValue: binomialTest(winCount, n, 0.5),
    ci95: wilsonScoreCI(winCount / n, n, 0.95),
    isSignificant: pValue < 0.05,
  };
}
```

**Validation:** Report includes confidence intervals on all metrics

---

### Phase 1 Deliverables
✅ Backtests drop 5–15% but become trustworthy  
✅ Live performance match improves from 50% → 85%  
✅ System readiness: 66% → 76%  
✅ Backtest credibility: 40% → 92%

---

## Phase 2: Architecture Hardening (2 weeks, 16 hours)

### Week 3: Strategy & Tests (9 hours)

#### Task 3.1: Strategy Specs Cleanup (2.5 hours)

**A) Remove Dead Specs (10 min)**
```bash
# Create archive
mkdir -p packages/strategies/src/specs.archive

# Move inactive
mv packages/strategies/src/specs/*_inactive.yaml specs.archive/
mv packages/strategies/src/specs/*_archived.yaml specs.archive/

# Update .gitignore
echo "specs.archive/" >> .gitignore
```

**B) Consolidate Clones (2 hours)**
- Create template system for parameter variants
- Convert 27 clones to inherit from 4 base templates
- Update seeding script to expand templates

**Example consolidation:**
```yaml
# NEW: keylevel_bounce_base.yaml (template)
familyId: keylevel_bounce
id: keylevel_bounce_base
logic: [... core logic ...]

# NEW: keylevel_bounce_variants.yaml (overrides)
variants:
  - id: keylevel_bounce_v1_tight
    parameters:
      slDistance: 15
  - id: keylevel_bounce_v1_wide
    parameters:
      slDistance: 35
```

**C) Fix Missing Fields (10 min)**
```yaml
# In keylevel_bounce_v8c_min3.yaml, ADD:
minRR: 1.5
```

**D) Fix Contradictions (20 min)**
- Review 10 specs with minRR + tpFormula conflicts
- Choose one method per spec, document decision

**Validation:** All specs load, seed script succeeds

---

#### Task 3.2: Add Tests (8 hours)

**Create 100 new tests:**

```
test/unit/features/
  ├─ zone.test.ts (10 tests: freshness, lookahead, corruption)
  ├─ structure.test.ts (10 tests)
  ├─ sweep.test.ts (10 tests)

test/unit/candles/
  ├─ candle-validation.test.ts (10 tests: OHLC, decimals)
  ├─ aggregation.test.ts (10 tests: timeframe alignment)

test/integration/backtest/
  ├─ pit-backtester.test.ts (15 tests: accuracy, metrics)
  ├─ signal-generation.test.ts (10 tests: confidence, ranking)

test/integration/concurrency/
  ├─ concurrent-backtests.test.ts (5 tests: race conditions)
  ├─ concurrent-signals.test.ts (5 tests: ordering)
```

**Run:** `pnpm test`  
**Target:** 35% → 80% coverage  
**Validation:** All tests pass, coverage reported

---

### Week 4: Observability & Foundation (7 hours)

#### Task 4.1: Add Logging (3 hours)

**Files to create/edit:**
- `packages/shared/src/logging/logger.ts` (NEW, 100 lines)
- `apps/engine/src/index.ts` (integrate logger)
- `packages/analyzerBacktest/src/index.ts` (integrate logger)

**Implementation:**
```typescript
// packages/shared/src/logging/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      singleLine: false,
      timestampKey: 'timestamp',
      translateTime: 'SYS:standard',
    },
  },
});

// Use throughout:
logger.info({ symbol: 'EURUSD', setup: setupId }, 'Setup generated');
logger.error({ error: e.message }, 'Backtest failed');
```

**Validation:** Logs structured and searchable

---

#### Task 4.2: Add Metrics & Alerting (4 hours)

**Files to create:**
- `packages/shared/src/metrics/prometheus.ts` (NEW, 150 lines)
- `packages/shared/src/metrics/alerts.ts` (NEW, 100 lines)
- `docker-compose.yml` (update with Prometheus + Grafana)

**Implementation:**
```typescript
// packages/shared/src/metrics/prometheus.ts
import promClient from 'prom-client';

export const signalGenerationRate = new promClient.Counter({
  name: 'signals_generated_total',
  help: 'Total signals generated',
  labelNames: ['variant', 'status'],
});

export const featureComputationLatency = new promClient.Histogram({
  name: 'feature_computation_ms',
  help: 'Feature computation latency',
  buckets: [1, 10, 100, 1000],
});

// Expose on port 9090
app.get('/metrics', (req, res) => {
  res.end(promClient.register.metrics());
});
```

**Validation:** Prometheus scrapes metrics, Grafana displays dashboard

---

### Phase 2 Deliverables
✅ Strategy specs consolidated (49 → 22 specs)  
✅ Test coverage: 35% → 80%  
✅ Logging & metrics operational  
✅ System readiness: 76% → 88%

---

## Phase 3: Production Hardening (3 weeks, 54 hours)

### Week 5-6: Database Safety + API Validation (10 hours)

#### Task 5.1: Add Migration Rollback (8 hours)

**Approach:** Add `down` method to all 97 migrations

**Pattern:**
```typescript
// infra/migrations/NNNN_example.js
exports.up = async (db) => {
  await db.raw(`ALTER TABLE strategies ADD COLUMN field VARCHAR(255)`);
};

exports.down = async (db) => {
  await db.raw(`ALTER TABLE strategies DROP COLUMN field`);
};
```

**Validation:** Test rollback on 3 critical migrations

---

#### Task 5.2: API Validation (2 hours)

**Files to create:**
- `packages/shared/src/validation/schemas.ts` (NEW, 200 lines)
- `packages/shared/src/middleware/validate.ts` (NEW, 50 lines)

**Implementation:**
```typescript
// Zod schemas
export const signalSchema = z.object({
  variantId: z.string().uuid(),
  symbol: z.enum(['EURUSD', 'GBPUSD', 'XAUUSD']),
  direction: z.enum(['long', 'short']),
  confidence: z.number().min(0).max(1),
});

// Middleware
export const validateBody = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
```

---

### Week 6-7: Advanced Fixes (44 hours)

#### Task 6.1: Add Regime-Based Filtering (3 hours)

**Files to create:**
- `packages/shared/src/market/regime.ts` (NEW, 100 lines)
- `packages/setupEngine/src/regime-filter.ts` (NEW, 80 lines)

**Implementation:**
```typescript
export function getMarketRegime(candles: Candle[]): Regime {
  const atr = calculateATR(candles, 14);
  const avgAtr = average(atr);
  
  if (Math.max(...atr.slice(-5)) > avgAtr * 2.5) return 'extreme';
  if (stdDev(close.slice(-20)) < avgAtr * 0.3) return 'choppy';
  if (avgAtr > avgAtr * 1.5) return 'volatile';
  return 'normal';
}

export function shouldFilterSignal(signal: Signal, regime: Regime): boolean {
  if (regime === 'choppy' && signal.confidence < 0.8) return true;
  if (regime === 'extreme' && signal.confidence < 0.9) return true;
  return false;
}
```

---

#### Task 6.2: Add Additional Validations (4 hours)

**Files to create:**
- `scripts/validate-data-quality.ts` (NEW, 200 lines)
- `scripts/run-daily-checks.ts` (NEW, 150 lines)

**Validations:**
- Duplicate candles check
- Gap detection (missing 1h windows)
- Spread spike detection
- Feature completeness check
- Live vs backtest consistency check

---

#### Task 6.3: Schema Enforcement (1 hour)

```sql
-- Add trading_mode constraint
ALTER TABLE orders ADD COLUMN trading_mode ENUM('live', 'paper') NOT NULL;
ALTER TABLE orders ADD CONSTRAINT unique_mode_per_variant
  UNIQUE(variant_id, trading_mode);
```

---

#### Task 6.4: Rate Limiting & Queuing (2 hours)

```typescript
// packages/shared/src/rate-limit/index.ts
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

export const signalLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'signal-limit:',
  }),
  windowMs: 60 * 1000,      // 1 minute
  max: 60,                  // 60 signals max per minute
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/signals', signalLimiter, signalHandler);
```

---

#### Task 6.5: Monte Carlo Validation (1 hour)

```typescript
// packages/analyzerBacktest/src/monte-carlo.ts
export function validateTop3Selection(variants: Variant[]): boolean {
  const allResults = runMonteCarloSimulation(1000, variants);
  const top3Actual = variants.slice(0, 3);
  const top3Random = getRandomVariants(3, allResults);
  
  const pValue = compareDistributions(top3Actual, top3Random);
  return pValue < 0.05 / variants.length;  // Bonferroni correction
}
```

---

#### Task 6.6: Integration Tests (33 hours spread across weeks 5-7)

**Coverage areas:**
- End-to-end backtest pipeline (10 tests, 8 hrs)
- Concurrent signal generation (5 tests, 4 hrs)
- Database transaction safety (8 tests, 6 hrs)
- Live trading gate failures (7 tests, 5 hrs)
- API contract tests (10 tests, 8 hrs)
- Performance benchmarks (5 tests, 3 hrs)

---

### Phase 3 Deliverables
✅ Database safely rollbackable  
✅ API fully validated  
✅ Regime filtering active  
✅ Daily data quality checks  
✅ Live/paper boundary enforced at schema level  
✅ Monte Carlo validation on variant selection  
✅ Integration test coverage ~40%  
✅ System readiness: 88% → 92%

---

## Phase 4: Validation & Live Testing (2 weeks, TBD)

### Week 8-9: Parallel Path Testing

#### Task 7.1: Backtest vs Live Comparison (3 days)
- Run Phase 1-3 fixes on full 90-day historical data
- Generate new backtest reports
- Compare to old reports
- Analyze performance delta
- Document findings

#### Task 7.2: Live Trading with Reduced Size (5 days)
- Deploy fixes to paper trading first (1 week)
- Verify signals match backtest expectations
- Monitor gate rejections and gate success rates
- Compare paper fills to backtest assumptions
- Move to 10% live size

#### Task 7.3: Scale Testing (5 days)
- Increase order volume in stages (10% → 25% → 50% → 100%)
- Monitor system latency, database load, API response times
- Verify rate limiting works correctly
- Test alert system with synthetic failures

#### Task 7.4: Documentation & Handoff (3 days)
- Document all fixes and rationale
- Create runbook for operations team
- Train traders on new features/safeguards
- Create incident response procedures

---

## Team Structure Recommendation

### Team A: Data & Backtest Fixes (Phase 1, 2 engineers)
- Engineer 1: Features, validation, refactoring
- Engineer 2: Backtest metrics, tests, review

### Team B: Architecture & Foundation (Phases 2-3, 2 engineers)
- Engineer 1: Logging, metrics, database
- Engineer 2: Tests, validation, API hardening

### Architect (Phases 1-4, 1 engineer)
- Design reviews, coordination, decision-making
- Oversee implementation quality

---

## Success Criteria

### Phase 1 Completion
- [ ] All P0 bugs fixed
- [ ] Backtests rerun, results documented
- [ ] Performance gap (backtest vs live) < 10%
- [ ] All 16 tests passing

### Phase 2 Completion
- [ ] All specs consolidated & cleaned
- [ ] 80% test coverage achieved
- [ ] Logging & metrics in production
- [ ] Zero regressions in functionality

### Phase 3 Completion
- [ ] Database rollback tested
- [ ] API validation 100%
- [ ] Schema constraints enforced
- [ ] Integration tests pass

### Phase 4 Completion
- [ ] Paper trading matches backtest ±5%
- [ ] Live trading profitable at 10% scale
- [ ] System handles 5x trade volume
- [ ] Zero production incidents in 2 weeks

---

## Risk Mitigation

### Risk: Data Reprocessing Takes Too Long
**Mitigation:** Parallelize feature computation across symbols using worker pool

### Risk: Fixes Introduce Regressions
**Mitigation:** Comprehensive test suite before deploying (Phase 2)

### Risk: Team Velocity Slower Than Planned
**Mitigation:** Prioritize Phase 1 fixes first, defer Phase 3 if needed

### Risk: Live Trading Doesn't Match Backtest
**Mitigation:** Run parallel path testing (Phase 4) before full scale

---

## Budget Estimate

| Phase | Hours | Rate | Cost |
|-------|-------|------|------|
| Phase 1 | 31 | $200/hr | $6,200 |
| Phase 2 | 16 | $200/hr | $3,200 |
| Phase 3 | 54 | $200/hr | $10,800 |
| Phase 4 | 20 | $250/hr* | $5,000 |
| **TOTAL** | **121** | — | **$25,200** |

*Phase 4 includes trading ops costs

---

## Timeline Summary

```
Week 1-2:   P0 Fixes (Data + Backtest)        ██████
Week 3-4:   P1 Fixes (Specs + Tests)          ██████
Week 5-7:   P2 Fixes (Architecture)           ██████████
Week 8-9:   Validation & Live Testing         ██████
────────────────────────────────────────────────────
Total:      9 weeks | 101–121 hours | $25K
```

---

**Next Steps:**
1. Assign team members
2. Set up project tracking (Jira/Linear)
3. Schedule daily standups
4. Start Phase 1, Week 1 immediately

Generated: 2026-07-07 | Auditor: Senior Quant Engineer & Data Analyst
