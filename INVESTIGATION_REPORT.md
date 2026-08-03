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

## 2026-07-27 VALIDATION UPDATE: FVG/DIRECTION REPAIR REACHED GATED PIT

### Changes validated

- Local bias now applies a score deadband (`10`) and weak-regime fallback, reducing forced bullish/bearish polarization.
- Direction reconciliation normalizes confidence to `[0, 1]` and combines local/HTF state through `features_direction_state`.
- Smart Risk DB family/variant now consumes `features_direction_state`, not direct `features_bias`.
- Compiler accepts both legacy `buy`/`sell` and canonical `bullish`/`bearish` values.
- iFVG `age_bars` predicates now resolve relative to causal anchor timestamp. Producer snapshot age is not treated as signal-anchor age.
- Direction-state reconciliation writes contract version `1.0.0`; prior `reconcile-readonly-1.0.0` metadata caused false `BLOCKED_VERSION` results.

### Producer and PIT evidence

15m repair completed with `282` bars and `0` errors. Requested cells reached `4/4 READY`: pricing `2.1.0`, zone `2.2.0`, iFVG `1.4.1`, order block `1.4.1`. Lifecycle refresh updated rows but required repeated convergence because lifecycle functions are batched.

Preflight initially remained blocked by stale state, producer edges, lifecycle state, and direction version. Rebuilding workspace contracts after reconciliation cleared stale compiled readiness logic. Final official preflight:

- XAUUSD, 90 days: `READY`
- Coverage includes direction state 15m, zone/order block/sweep 15m, pricing/iFVG/structure 5m, ATR 15m, and canonical candles.
- No preflight bypass used.

Official PIT run after preflight:

- `28` raw signals; `6` deduped
- `27` setup evaluations persisted/evaluated
- `22` skipped by volatility gate
- `0` executed trades
- Net R `0.00`; no profitability conclusion permitted

The zero-trade result is gate behavior, not profitability evidence. Long/short balance, expectancy, MAE/MFE, and rejection distribution require a valid executable sample or a wider verified data/parameter population. Keep strategy promotion blocked until those measurements exist.

### 2026-07-27 FVG/Bias Diagnostic Measurement Plan

**Status:** Approved for read-only research. No new bias engine, strategy filter, or
blocking threshold.

#### Objective

Measure whether existing higher-timeframe and directional-state context improves
FVG outcomes without changing live or PIT execution behavior.

#### Canonical architecture

```text
features_structure
  ↓
features_bias / features_htf_bias
  ↓
features_direction_state
  ↓
features_zone FVG metadata
  ↓
read-only diagnostic report
```

Existing feature contracts remain authoritative. Do not create a second
`marketStructure.ts` or independent BOS/CHoCH detector.

#### Execution order

1. Finish `features_zone` metadata backfill.
2. Verify persisted FVG metadata across symbols and timeframes.
3. Build standalone read-only extraction from `features_zone`.
4. Add causal backward-only joins to `features_htf_bias`, `features_bias`,
   `features_direction_state`, and `features_structure`.
5. Validate timestamp causality, identity uniqueness, timeframe mapping, and
   category totals.
6. Measure outcomes by diagnostic bias category.
7. Compare PIT baseline and diagnostic categories with identical run settings.
8. Consider strategy-specific filters only after multi-symbol and multi-window
   evidence survives validation.

#### Fixed HTF mapping

```text
1m  → 15m
5m  → 1h
15m → 1h
1h  → 4h
```

Every bias join must satisfy `feature.ts <= fvg.ts` and select latest prior row.
Future rows are invalid. Missing direction data is `no_bias_data`, not `neutral`.

#### Diagnostic output

```text
symbol, tf, fvg_ts, fvg_direction,
gap_atr_ratio, middle_body_ratio, middle_body_vs_average,
htf_direction, tactical_direction, direction_state,
structure_event, bias_category,
first_touch_at, mitigated_at, invalidated_at
```

Categories are descriptive only:

- `strong_alignment`
- `htf_aligned_itf_pullback`
- `conflict`
- `neutral`
- `no_bias_data`

No category blocks setups.

#### Validation gates

- Future bias/structure joins: `0`
- Duplicate persisted FVG identity: `0`
- Ambiguous HTF mapping: `0`
- Category totals equal FVG totals
- Lifecycle outcome fields remain causal
- Raw detector results stay separate from persisted quality-filtered zones

