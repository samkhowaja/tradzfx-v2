# Feature Lineage Map: Dependency Graph & Backfill Semantics — 2026-08-17

**Status:** Read-only governance documentation (frozen phase)  
**Audience:** Data engineering, backtest validation, feature maintenance, governance  
**Purpose:** Document complete feature generation DAG, backfill procedures, live vs backtest semantics

---

## Executive Summary

**Feature Dependency Graph:**

The tradzfx engine computes 32 features organized in a DAG (Directed Acyclic Graph) with 4 dependency layers:

```
Layer 0 (Leaf):         atr, pivot, indicator, session, spread, ...
                        (read candles only; no feature inputs)
                        
Layer 1 (Derived-1):    volatilityNormalized (← atr)
                        structuralPricing, eqLiquidity (← pivot, atr)
                        
Layer 2 (Derived-2):    structure (← pivot, atr, htfBias)
                        orderBlock (← structure)
                        sweep (← pivot, atr, structure)
                        zone (← pivot, atr, htfBias, structure)
                        directionState (← bias, htfBias)
                        
Layer 3 (Derived-3):    liquidityPools (← sweep)
                        zoneRetest (← zone)
                        liquidityEventV2 (← atr, liquidityLevelV2)
```

**Canonical Contract:**
- ✅ All features read from `market.candles_1m_canonical` only (safe by construction)
- ✅ No feature reads raw `candles_1m` (prevents suspect data leakage)
- ✅ All feature rows tagged with `detector_version` at persist time
- ✅ Backtest reads features from canonical timepoint (immutable)
- ✅ Live features generated in real-time with latest canonical state

**Backfill Semantics:**
- **Leaf features:** Backfill by re-running producer over canonical window (full recompute)
- **Derived features:** Backfill by reading upstream features + re-running logic
- **Both:** New rows tagged with detector_version from environment
- **Idempotent:** ON CONFLICT PRIMARY KEY overwrites stale rows

---

## Part 1: Feature Registration & Contracts

### 1.1 Feature Registry Overview

**File:** `packages/strategies/src/featureRegistry.ts`

Each feature has a semantic contract defining:
- **Table name** (e.g., `features_bias`)
- **Semantic type:** `state` (latest), `event` (point-in-time), `level` (lifecycle window), `distribution` (sample set)
- **Join policy:** How backtest/setup/signals consume it (`latest_as_of`, `active_window`, `candidate_set`, `sample_distribution`, `session_scoped`)
- **Freshness window:** Max age acceptable in live mode (per timeframe)
- **Lookback bars:** Default history window for each timeframe
- **Confirmation bars:** Bars needed after `ts` to confirm the event (prevents lookahead bias in backtest)
- **Required columns:** Schema validation
- **Supported timeframes:** Which TFs are meaningful

### 1.2 Feature Categories (by semantic type)

**State Features** (latest row as of anchor):
- `features_bias` — direction bias (bullish/bearish/neutral)
- `features_htf_bias` — higher-timeframe bias context
- `features_atr` — Average True Range volatility
- `features_volatilityNormalized` — ATR percentile
- `features_pricing` — price level classifications
- `features_spread` — spread in pips

**Event Features** (point-in-time occurrences):
- `features_pivot` — swing high/low confirmations
- `features_structure` — BOS, CHoCH, market structure
- `features_sweep` — sweep events
- `features_displacement` — displacement events
- `features_timeOfDayEdge` — session boundary edges
- `features_pushPull` — price action patterns

**Level Features** (lifecycle windows with validity):
- `features_zone` — supply/demand zones (active until invalidated/retested)
- `features_ifvg` — internal Fair Value Gaps
- `features_orderBlock` — order blocks (active until mitigated)
- `features_eqLiquidity` — equal lows/highs liquidity pools

**Distribution Features** (sample sets):
- `features_correlation` — correlation samples over window
- `features_sessionHl` — session high/low distribution
- `features_openingRange` — opening range per session
- `features_sessionRangeV2` — session range statistics

---

