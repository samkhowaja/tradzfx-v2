# ALL-PAIRS DEEP INVESTIGATION — COMPLETE REPORT

**Date:** 2026-07-17  
**Scope:** All 10 symbols (XAUUSD, EURUSD, GBPUSD, USDJPY, AUDUSD, NZDUSD, USDCAD, USDCHF, USDSEK, DXY)  
**Coverage:** All 27+ feature tables, all TF, first candle to last, broker sources, cagg policies, pipeline config, active strategy variants

---

## FINDING 1: BROKER PROLIFERATION — 6 SOURCES IN candles_1m (was 3)

**AGENTS.md lists 3 brokers:** `"1x Trade Ltd."`, `"MT5"`, `"smoke-test"`

**Actual:** 6 brokers in `candles_1m`:

| Broker | Rows | Date Range | Symbols |
|--------|------|-----------|---------|
| 1x Trade Ltd. | 1,084,681 | Apr 7 – Jul 17 | ALL |
| MT5 | 177,165 | Feb 2 – Jul 7 | ALL |
| OANDA Corporation | 91,540 | Apr 16 – Jul 17 | 8 FX (no XAUUSD/DXY) |
| synthetic | 12,011 | Jul 7 – Jul 17 | DXY only |
| smoke-test | 18 | Jul 7 | test |
| test | 3 | Jul 2024 | test |

**Impact:** Continuous aggregates GROUP BY `broker`. OANDA's 91,540 rows create SEPARATE cagg buckets alongside 1x Trade for the same timestamps. This:
- Doubles/duplicates HTF candle rows in 5m/15m/1h/4h/1d caggs
- Inflates `tick_count` (each broker counted separately)
- Creates phantom OHLCV sets

**Root cause:** OANDA data was added (probably for more recent FX ticks) without removing the old `MT5` broker or deduplicating against `1x Trade`. `MT5` stopped at Jul 7 (outage dead). `1x Trade` and `OANDA` both stream live now.

---

## FINDING 2: EVENT FEATURES GLOBALLY DEAD (OB, iFVG, fvg_backup, liquidity_pools, eq_liquidity)

**Confirmation:** Feature engine stopped producing these after Jul 15 07:39 UTC.

| Feature | Last ENGINE Run | Rows Inserted | Current Status |
|---------|----------------|---------------|----------------|
| features_order_block | Jul 15 07:39 | 9,107 total | ENGINE DEAD (lifecycle runs continue, 0 new rows) |
| features_ifvg | Jul 15 07:39 | 126,886 total | ENGINE DEAD (lifecycle runs continue, 0 new rows) |
| features_fvg_backup | NEVER in producer_runs | N/A | COMPLETELY DEAD (last data Jul 9) |
| features_liquidity_pools | Jul 15 07:39 | last rows Jul 15 | ENGINE DEAD |
| features_eq_liquidity | Jul 15 07:39 | last rows Jul 13 | ENGINE DEAD |

**Per-symbol last data dates:**
- `features_order_block`: AUDUSD Jul 8, DXY Jul 10, EURUSD Jul 13, GBPUSD Jul 13, NZDUSD Jul 7, USDCAD Jul 7, USDCHF Jul 7, USDJPY Jul 8, USDSEK Jul 8, XAUUSD Jul 14
- `features_fvg_backup`: ALL symbols Jul 9 (dead 8 days)
- `features_eq_liquidity`: most symbols Jul 8-10

**Root cause:**
1. `pipelineTrigger.ts` runs the engine with `skipLifecycle: true` — event features (OB/iFVG) DEPEND on lifecycle to mark zones invalidated before creating new ones.
2. The scheduled `refresh-lifecycle.js` (PM2, 6h) only refreshes lifecycle metadata — it does NOT run the feature engine to produce new OB/iFVG rows.
3. After Jul 6-7 outage → recovery, the engine resumed for standard features (bias/atr/structure pricing) but event features starved because their zone/lifecycle dependencies were stale.
4. After Jul 15, the engine run produced 0 rows for OB/iFVG → DAG runner probably stopped requesting them.

**Lifecycle refresh state IS fresh** (Jul 17 04:43 UTC) — lifecycle maintains metadata but doesn't CREATE new event features.

---

## FINDING 3: features_fvg — DEAD EMPTY TABLE (0 rows)

**features_fvg** exists in schema, has correct columns (symbol, tf, ts, direction, top, bottom, age_bars, is_fresh), but **0 rows**.

**features_ifvg** is the replacement (128k engine runs, actively maintained until Jul 15).

**features_fvg_backup** is an orphan — same schema as ifvg, never in producer_runs, last data Jul 9.