#### Measurement targets

Compare categories by formation count, touch/full-fill rate, mitigation and
invalidation rate, expectancy in `R`, MAE/MFE, time to event, execution count,
and rejection distribution. Do not optimize fill rate alone.

Do not add `requireHtfBias`, `minBiasScore`, conflict blocking, ADX/EMA canonical
bias, pair-specific rules, or `bias_category` to `ZoneOutput` until join semantics
and PIT results are proven.

### Fresh active-variant baseline sweep — 2026-07-26

Fresh sweep used `scripts/backtest-sweep-all.js --end=2026-07-26 --min-days=7 --max-warmup-hours=500`.

- Active variants loaded: `61`
- Compatible runs queued: `151`
- Completed `OK`: `121`
- Blocked: `2`
- Crashed: `28`
- Runs with trades: `91`
- Zero-trade runs: `30`

Results are screening evidence, not promotion evidence. Most windows are only 7 days and several rows have very small samples.

Notable results:

- `apex_scalp`: EURUSD `+12.27R` over `41` trades; NZDUSD `+18.99R` over `43`; USDCAD `+12.79R` over `38`; USDCHF `+10.17R` over `46`; USDJPY `+6.94R` over `32`. AUDUSD and GBPUSD were negative. This is pair dispersion, not proof of universal edge.
- `smart_risk_ob_ifvg_1m`: XAUUSD `+3.01R`, `71.4%` WR, `14` trades. Small sample; no promotion.
- `gold_mssnr_scalper_1m`: XAUUSD `-46.48R`, `72` trades, `26.4%` WR. Strong failure signal requiring setup/feature attribution.
- `scalper_20sma_1m`: four FX results were negative, from `-41.59R` to `-84.36R`; high signal volume did not create expectancy.
- `watukushay_no1`: all eight tested pairs were negative, despite variable win rates. This suggests payoff/entry/selection failure rather than directional count alone.
- `watukushay_fe`: many raw signals but `0` executed trades across tested pairs. This is an execution/gate compatibility failure until rejection reasons are exposed.

### Engine bugs exposed by sweep

### Watukushay FE funnel diagnosis — 2026-07-26

Strict PIT on GBPUSD (2026-07-20 through 2026-07-27) produced `143` raw
signals. Warmup removed `110`; `33` reached setup evaluation; all `33` were
graded `BLOCK`; no trade reached volatility or execution gates. The persisted
rows show confidence values `13–23`, not hard-rule failures. Earlier fast-mode
output (`13` candidates, all `volatility`) therefore described a different
pipeline stage and must not be mixed with strict results.

The setup engine already dispatches `signalSource: indicator` to indicator
rules, which have no zone-distance requirement. A stale/legacy cache row can
still carry an empty `block_reasons` array and generic `BLOCK` grade. PIT cache
version is now `1.0.2`; setup block logging includes confidence when no explicit
hard-rule reason exists. No volatility threshold was changed. Watukushay FE
remains unvalidated until paired strict runs on GBPUSD, EURUSD, and XAUUSD
produce persisted per-stage reasons and fresh readiness evidence.

### Watukushay FE grader repair

Strict zero-execution cause was setup-engine architecture mismatch. Indicator
signals were scored with zone-dependent entry and risk graders even though
Watukushay's contract is bias + RSI + displacement + authored ATR risk.
Missing SMC zones drove confidence below `C`, creating false setup blocks.

Repair:

- Indicator and trend-pullback families receive entry credit when signal
  predicates validate entry; zones remain optional.
- Risk grading uses ATR fallback and authored RR for non-zone families.
- Setup cache version is `1.0.3`.

Post-repair GBPUSD strict 7-day PIT:

- `143` raw, `110` warmup skipped, `33` setup evaluations.
- `0` setup blocks, `30` context duplicates.
- `3` unique candidates reached gates; all `3` rejected by volatility.
- `0` executions.

False setup rejection is removed. Volatility remains next investigation; no
threshold was relaxed without percentile/unit evidence.

Profiles were refreshed with `node scripts/compute-volatility-profile.js 60
5m,15m 5`, writing `115` current rows. The same strict GBPUSD run then showed
all `3` candidates rejected by the authored session gate:
`Session=ASIA not in allowed=[LONDON, OVERLAP, NY]`. Volatility rejected `0`.
This proves stale volatility calibration caused the prior attribution, but the
strategy's current zero-execution result is session policy, not ATR units.