## Part 2: Dependency Graph (Complete)

### 2.1 Layer 0: Leaf Features (No Dependencies)

These features read **candles only** from `market.candles_1m_canonical`:

```
features_atr
  ├─ Input: candles (o, h, l, c, v)
  ├─ Output: atr (14-bar ATR)
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/atr.ts
  └─ Table: features_atr

features_pivot
  ├─ Input: candles (h, l, c)
  ├─ Output: swing pivots (high/low with N-bar confirmation)
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/pivot.ts
  └─ Table: features_pivot

features_indicator
  ├─ Input: candles (o, h, l, c, v)
  ├─ Output: Various indicators (RSI, MACD, etc.)
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/indicator.ts
  └─ Table: features_indicator

features_session
  ├─ Input: candles (ts, o, c)
  ├─ Output: Session boundaries (session start, end)
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/session.ts
  └─ Table: features_session

features_spread
  ├─ Input: candles (spread column)
  ├─ Output: Spread statistics (average, min, max)
  ├─ Timeframes: 1m only (then aggregated to HTFs)
  ├─ Producer: apps/engine/src/features/spread.ts
  ├─ Query: SELECT FROM market.candles_1m_canonical (lines 40)
  └─ Table: features_spread

features_sessionHl
  ├─ Input: candles (h, l, ts)
  ├─ Output: Session high/low per day
  ├─ Timeframes: 1h, 4h, 1d (intraday/daily aggregates)
  ├─ Producer: apps/engine/src/features/sessionHl.ts
  └─ Table: features_sessionHl

features_openingRange
  ├─ Input: candles (h, l, c, ts)
  ├─ Output: ORB range per session (Asia, London, NY)
  ├─ Timeframes: 1m, 5m, 15m (intraday only)
  ├─ Producer: apps/engine/src/features/openingRange.ts
  └─ Table: features_opening_range

features_sessionRangeV2
  ├─ Input: candles (h, l, ts)
  ├─ Output: Session range + percentile
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/sessionRangeV2.ts
  └─ Table: features_session_range_v2

features_candlePattern
  ├─ Input: candles (o, h, l, c)
  ├─ Output: Candle patterns (hammer, engulfing, etc.)
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/candlePattern.ts
  └─ Table: features_candle_pattern

features_displacement
  ├─ Input: candles (o, c)
  ├─ Output: Displacement events (gap, breakaway)
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/displacement.ts
  └─ Table: features_displacement

features_timeOfDayEdge
  ├─ Input: candles (ts)
  ├─ Output: Session edge events (open, close, premarket)
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/timeOfDayEdge.ts
  └─ Table: features_time_of_day_edge

features_pushPull
  ├─ Input: candles (o, h, l, c, v)
  ├─ Output: Push/Pull price action
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/pushPull.ts
  └─ Table: features_push_pull

features_correlation
  ├─ Input: candles (c) for multiple symbols
  ├─ Output: Correlation samples
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/correlation.ts
  └─ Table: features_correlation

features_movingAverage
  ├─ Input: candles (c)
  ├─ Output: Moving average crossovers
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/movingAverage.ts
  └─ Table: features_moving_average

features_bollinger
  ├─ Input: candles (h, l, c)
  ├─ Output: Bollinger band statistics
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/bollinger.ts
  └─ Table: features_bollinger

features_keltner
  ├─ Input: candles (h, l, c)
  ├─ Output: Keltner channel statistics
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/keltner.ts
  └─ Table: features_keltner

features_ifvg
  ├─ Input: candles (h, l, c)
  ├─ Output: Internal Fair Value Gaps
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/ifvg.ts
  └─ Table: features_ifvg

features_htfBias
  ├─ Input: candles (o, h, l, c) at parent TF
  ├─ Output: Higher-timeframe bias (aggregated direction)
  ├─ Timeframes: 1m (from 5m/15m/1h/4h/1d parent)
  ├─ Producer: apps/engine/src/features/htfBias.ts
  └─ Table: features_htf_bias

features_bias
  ├─ Input: candles (o, c, h, l)
  ├─ Output: Bias (bullish/bearish/neutral)
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/bias.ts
  └─ Table: features_bias
```

