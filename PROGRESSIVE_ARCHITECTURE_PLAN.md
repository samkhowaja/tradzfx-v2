# Progressive Strategy Architecture — Full Recovery Plan

## Summary

3 problems, 1 root cause: **architecture built for flat SQL queries, not sequential ICT/SMC logic.**
Every condition evaluated at same timestamp. Features computed but lifecycle never marks stale rows.
AI generates `category:smc` with empty signal wiring = makes zero trades.

---

## Phase 0: Stop The Bleeding (do first, today)

### 0.1 Fix lifecycle refresh cron

Root cause: `refresh-lifecycle.js` stuck. PM2 process `tz-refresh-lifecycle` not advancing.

**Action:**
```bash
node scripts/refresh-lifecycle.js ALL 30 10000
```
Then check:
```bash
SELECT table_name, symbol, last_processed_ts, 
    EXTRACT(EPOCH FROM (NOW() - last_processed_ts))/3600 as hours_stale
FROM lifecycle_refresh_state ORDER BY hours_stale DESC;
```

### 0.2 Backfill dead event features

After lifecycle refresh, event features (OB, iFVG, sweep, structure) have 4-day gap (Jul 15-19).

**Action:**
```bash
export ZONE_BACKFILL_SKIP_OUTCOMES=1
node scripts/backfill-historical-features.js XAUUSD,EURUSD,GBPUSD 1d,4h,1h,15m,5m \
  --start=2026-07-15 --end=2026-07-19
```

### 0.3 Run direction_state for all pairs

Only XAUUSD+EURUSD have direction_state. Other symbols missing.

**Action:**
```bash
node scripts/reconcile-direction-state.js GBPUSD 1h
node scripts/reconcile-direction-state.js USDJPY 1h
# ... for all 8 active symbols
```

---

## Phase 1: Progressive Compiler (the core fix)

### 1.1 New YAML format: sequential `steps` replace flat `setup`+`entry`

**Current (flat):**
```yaml
setup:
  - feature: features_bias, tf: 1h, predicate: "direction = 'bullish'"
  - feature: features_zone, tf: 1h, predicate: "zone_kind = 'demand'"
entry:
  - feature: features_sweep, tf: 5m, predicate: "direction = 'bullish'"
```

**New (progressive):**
```yaml
steps:
  - id: find_bias
    feature: features_bias
    tf: 1h
    predicate: "direction != 'neutral'"
    required: true
    # Output: bias_direction, bias_ts

  - id: find_level
    feature: features_zone
    tf: 1h
    dependsOn: [find_bias]
    predicate: "zone_kind IN ('demand','supply') AND is_fresh = true"
    lookbackBars: 48
    # Input b from find_bias. Conditions:
    #   zone.ts >= b.bias_ts  ← zone formed AFTER bias, not from old cycle
    #   zone.ts < b.bias_ts + 48h lookback
    # Output: zone_top, zone_bottom, zone_ts

  - id: find_sweep
    feature: features_sweep
    tf: 5m
    dependsOn: [find_bias, find_level]
    predicate: "direction = 'bullish'"
    lookbackBars: 12
    # Input b from find_bias, l from find_level. Conditions:
    #   sweep.ts >= l.zone_ts  ← sweep AFTER zone
    #   sweep.direction == b.bias_direction  ← aligned with bias
    # Output: sweep_ts, sweep_price

entry:
  - id: enter_on_retest
    feature: features_structure
    tf: 5m
    dependsOn: [find_level, find_sweep]
    predicate: "event_type = 'bos'"
```

### 1.2 Compiler generates sequential CTE chain

```sql
WITH
-- Step 1: Find HTF bias first
step_find_bias AS (
  SELECT symbol, ts as bias_ts, direction as bias_direction
  FROM features_bias
  WHERE tf='1h' AND direction != 'neutral'
    AND ts >= $1 AND ts <= $2
),
-- Step 2: Within that bias, find zones formed AFTER bias started
step_find_level AS (
  SELECT DISTINCT ON (z.symbol, z.ts)
    z.symbol, z.bottom, z.top, z.ts as zone_ts,
    b.bias_direction
  FROM features_zone z
  JOIN step_find_bias b ON z.symbol = b.symbol
  WHERE z.tf='1h'
    AND z.zone_kind IN ('demand','supply')
    AND z.is_fresh = true
    AND z.ts >= b.bias_ts  -- ← KEY: zone after bias, not before
    AND z.ts <= b.bias_ts + INTERVAL '48 hours'
),
-- Step 3: Sweep at that zone
step_find_sweep AS (
  SELECT s.symbol, s.ts as sweep_ts, s.price
  FROM features_sweep s
  JOIN step_find_level l ON s.symbol = l.symbol
  WHERE s.tf='5m'
    AND s.ts >= l.zone_ts  -- ← KEY: sweep after zone
    AND s.ts <= l.zone_ts + INTERVAL '60 minutes'
),
-- Entry signal
SELECT ...
```

### 1.3 Key rule: `dependsOn` creates `_ts` ordering

Every step with `dependsOn: [parent]` must have:

1. **`current.ts >= parent.ts`** — step forms after parent
2. **`current.ts <= parent.ts + lookback`** — bounded recency
3. **`current.direction == parent.direction`** — directional alignment (if applicable)

This naturally EXCLUDES old zones from last cycle. A zone from Feb 2 cannot have `ts >= bias_ts` where bias_ts is today. Zero old data leaks.

---

## Phase 2: Permanent Feature Freshness (no more stale data)

### 2.1 Remove `skipLifecycle: true` for event features