### ASIA counterfactual — 2026-07-26

Added temporary PIT flag `--include-asia`; production YAML and DB policy remain
unchanged. Strict 7-day results after fresh volatility profiles:

| Symbol | Raw | Executed | Wins | Losses | Net R |
|---|---:|---:|---:|---:|---:|
| GBPUSD | 143 | 3 | 0 | 3 | -2.00 |
| EURUSD | 11 | 1 | 0 | 1 | -1.00 |
| XAUUSD | 22 | 0 | 0 | 0 | 0.00 |

ASIA was the only reason current GBPUSD candidates were rejected, but adding
ASIA produced exclusively losing trades in this short sample. This is evidence
against widening the live session policy, not proof of a durable ASIA edge or
failure. Keep ASIA disabled. Validate on a 30–90 day window before any policy
change.

Volatility profile inspection confirms unit parity: FX p95 ATR5 is roughly
`5.7–7.8` pips; XAUUSD p95 is roughly `104` pips. The gate converts ATR price
to symbol-registry pips before comparison, and percentile profiles are stored
in pips. No FX/XAU unit conversion bug is proven.

PIT gate output now preserves exact rejection text (`gate: reason`) instead of
only `volatility`, allowing direct distinction between ATR ceiling, missing
profile, and missing ATR data.

1. `a_plus_orb_fvg_5m` crashed on every symbol with PostgreSQL `42P01: missing FROM-clause entry for table "fvg_c1"`. The compiler referenced `fvg_c1` inside the FVG lateral before that alias existed. The first repair exposed a second schema bug: canonical candle tables have no `digits` column. Compiler now uses the canonical symbol-aware pip-size contract, matching `riskCompiler`. Retest no longer crashes; XAUUSD produced no signals.
2. `keylevel_bounce_v1_fx` crashed because its allowed symbols are `EURUSD, GBPUSD`, while sweep supplied XAUUSD. Sweep must honor variant symbol constraints and the backtester must report incompatible-symbol status instead of treating it as engine crash.
3. The sweep parser reports `UNKNOWN` for some child-process outcomes and collapses detailed rejection causes. This hides whether zero trades come from setup blocks, volatility, missing levels, time windows, or execution geometry. Failure attribution must be first-class output.
4. `--setup-profile=skip` appears in sweep logs for some variants while official validation uses strict setup evaluation. Baselines need explicit profile labeling and paired strict/fast comparisons; otherwise results are not comparable.

The corrected sweep completed with `93 OK`, `2 BLOCKED`, `2 INCOMPATIBLE_SYMBOL`, and no fatal/crash/unknown runs. The previous summary undercounted zero-trade runs because classified `NO_SIGNALS` and `NO_EXECUTIONS` rows were excluded from its zero-trade calculation; sweep summary logic now counts both classes.

### Trading-marking audit

Current chart markings are not yet proven equivalent to executable trades. A trader would require, for every candidate: causal bias/HTF state at anchor, zone/FVG formation and fill, structure event, entry trigger, stop, target, invalidation, and rejection reason. Stored producer rows alone are insufficient when lifecycle fields are later refreshed. PIT output must persist the exact anchor-time snapshot used by compiler and setup engine. Until that parity table exists, visual markings and backtest decisions remain unverified.

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

---

## FINDING 10: `bias_direction`→`resolved_direction` FIX — SIGNAL SOURCE DIRECTION OVERRIDE

**Date:** 2026-07-26  
**Scope:** Strategy compiler & risk compiler — ALL signal sources (zone, orb, indicator, moving_average, generic, fvg)  
**Impact:** Unblocks `<signal_source>="generic"` strategies where signal direction differs from bias direction (e.g., push-pull on neutral-bias days)

### Root cause

The strategy compiler uses `bias_direction` (daily bias from `features_bias`/`features_direction_state`) in 3 critical SQL locations:

1. **Zone/FVG direction filter** — the LATERAL join that picks the entry zone/FVG does `WHERE z.direction = CASE WHEN e.bias_direction = 'bullish' THEN 'bullish' ELSE 'bearish' END`. If bias is `'neutral'` or opposes the signal, zero zones match → signal dropped.

2. **Pricing filter** — `WHEN e.bias_direction = 'bullish' THEN p.position IN ('discount', 'deep_discount')`. Wrong direction → wrong pricing regime → no signal.