### 2.2 Layer 1: Single-Dependency Features

```
features_volatilityNormalized
  ├─ Dependencies: features_atr (layer 0)
  ├─ Logic: ATR percentile ranking
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/volatilityNormalized.ts
  └─ Query: SELECT atr FROM features_atr WHERE ...

features_pricing
  ├─ Dependencies: features_pivot (layer 0), features_atr (layer 0)
  ├─ Logic: Price level classification relative to pivots
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/pricing.ts:363
  └─ Query: SELECT FROM features_pivot, features_atr WHERE ...

features_eqLiquidity
  ├─ Dependencies: features_pivot (layer 0), features_atr (layer 0)
  ├─ Logic: Equal lows/highs from pivot points
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/eqLiquidity.ts:94
  └─ Query: SELECT FROM features_pivot, features_atr WHERE ...

features_liquidityLevelV2
  ├─ Dependencies: features_atr (layer 0)
  ├─ Logic: Liquidity pool level detection
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/liquidityV2.ts:92
  └─ Query: SELECT FROM features_atr WHERE ...
```

### 2.3 Layer 2: Multi-Dependency Features

```
features_structure
  ├─ Dependencies: 
  │  ├─ features_pivot (layer 0)
  │  ├─ features_atr (layer 0)
  │  └─ features_htfBias (layer 0)
  ├─ Logic: BOS/CHoCH/market structure detection
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/structure.ts:217
  └─ Query: SELECT FROM features_pivot, features_atr, features_htf_bias WHERE ...

features_zone
  ├─ Dependencies:
  │  ├─ features_pivot (layer 0)
  │  ├─ features_atr (layer 0)
  │  ├─ features_htfBias (layer 0)
  │  └─ features_structure (layer 2)
  ├─ Logic: Supply/demand zone detection
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Lifecycle: createdAt, invalidatedAt, retestCount
  ├─ Producer: apps/engine/src/features/zone.ts:491
  └─ Query: SELECT FROM features_pivot, features_atr, features_htf_bias, features_structure WHERE ...

features_sweep
  ├─ Dependencies:
  │  ├─ features_pivot (layer 0)
  │  ├─ features_atr (layer 0)
  │  └─ features_structure (layer 2)
  ├─ Logic: Sweep events (liquidity run-throughs)
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/sweep.ts:248
  └─ Query: SELECT FROM features_pivot, features_atr, features_structure WHERE ...

features_orderBlock
  ├─ Dependencies: features_structure (layer 2)
  ├─ Logic: Order block formation from structure
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Lifecycle: createdAt, mitigatedAt
  ├─ Producer: apps/engine/src/features/orderBlock.ts:152
  └─ Query: SELECT FROM features_structure WHERE ...

features_directionState
  ├─ Dependencies:
  │  ├─ features_bias (layer 0)
  │  └─ features_htfBias (layer 0)
  ├─ Logic: Reconcile bias + htfBias into unified direction state
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/directionState.ts:115
  └─ Query: SELECT FROM features_bias, features_htf_bias WHERE ...

features_liquidityEventV2
  ├─ Dependencies:
  │  ├─ features_atr (layer 0)
  │  └─ features_liquidityLevelV2 (layer 1)
  ├─ Logic: Liquidity event confirmation
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/liquidityV2.ts:104
  └─ Query: SELECT FROM features_atr, features_liquidity_level_v2 WHERE ...
```

### 2.4 Layer 3: Downstream Features

```
features_liquidityPools
  ├─ Dependencies: features_sweep (layer 2)
  ├─ Logic: Aggregate sweep events into liquidity pool zones
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/liquidityPools.ts:278
  └─ Query: SELECT FROM features_sweep WHERE ...

features_zoneRetest
  ├─ Dependencies: features_zone (layer 2)
  ├─ Logic: Zone retest events
  ├─ Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
  ├─ Producer: apps/engine/src/features/zoneRetest.ts:83
  └─ Query: SELECT FROM features_zone WHERE ...
```