**DUPLICATE DETECTED:** Three tables for same concept (FVG/iFVG). Only `features_ifvg` is supposed to be active. `features_fvg` and `features_fvg_backup` are dead weight.

---

## FINDING 4: features_zone_clean — LARGE BUT STALE

**44,048 rows** vs `features_zone` **716,246 rows**. 
- zone_clean has enriched columns (outcome, touch_count, retest_count, quality_score, rank_score)
- Last data: Jul 14 (3 days stale)
- NOT a duplicate of features_zone (different, richer schema)
- But NOT being maintained by current pipeline

**Verdict:** Enriched zone table is orphaned from the live pipeline. It's a post-processing output that needs separate maintenance.

---

## FINDING 5: direction_state ONLY ON 2 SYMBOLS

| Symbol | Rows | Coverage |
|--------|------|----------|
| XAUUSD | 15m/1h/5m fresh | Active |
| EURUSD | All TFs 0–Jun 14 | Active |
| GBPUSD | NONE | MISSING |
| AUDUSD | NONE | MISSING |
| NZDUSD | NONE | MISSING |
| USDCAD | NONE | MISSING |
| USDCHF | NONE | MISSING |
| USDJPY | NONE | MISSING |
| USDSEK | NONE | MISSING |
| DXY | NONE | MISSING |

**8 symbols missing direction_state.** The reconcilation script (`reconcile-direction-state.js`) was only run for XAUUSD and EURUSD.

---

## FINDING 6: HTF BIAS (4h/1d) STALE ON ALL SYMBOLS

| TF | Last Data | Staleness |
|----|-----------|-----------|
| 4h bias | Jul 8 (XAUUSD) – Jul 15 (EURUSD) | 2-9 days |
| 1d bias | Jul 14 ALL symbols | 3 days |
| 4h/1d structure | Jul 7-8 | 9-10 days |

Cagg refresh policies are healthy (5m/15m/1h/4h/1d all refresh automatically). But the FEATURE engine needs to recompute HTF features when new HTF candles are available. The pipeline only computes features needed by active strategy specs — if no spec requires `4h` or `1d` features, they won't be computed.

**Root cause:** HTF features only compute when a strategy spec explicitly requires them OR via backfill. After the Jul 6-7 outage, the engine resumed compute for TFs needed by live strategies (1m/5m/15m/1h) but not 4h/1d.

---

## FINDING 7: CANDLE GAPS — LARGE INITIAL GAPS, SMALL RECENT GAPS

| Symbol | Max Gap | Details |
|--------|---------|---------|
| XAUUSD | 3d 1h | Jul 6-7 outage (REPAIRED) |
| EURUSD | 575d | Feb 2022 → 2026 initial gap (pre-data) |
| GBPUSD | 626d | Pre-data |
| USDJPY | 625d | Pre-data |
| Other FX | ~3d | Initial gaps + normal weekend |

**Real gaps (post-data):** Only the Jul 6-7 outage for XAUUSD. Other gaps are pre-data (MT5 initial export) or normal weekend.

**Cagg refresh policies:** ALL healthy. No missing refreshes.

---

## FINDING 8: PRODUCER RUNS HEALTH — ALL 10 SYMBOLS COMPUTING (FOR STANDARD FEATURES)

**Last hour:** All 10 symbols actively producing features. XAUUSD has 21 features (19012 runs) vs FX symbols 14 features (135-140 runs). The difference is 7 extra XAUUSD-only features needed by XAUUSD-specific strategy variants.

**Features running for ALL 10 symbols:** atr, bias, bollinger, candle_pattern, displacement, htf_bias, indicator, keltner, moving_average, opening_range, pivot, pricing, session, session_hl, spread, structure, zone, zone_retest

**Features ONLY on XAUUSD:** sweep, correlation, time_of_day_edge — needed by gold-specific variants.

---

## FINDING 9: ORPHAN/DUPLICATE TABLES SUMMARY

| Table | Status | Action |
|-------|--------|--------|
| features_fvg | DEAD (0 rows) | DROP or archive |
| features_fvg_backup | DEAD (never in producer_runs) | Same as features_ifvg — DROP |
| features_zone_clean | ORPHANED (last Jul 14) | Not duplicate but needs maintenance plan |
| candles_1d_utc | INTENTIONAL (SK-11) | Keep |
| candles_1d_ny | INTENTIONAL (SK-11) | Keep |

---

## SOLUTIONS

### S1: Remove duplicate brokers from candles_1m