3. **Side CASE** — `WHEN e.bias_direction = 'bullish' THEN 'buy'`. Trade side determined by bias, not signal source.

4. **SL/TP geometry** (riskCompiler.ts) — Entry price, stop loss, and take profit CASE expressions all use `bias_direction` to pick high/low, top/bottom, ote_high/ote_low.

For `<signal_source>="generic"` strategies (e.g., sniper10r, `features_push_pull`), the signal direction comes from a non-bias setup condition (e.g., the push-pull pattern's own direction), not from daily bias. When daily bias is neutral but push-pull is bearish, the compiler picked no zone, wrong pricing, wrong side → signal dropped.

### The fix

**New column:** `resolved_direction` = `COALESCE(signal_direction, bias_direction)` projected in both `entry_signals` and `setup_candidates` CTEs.

- `signal_direction` comes from the first non-bias setup condition whose feature has a direction column (e.g., `features_push_pull.direction`, `features_zone.direction`)
- `bias_direction` remains as raw daily bias (preserved for strategy constraint WHERE filters)
- `resolved_direction` is the override chain: signal wins if present, else bias

**SQL locations swapped:**

| Location | Before | After |
|----------|--------|-------|
| Zone LATERAL direction filter | `CASE WHEN e.bias_direction = 'bullish'` | `CASE WHEN e.resolved_direction = 'bullish'` |
| Zone LATERAL ORDER BY | `CASE WHEN e.bias_direction = 'bullish'` | `CASE WHEN e.resolved_direction = 'bullish'` |
| FVG LATERAL direction filter | `CASE WHEN e.bias_direction = 'bullish'` | `CASE WHEN e.resolved_direction = 'bullish'` |
| Structure EXISTS direction filter | `CASE WHEN e.bias_direction = 'bullish'` | `CASE WHEN e.resolved_direction = 'bullish'` |
| Pricing filter (discount/premium) | `WHEN e.bias_direction = 'bullish'` | `WHEN e.resolved_direction = 'bullish'` |
| Side CASE (all signal SELECTs) | `WHEN e.bias_direction = 'bullish' THEN 'buy'` | `WHEN e.resolved_direction = 'bullish' THEN 'buy'` |
| riskCompiler.ts entry price (indicator) | `WHEN a.bias_direction = 'bullish' THEN p.ote_low` | `WHEN a.resolved_direction = 'bullish' THEN p.ote_low` |
| riskCompiler.ts entry price (orb) | `WHEN a.bias_direction = 'bullish' THEN o.high` | `WHEN a.resolved_direction = 'bullish' THEN o.high` |
| riskCompiler.ts entry price (zone default) | `WHEN a.bias_direction = 'bullish' THEN z.bottom` | `WHEN a.resolved_direction = 'bullish' THEN z.bottom` |
| riskCompiler.ts SL min-sl clamp | `WHEN a.bias_direction = 'bullish' THEN LEAST(...)` | `WHEN a.resolved_direction = 'bullish' THEN LEAST(...)` |
| riskCompiler.ts SL after-sweep | `WHEN a.bias_direction = 'bullish' THEN (entry) - (raw)` | `WHEN a.resolved_direction = 'bullish' THEN (entry) - (raw)` |
| riskCompiler.ts TP fallback | `WHEN a.bias_direction = 'bullish' THEN (entry) + (distance)*ratio` | `WHEN a.resolved_direction = 'bullish' THEN (entry) + (distance)*ratio` |
| riskCompiler.ts TP beyond-minRR | `WHEN a.bias_direction = 'bullish' AND (level) >= (entry) + (dist)*minRR` | `WHEN a.resolved_direction = 'bullish' AND (level) >= (entry) + (dist)*minRR` |
| riskCompiler.ts offset | `WHEN a.bias_direction = 'bullish' THEN (raw) + (offsetPips * pipSql)` | `WHEN a.resolved_direction = 'bullish' THEN (raw) + (offsetPips * pipSql)` |
| riskCompiler.ts fvg_c1_stop | `CASE WHEN a.bias_direction = 'bullish' THEN fvg_c1.l` | `CASE WHEN a.resolved_direction = 'bullish' THEN fvg_c1.l` |
| riskCompiler.ts COALESCE(signal_direction, bias_direction) patterns (5 locations) | `COALESCE(a.signal_direction, a.bias_direction)` | `a.resolved_direction` (simplified) |

**Keep on `bias_direction`** (strategy constraint filters, not geometry):
- `WHERE e.bias_direction IN ('bullish', 'bearish')` — still gates on raw bias, so neutral days can enter with signal override but bias must be non-null
- `WHERE e.bias_direction IS NOT NULL` — generic signal guard
- `(e.bias_direction = 'bullish' AND fast_ma.value > slow_ma.value)` — MA crossover constraint
- `e.bias_direction` as a projected column — kept for debugging/audit

**Files changed:**
- `packages/strategies/src/compiler.ts` — entry_signals CTE `resolved_direction`, setup_candidates CTE, all signal SELECT builders, biasDirectionExpr normalization for direction_state buy/sell→bullish/bearish
- `packages/strategies/src/riskCompiler.ts` — 32+ locations swapped to `resolved_direction`

**Edge case handled:**
`features_direction_state` stores direction as `'buy'`/`'sell'`. The `biasDirectionExpr` normalizes to `'bullish'`/`'bearish'` before COALESCE into `resolved_direction`, so the column is always bullish/bearish regardless of bias source.

### Before vs after example

**Sniper10r strategy (`<signal_source>="generic"`, `features_push_pull` setup):**

Push-pull produces `direction='bearish'` (signal_direction). Daily bias is `'neutral'`.

**Before (broken):**
```sql
-- Zone filter — bias is 'neutral', so CASE returns 'bearish' anyway → might match
-- BUT: pricing filter evaluates:
CASE WHEN 'neutral' = 'bullish' THEN ... WHEN 'neutral' = 'bearish' THEN ... END
-- → NULL → no pricing row → signal dropped

-- Side evaluates:
WHEN 'neutral' = 'bullish' THEN 'buy' WHEN 'neutral' = 'bearish' THEN 'sell' ELSE NULL
-- → NULL → no trade side → signal dropped

-- All risk geometry:
WHEN 'neutral' = 'bullish' THEN z.bottom WHEN 'neutral' = 'bearish' THEN z.top
-- → dependent on side
```

**After (fixed):**
```sql
-- resolved_direction = COALESCE('bearish', 'neutral') = 'bearish'

-- Zone filter:
CASE WHEN 'bearish' = 'bullish' THEN 'bullish' ELSE 'bearish' END
-- → 'bearish' → zones match → zone found

-- Pricing filter:
WHEN 'bearish' = 'bullish' THEN ... WHEN 'bearish' = 'bearish' THEN p.position IN ('premium', 'deep_premium')
-- → pricing row matched

-- Side:
WHEN 'bearish' = 'bullish' THEN 'buy' WHEN 'bearish' = 'bearish' THEN 'sell'
-- → 'sell' → valid side

-- Risk geometry:
WHEN 'bearish' = 'bullish' THEN z.bottom WHEN 'bearish' = 'bearish' THEN z.top
-- → z.top → correct entry price for short
```

### Implementation notes

- `resolved_direction` is computed once in the CTE, then referenced in 5+ signal SELECTs and 30+ risk geometry locations — single source of truth
- No new DB migrations — pure SQL generation change
- All 160 existing tests pass unchanged
- The progressive compiler (DAG v2) also projects `resolved_direction` with proper COALESCE for signal source direction override
- Direction_state normalization (`buy`→`bullish`) is correctly applied before COALESCE into `resolved_direction`

### What could still go wrong

1. **Features whose direction column uses different naming** — `features_direction_state` uses buy/sell; the normalization handles that. Other features (zone, push_pull) use bullish/bearish. If a new feature uses buy/sell in its direction column, `setup_candidates` COALESCE would produce buy/sell mixed into `resolved_direction`, breaking side CASE. **Fix:** Add buy/sell→bullish/bearish normalization around COALESCE in setupSection if needed.

2. **Multiple entry conditions with different direction values** — currently the first non-bias condition with direction wins. If two entry conditions disagree, the first one's direction overrides. The cascade is deterministic (condition list order). If this causes issues, change to `mode()` or explicit precedence.

3. **`signal_direction` is NULL for non-generic signal sources** — `NULL::text as signal_direction` is projected for zone/orb/indicator/fvg/ma sources, so `resolved_direction` = `COALESCE(NULL, bias_direction)` = bias_direction. Zero behavioral change for existing strategies.

### Test results

```
Test Files  16 passed (16)
Tests  160 passed (160)
```