### 2.5 Visual DAG

```
Candles (market.candles_1m_canonical)
    │
    └─────────────────┬─────────────────┬──────────────┬──────────────┐
                      │                 │              │              │
         (atr)   (pivot)        (indicator)      (session)        (spread)
            │       │                │               │               │
            │       │                │               │               │
            ├───────┼────────────────┤               │               │
            │       │                │               │               │
         [Layer 0: Leaf Features - All read candles only]
            │       │       │        │       │       │       │       │
            └──┬────┴─┬─────┴──┬─────┴───┬───┴───┬───┴──┬────┴──┬────┘
               │      │        │         │       │      │       │
    volatility pivot  pricing  spread    bias    htf    iFVG  keltner
    Normalized + atr + atr   + stats    diag    bias   + ...  + ...
       │       │      │       │         │       │      │       │
       └─┬─────┴──┬───┴───┬───┴────┬────┴───┬───┴──┬───┴──┬────┘
         │        │       │        │        │      │      │
         └────────┼───────┼────────┼────────┼──────┼──────┘
                  │       │        │        │      │
    [Layer 1: Single Dependencies]
                  │       │        │        │      │
    structure  orderBlock sweep  zone  eqLiquidity directionState
         │       │        │        │      │        │
         └───┬───┴───┬────┴────┬───┴──┬───┴────┬───┘
             │       │         │      │        │
    [Layer 2: Multi Dependencies]
             │       │         │      │        │
         liquidityPools  zoneRetest  liquidityEventV2
             │             │             │
    [Layer 3: Downstream Features]
```

---

## Part 3: Feature Producer Semantics

### 3.1 Detector Version Tagging

**File:** `apps/engine/src/dag/runner.ts:725–726`

```typescript
// Every feature row is tagged with detector version
row[col] = process.env.TM_CANDLE_DETECTOR_VERSION ?? "detector-v3";
```

**Semantics:**
- Each feature row carries `detector_version` column
- Records which candle detector version was used when feature was computed
- Immutable: tagged at persist time, never modified

**Example:**
```
features_bias row:
  symbol=XAUUSD, ts=2026-08-17T10:30:00Z, tf=1h, direction=bullish, detector_version=detector-v3
  
features_structure row:
  symbol=XAUUSD, ts=2026-08-17T10:31:00Z, tf=1h, event=BOS, detector_version=detector-v3
```

### 3.2 Live Producer Flow

**File:** `apps/engine/src/worker/featureWorker.ts:125–160`

```typescript
async function runLiveProducer() {
  // 1. Fetch latest canonical candle timestamp
  const latestTs = await db.query(
    `SELECT ts FROM market.candles_1m_canonical WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );
  
  if (!latestTs) {
    console.log('No canonical candles; skip feature generation');
    return; // Fail-closed: no data → no features
  }
  
  // 2. Fetch lookback candles from canonical (safe by construction)
  const candles = await fetchCandles(symbol, '1m', latestTs, lookbackBars=500);
  
  // 3. Run DAG (computes all features in dependency order)
  const results = await dag.run(symbol, candles, latestTs);
  
  // 4. Persist feature rows with detector_version tag
  for (const [featureName, rows] of Object.entries(results)) {
    for (const row of rows) {
      row.detector_version = process.env.TM_CANDLE_DETECTOR_VERSION ?? "detector-v3";
      await persistFeature(featureName, row);
    }
  }
}
```

### 3.3 Backtest PIT Flow

**File:** `scripts/backtest-pit-v2.js:650–700`

```javascript
async function runBacktestPIT() {
  // 1. Fetch canonical candles for backtest window (frozen in time)
  const candles = await db.query(
    `SELECT * FROM market.candles_1m_canonical 
     WHERE symbol = $1 AND ts BETWEEN $2 AND $3 
     ORDER BY ts ASC`,
    [symbol, windowStart, windowEnd]
  );
  
  // 2. For each candle in sequence (immutable), compute features
  for (const candle of candles) {
    // Historical features already computed and stored
    // OR compute on-demand if backfill was run
    const features = await fetchOrComputeFeatures(symbol, candle.ts, lookback=500);
    
    // 3. Use features for setup evaluation, signal generation
    const signals = await evaluateSetup(features, candle);
    
    // Results tagged with canonical state at this timepoint
  }
}
```

**Key Difference from Live:**
- Live: Computes features once per new canonical candle (incremental)
- Backtest: Computes features for every historical canonical candle (deterministic replay)
- Immutability: Backtest result tied to (canonical_state, detector_version, feature_version) at compute time

---

## Part 4: Backfill Procedures

### 4.1 Leaf Feature Backfill (Simple)

**Command:** `node scripts/backfill-historical-features.js XAUUSD 1h --features=features_atr --start=2026-01-01 --end=2026-08-17`

**Flow:**
```
1. Fetch canonical candles: market.candles_1m_canonical for window
2. Roll up to 1h timeframe (TimescaleDB continuous aggregate)
3. Run ATR producer: compute from rolled-up candles
4. Persist rows: INSERT ... ON CONFLICT UPDATE (idempotent)
   └─ Rows tagged with detector_version=detector-v3