**Change in pipelineTrigger.ts:**
```typescript
// Separate lifecycle config per feature type
const LIFECYCLE_FEATURES = ['features_zone', 'features_order_block', 
  'features_ifvg', 'features_sweep', 'features_structure',
  'features_order_block', 'features_liquidity_pools'];

// Run lifecycle after every feature compute for event tables only
// State features (bias, atr, etc) only need periodic refresh
```

Better: split pipelineTrigger into two passes:
- **Pass 1: Compute** — all features (as today, skipLifecycle=true for speed)
- **Pass 2: Lifecycle update** — only event features, lightweight per-bar sweep

### 2.2 Add age-based TTL in lifecycle

Add SQL function: `invalidate_zones_older_than(tf, max_age_hours)` that sets `is_fresh=false` for zones older than the per-TF threshold:

| TF | Max fresh age | Rationale |
|----|--------------|-----------|
| 1m | 24 hours | Micro zones expire fast |
| 5m | 48 hours | Scalp zones |
| 15m | 5 days | Intraday zones |
| 1h | 14 days | Daily swing zones |
| 4h | 30 days | Multi-day zones |
| 1d | 90 days | Structural zones |

Run as part of lifecycle refresh. After this fix: Feb 2 zones get `is_fresh=false`.

### 2.3 Add feature freshness monitoring

**Check:**
```sql
-- Alerts when event feature hasn't updated in 6 hours
SELECT feature_table, symbol, MAX(ts), 
  EXTRACT(EPOCH FROM (NOW() - MAX(ts)))/3600 as hours_stale
FROM feature_producer_runs
WHERE feature_table IN ('features_zone','features_order_block','features_ifvg',
  'features_sweep','features_structure')
GROUP BY feature_table, symbol
HAVING MAX(ts) < NOW() - INTERVAL '6 hours';
```

Integrate into PM2 health check `monitor-v2-health.ps1`.

---

## Phase 3: Backtest Performance Improvement

### 3.1 Progressive CTE is inherently faster

Current flat compiler:
1. Scans ALL bias rows in time window
2. For each bias row, scans ALL zone rows — JOIN explosion
3. For each zone match, scans ALL entry rows

Progressive CTE:
1. Step 1: ~100 bias rows
2. Step 2: ~20 zones per bias × 100 biases = 2000 (filtered by `ts >= bias_ts`)
3. Step 3: ~2 sweeps per zone × 200 = 400

**Big-O: O(n³) → O(n × k × m)** where k and m are tiny filtered subsets.

### 3.2 Backtest gains: no old zones to scan

Old zones from Feb 2 would be excluded by `ts >= bias_ts` check. No need to scan them, no need to persist them in PIT state. Each backtest bar only sees zones formed within the current bias window.

### 3.3 Execution time estimate

| Symbol | Current (flat) | Progressive | Speedup |
|--------|---------------|-------------|---------|
| XAUUSD (90d) | ~45 min | ~8 min | ~5.6x |
| EURUSD (90d) | ~12 min | ~3 min | ~4x |
| ALL (90d) | ~4 hours | ~35 min | ~7x |

---

## Phase 4: GARCH Vol Scaling (from YouTube video)

After progressive compiler works and produces real signals:

### 4.1 Continuous size multiplier replaces binary vol gate

Current: vol gate blocks entry when ATR outside range.
New: scale size factor based on volatility percentile.

**Implementation:**
```typescript
// In volatilityGate.ts, add to MarketContext output:
sizeMultiplier: number;  // 0.0 - 2.0

// Logic:
const volPercentile = profile.p50;  // current 50th percentile ATR
const targetVol = profile.p50;      // calibrate to median
const sizeMultiplier = targetVol / volPercentile;
// Clamp: min 0.25, max 2.0
```

### 4.2 Account-level risk budget

New config in spec:
```yaml
riskManagement:
  maxAccountRiskPerDay: 0.02       # 2% daily
  maxAccountRiskPerTrade: 0.005    # 0.5% per trade
  volatilityTarget: 0.15           # 15% annual vol target (institutional)
  volScalingEnabled: true
  volScalingMinSize: 0.25
  volScalingMaxSize: 2.0
```

---

## Implementation Order

```
Week 1: Phase 0 (stop bleeding)
  Day 1: Fix lifecycle cron + backfill event features
  Day 2: TTL age-based invalidation + direction_state fill
  Day 3: PipelineTrigger lifecycle split (compute vs lifecycle passes)
  
Week 2: Phase 1 (progressive compiler)
  Day 1-2: YAML schema + parser for sequential steps
  Day 3-4: CTE chain generator
  Day 5: Wire lewis_kelly_smc as first progressive spec
  
Week 3: Phase 2 (feature freshness automation)
  Day 1-2: TTL cron + monitoring alerts
  Day 3: Health check integration
  
Week 4: Phase 3 (performance)
  Day 1-2: Profile backtest speedup
  Day 3: Backfill all specs to progressive format
  
Week 5+: Phase 4 (GARCH vol scaling)
  Add size multiplier, account risk budget, stress testing
```

---

## How This Fixes Each Symptom

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Old zones in setups | Flat compiler doesn't filter by bias ts | Progressive: `zone.ts >= bias.ts` |
| Event features dead Jul 15 | skipLifecycle=true | Split lifecycle pass for event features |
| Strategy makes 0 trades | signalSource=none | New spec format enforces wiring |
| Bad backtest results | MA crossover with breakeven TP | Real ICT/SMC spec (lewis_kelly) |
| AI creates broken specs | No progressive spec template | New format with `dependsOn` |
| Backtest too slow | Cartesian product joins | Sequential CTE reduces join space |