**Problem:** OANDA (91k rows) duplicates 1x Trade data, polluting caggs with broker-grouped buckets. MT5 (177k rows) stopped Jul 7.

**Fix:**
```sql
-- Remove OANDA data (1x Trade is primary source)
DELETE FROM candles_1m WHERE broker = 'OANDA Corporation';
-- Optionally remove stale MT5 data
DELETE FROM candles_1m WHERE broker = 'MT5';
```

**Permanent solution:** Restrict ingestion to 1x Trade only. Block new brokers in ingestion-server.js:
```javascript
const ALLOWED_BROKERS = new Set(['1x Trade Ltd.', 'smoke-test']);
if (!ALLOWED_BROKERS.has(broker)) { return 400; }
```

**Verify:** `SELECT broker, count(*) FROM candles_1m GROUP BY broker;`

---

### S2: Restart event features (OB, iFVG, liquidity_pools, eq_liquidity)

**Problem:** Engine stopped producing event features Jul 15. Lifecycle maintenance runs but creates 0 new rows.

**Fix — Step 1: Backfill event features for all symbols:**
```bash
# Backfill OB for all symbols (look back 7 days to recover from Jul 15 stall)
node scripts/backfill-historical-features.js EURUSD,GBPUSD,AUDUSD,NZDUSD,USDCAD,USDCHF,USDJPY,USDSEK,XAUUSD 5m,15m,1h --features=features_order_block,features_ifvg

# Backfill liquidity_pools
node scripts/backfill-historical-features.js EURUSD,GBPUSD,AUDUSD 15m,1h --features=features_liquidity_pools

# Backfill eq_liquidity  
node scripts/backfill-historical-features.js EURUSD,GBPUSD,AUDUSD 15m,1h --features=features_eq_liquidity
```

**Fix — Step 2: Fix pipeline trigger to NOT skip lifecycle for event features:**
In `apps/web/src/lib/pipelineTrigger.ts`, change `runFeatureEngine()` to include lifecycle for event features:

```typescript
// Current (broken): skipLifecycle: true for ALL features
await runner.run({
  symbol, tf, endTs,
  requestedFeatures: features,
  skipLifecycle: true,  // <-- BROKEN: OB/iFVG need lifecycle
});

// Fix: Run lifecycle for event features separately
const eventFeatures = features.filter(f => 
  ['features_order_block', 'features_ifvg', 'features_liquidity_pools', 
   'features_eq_liquidity'].includes(f)
);
const standardFeatures = features.filter(f => 
  !eventFeatures.includes(f)
);

if (standardFeatures.length > 0) {
  await runner.run({ symbol, tf, endTs, requestedFeatures: standardFeatures, skipLifecycle: true });
}
if (eventFeatures.length > 0) {
  await runner.run({ symbol, tf, endTs, requestedFeatures: eventFeatures, skipLifecycle: false });
}
```

**Fix — Step 3: Add OB/iFVG lifecycle nudge to pipeline trigger's Phase 0b:**
The existing 25s `Promise.race` lifecycle nudge already runs `updateLifecycleForSymbol`. Ensure it includes OB/iFVG zones by passing the correct lookback.

---

### S3: Remove dead FVG tables

**Problem:** `features_fvg` (0 rows) + `features_fvg_backup` (dead Jul 9, never in producer_runs) duplicate `features_ifvg`.

**Fix:**
```sql
-- Drop dead tables (backup first!)
DROP TABLE IF EXISTS features_fvg;
DROP TABLE IF EXISTS features_fvg_backup;
```

**Verify:** No code references these tables:
```bash
grep -r "features_fvg[^_]" packages/ apps/ --include="*.ts" --include="*.sql"
```

---

### S4: Backfill direction_state for all 8 missing symbols

**Problem:** Only XAUUSD + EURUSD have direction_state.

**Fix:**
```bash
# Run reconciliation for all missing symbols
node scripts/reconcile-direction-state.js GBPUSD 1h
node scripts/reconcile-direction-state.js AUDUSD 1h
node scripts/reconcile-direction-state.js NZDUSD 1h
node scripts/reconcile-direction-state.js USDCAD 1h
node scripts/reconcile-direction-state.js USDCHF 1h
node scripts/reconcile-direction-state.js USDJPY 1h
node scripts/reconcile-direction-state.js USDSEK 1h
node scripts/reconcile-direction-state.js DXY 1h
```

**Permanent solution:** Add direction_state to the pipeline trigger's `collectRequiredFeatureRuns()` if any active spec references it, OR add a scheduled job.

---

### S5: Refresh HTF bias (4h/1d) for all symbols