5. Mark complete: UPDATE feature_producer_runs SET status='done'
```

**Idempotency:**
- Primary key: (symbol, tf, ts)
- ON CONFLICT: overwrites stale rows (old detector version replaced)
- Safe to re-run (no data loss)

### 4.2 Derived Feature Backfill (Complex)

**Command:** `node scripts/backfill-historical-features.js XAUUSD 1h --features=features_zone --start=2026-01-01 --end=2026-08-17`

**Flow:**
```
1. Check dependencies: features_pivot, features_atr, features_htfBias, features_structure
2. If any dependency missing/stale:
   a. Auto-backfill dependencies first (recursive)
   b. Recompute upstream features
3. Fetch upstream feature rows: SELECT FROM features_pivot, features_atr, features_htf_bias, features_structure
4. Run zone producer: use upstream rows as input
5. Persist zone rows: INSERT ... ON CONFLICT UPDATE
   └─ Rows tagged with detector_version=detector-v3
6. Mark complete: UPDATE feature_producer_runs SET status='done'
```

**Cascade on Missing Upstream:**
```
zone depends on: pivot, atr, htfBias, structure
  structure depends on: pivot, atr, htfBias
    
If structure missing:
  1. Backfill pivot (leaf)
  2. Backfill atr (leaf)
  3. Backfill htfBias (leaf)
  4. Backfill structure (now inputs ready)
  5. Backfill zone (now ready)
```

**Recompute Deps Flag:**
```bash
node scripts/recompute-feature-recent.js XAUUSD features_zone --recompute-deps
```
- ⚠️ DANGEROUS: Rewrites upstream rows
- Use only if upstream producer corrupted data
- Requires: `--lookback >= 500` (full context)
- Guards against: Partial window rewrites that starve HTF context

### 4.3 Reconcile Direction State (Read-Only)

**Command:** `node scripts/reconcile-direction-state.js XAUUSD 1h`

**Flow (Read-Only, No Persist):**
```
1. Fetch features_bias rows for window
2. Fetch features_htf_bias rows for window
3. Run reconciliation logic: combine bias + htfBias → direction state
4. Compare with stored features_direction_state rows
5. Print: "100% reconciliation", OR "14 stale rows (producer not run)"
6. Exit 0 (no changes, audit only)
```

**Usage:** Verify upstream consistency before backfilling derived features

---

## Part 5: Feature Consumption in Backtest & Live

### 5.1 Backtest Feature Join Semantics

**File:** `packages/strategies/src/sqlBuilder.ts:200–300` (canonical joins)

**Pattern for state feature** (latest_as_of):
```sql
SELECT f.direction, f.confidence, f.detector_version
FROM features_bias f
WHERE f.symbol = anchor.symbol
  AND f.tf = anchor.tf
  AND f.ts <= anchor.ts          -- Latest as of anchor
ORDER BY f.ts DESC
LIMIT 1
```

**Pattern for event feature** (candidate_set):
```sql
SELECT f.id, f.event_type, f.ts, f.detector_version
FROM features_structure f
WHERE f.symbol = anchor.symbol
  AND f.tf = anchor.tf
  AND f.ts > (anchor.ts - lookback_interval)
  AND f.ts <= anchor.ts
ORDER BY f.ts DESC
```

**Pattern for lifecycle feature** (active_window):
```sql
SELECT f.zone_id, f.createdAt, f.invalidatedAt, f.detector_version
FROM features_zone f
WHERE f.symbol = anchor.symbol
  AND f.tf = anchor.tf
  AND f.createdAt <= anchor.ts    -- Zone created by anchor
  AND (f.invalidatedAt IS NULL OR f.invalidatedAt > anchor.ts)  -- Still valid
```

**Pattern for session-scoped feature** (session_scoped):
```sql
SELECT f.range_high, f.range_low, f.ts, f.detector_version
FROM features_opening_range f
WHERE f.symbol = anchor.symbol
  AND f.tf = anchor.tf
  AND f.session = 'NY'                    -- Spec declares session
  AND f.date = date_trunc('day', anchor.ts AT TIME ZONE 'UTC')
  AND f.ts <= anchor.ts
```

### 5.2 Live Feature Consumption

**File:** `apps/web/src/lib/pipelineTrigger.ts:200–300`

```typescript
async function evaluateAllStrategies(symbol: string, latestTs: Date) {
  // 1. Fetch latest features from canonical snapshot
  const features = await db.query(
    `SELECT * FROM features_bias WHERE symbol = $1 AND ts <= $2 
     UNION ALL
     SELECT * FROM features_structure WHERE symbol = $1 AND ts <= $2 AND ts > ($2 - INTERVAL '500 minutes')
     UNION ALL
     SELECT * FROM features_zone WHERE symbol = $1 AND ts <= $2 AND (invalidatedAt IS NULL OR invalidatedAt > $2)`,
    [symbol, latestTs]
  );
  
  // 2. Evaluate all active strategies
  for (const strategy of activeStrategies) {
    const signals = strategy.evaluate(features);
    
    // 3. Signals use features only (canonical by construction)
    if (signals.length > 0) {
      await persistSignals(signals);
    }
  }
}
```

**Safety Property:**
- Features come from canonical reads
- Canonical enforces fail-closed (unapproved suspects excluded)
- Signals safe by construction

---

## Part 6: Failure Modes & Recovery

### 6.1 What If: Upstream Feature Missing?

**Scenario:**
```
Backtest tries to compute zone features
But features_structure rows are missing (producer crashed)
```

**Result:**
```
zone producer runs:
  SELECT FROM features_structure WHERE ...
  → Returns 0 rows
  
zone.compute():
  if (structures.length === 0) {
    return { reason: 'insufficient_inputs', rows: [] }
  }
  
features_zone table:
  → 0 new rows inserted
  
backtest coverage:
  → Zone features unavailable for this window
  → Signals that depend on zones skip or degrade
```

**Recovery:**
```bash
node scripts/backfill-historical-features.js XAUUSD 1h \
  --features=features_structure --start=2026-01-01 --end=2026-08-17
node scripts/backfill-historical-features.js XAUUSD 1h \
  --features=features_zone --start=2026-01-01 --end=2026-08-17
```

### 6.2 What If: Detector Version Changes?

**Scenario:**
```
Live producer runs with detector-v3 (current)
Later governance approves v4-calibrated for deployment
Change env: TM_CANDLE_DETECTOR_VERSION=detector-v4
Re-run live producer
```

**Result:**
```
New feature rows tagged with detector-v4
Old rows tagged with detector-v3 remain in DB