**Problem:** 4h bias stale (XAUUSD Jul 8, others Jul 14), 1d bias stale (Jul 14 all).

**Fix:**
```bash
# Backfill 4h bias for all symbols
node scripts/backfill-historical-features.js EURUSD,GBPUSD,AUDUSD,NZDUSD,USDCAD,USDCHF,USDJPY,USDSEK,XAUUSD 4h,1d --features=features_bias

# Also backfill 4h/1d structure and htf_bias
node scripts/backfill-historical-features.js EURUSD,GBPUSD,AUDUSD,NZDUSD,USDCAD,USDCHF,USDJPY,USDSEK,XAUUSD 4h,1d --features=features_structure,features_htf_bias
```

---

### S6: Add periodic full-feature recompute for event features

**Problem:** Event features (OB, iFVG) only compute when lifecycle runs, but lifecycle doesn't run the feature engine.

**Fix — New PM2 job:** Create a script that runs the feature engine for event features on a 30min schedule:
```bash
# Create scripts/recompute-event-features.js
# Runs: features_order_block, features_ifvg for all symbols on all TFs
# Schedule: PM2 with cron */30 * * * *
```

**Fix — Or add to refresh-lifecycle.js:** Modify `refresh-lifecycle.js` to trigger the feature engine for OB/ifvg after lifecycle maintenance completes:
```javascript
// After lifecycle refresh, run feature engine for event features
const runner = new DAGRunner(pool, globalDAG);
await runner.run({
  symbol, tf: '5m', endTs: new Date(),
  requestedFeatures: ['features_order_block', 'features_ifvg'],
  skipLifecycle: false,  // Need lifecycle for OB/ifvg
  lookbackBars: 500,
});
```

---

### S7: Zone_clean maintenance plan

**Problem:** `features_zone_clean` (enriched zones) hasn't been updated since Jul 14.

**Fix:** Either:
1. Add zone_clean to the backfill scripts
2. Or drop it if no active strategy uses it
3. Or add a post-processing step in the zone feature module to write zone_clean

**Check usage:**
```bash
grep -r "features_zone_clean" packages/ apps/ scripts/
```

---

### S8: Add cagg refresh health check to monitoring

**Problem:** Cagg policies exist but nobody verifies they're running.

**Fix — Add to monitor-v2-health.ps1:**
```powershell
# Check cagg freshness
$caggCheck = psql -t -c "SELECT view_name, 
  (CURRENT_TIMESTAMP - last_refresh)::interval as since_refresh
FROM timescaledb_information.continuous_aggregates 
  JOIN timescaledb_information.jobs ON ..."
if ($caggCheck -match "> 2 days") { Alert }
```

---

### S9: Block 0-row producer runs from masking as healthy

**Problem:** OB/ifvg engine runs produce 0 rows with `status='done'` — looks healthy but does nothing.

**Fix — In `computePersistOutcome()` (SK-62 was fixed but 0-row check missing):**
```typescript
// In DAGRunner, after run completes:
if (rowsInserted === 0 && rowsAttempted > 0) {
  // Warning: feature produced 0 rows — might indicate stale dependencies
  recordProducerRun({ ...status: 'warn_zero_rows' });
}
```

---

## EXECUTION PRIORITY

```
P0: S1 (Remove OANDA dupe broker) → S2 (Restart event features) → S4 (direction_state)
P1: S5 (HTF bias refresh) → S8 (monitoring)
P2: S3 (Drop dead FVG tables) → S6 (Periodic event feature job) → S7 (zone_clean)
P3: S9 (0-row detection)
```

## VERIFICATION QUERIES

After each fix, run:

```sql
-- 1. Which features are producing data today?
SELECT feature_table, count(*) as engine_runs, 
  sum(rows_inserted) as rows, max(started_at)::text as last
FROM feature_producer_runs 
WHERE tf IS NOT NULL AND started_at > NOW() - interval '1 hour'
GROUP BY feature_table ORDER BY feature_table;

-- 2. Which symbols are computing?
SELECT symbol, count(DISTINCT feature_table) as features
FROM feature_producer_runs 
WHERE tf IS NOT NULL AND started_at > NOW() - interval '1 hour'
GROUP BY symbol ORDER BY symbol;

-- 3. Event feature data freshness
SELECT 'features_order_block' as tbl, symbol, max(ts)::text as last_data
FROM features_order_block GROUP BY symbol ORDER BY symbol;

-- 4. Broker sanity check
SELECT broker, count(*) FROM candles_1m GROUP BY broker;

-- 5. Direction_state coverage
SELECT symbol, count(*) FROM features_direction_state GROUP BY symbol;
```