Backtest selection:
  SELECT ... FROM features_bias WHERE detector_version = 'detector-v4'
  → Only v4 features used
  → Backtest results differ from v3 baseline (expected)
  
Old backtest results:
  → Tagged with detector_version='detector-v3'
  → Archived (not replayed)
  
New backtest results:
  → Tagged with detector_version='detector-v4'
  → Canary/validation phase before live deployment
```

### 6.3 What If: Quarantine Decision Changes After Features Generated?

**Scenario:**
```
2026-07-05 22:05 XAUUSD suspect: decision=NULL (unresolved)
Feature engine excluded this candle from bias/structure computation
Features appear "gappy" for that timestamp

Governance reviews, approves: decision='KEEP'
UPDATE candle_quarantine SET decision='KEEP', approved_at=now()
```

**Result:**
```
Canonical view now includes the candle (decision='KEEP' passes filter)

Old features:
  → Still "gappy" (computed when candle was excluded)
  
New features:
  → Can now include the candle if re-run
  
Backtest window affected:
  → Old results: gap at 22:05
  → New results: candle included (parity broken)
  
Solution: Re-backfill features after approval
  node scripts/backfill-historical-features.js XAUUSD 1h \
    --start=2026-07-05 --end=2026-07-06
```

---

## Part 7: Governance Guarantees

### 7.1 End-to-End Feature Safety Contract

**Guarantee:** No unapproved suspect data reaches signals.

**Proof Chain:**

1. ✅ **Canonical reads:** All features read from `market.candles_1m_canonical` only
2. ✅ **Canonical filtering:** Canonical view excludes unapproved suspects
3. ✅ **Feature lineage:** Derived features read upstream features (which used canonical)
4. ✅ **Detector tagging:** All rows tagged with detector version (immutable at persist)
5. ✅ **Signal consumption:** Signals use features only
6. ✅ **Backtest immutability:** PIT results tied to (canonical_state, detector_version, feature_version)

**Verification Checklist:**
- [ ] All leaf features read from `market.candles_1m_canonical` (audit producer code)
- [ ] No feature producer reads raw `candles_1m` (grep for table name)
- [ ] All feature rows have `detector_version` column (schema audit)
- [ ] All persists tag with detector_version (code review)
- [ ] Backtest queries use canonical table (code review)
- [ ] Signals use feature outputs only (grep for direct candle reads)

### 7.2 Backfill Atomicity & Immutability

**Guarantee:** Backfilled features are immutable and traceable.

**Properties:**
- Rows tagged with detector_version at persist time
- Idempotent (ON CONFLICT overwrites stale rows)
- Producer run recorded in `feature_producer_runs` (timestamp, status, row counts)
- Superseding (new detector version doesn't erase old rows; rows tagged with version)

---

## Part 8: Canonical Feature Audit Checklist

**For governance review:**

- [ ] **Leaf features:** All read from `market.candles_1m_canonical` only
- [ ] **Derived features:** All read upstream features (which used canonical)
- [ ] **No raw reads:** No producer reads `candles_1m` directly
- [ ] **Detector tagging:** All rows tagged with `detector_version`
- [ ] **Backfill idempotent:** ON CONFLICT overwrites stale rows
- [ ] **Backtest immutable:** PIT results tied to canonical state + detector version
- [ ] **Upstream consistency:** Direction state reconciles bias + htfBias correctly
- [ ] **Lifecycle tracking:** Zone/orderBlock lifecycle windows maintained correctly
- [ ] **Session semantics:** ORB/session range rows pinned to session timestamp
- [ ] **Fail-closed:** Missing upstream features → zero output (conservative)

---

## Conclusion

**Feature Lineage is Safe by Construction:**

```
Canonical Candles → Leaf Features → Derived Features → Signals/Backtest
(fail-closed)         (canonical)      (canonical)         (canonical)
    ✓                    ✓                 ✓                    ✓
```

All nodes read from canonical (directly or via upstream features). Unapproved suspects cannot leak downstream.

**Next Governance Review:** Accept this lineage map as authoritative? Any gaps or concerns?
