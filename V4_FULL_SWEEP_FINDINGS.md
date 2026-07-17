# V4 Full Strategy Sweep — Systemic Architecture Findings

**Date:** 2026-07-11  
**Scope:** 34 strategy variants on XAUUSD (and EURUSD where symbol-restricted), 90-day window (2026-04-12 → 2026-07-11)  
**Runner:** `scripts/backtest-pit-v2.js` (PIT backtester, `--mode=full` default)  
**DB:** `tradzfx_v2` on localhost:5432 (TM_DB_PASSWORD auth)  
**Goal:** Identify root-cause architecture/data issues that invalidate backtest results — NOT strategy optimization

---

## Executive Summary

| Category | Count | Details |
|----------|-------|---------|
| **Strategies Tested** | 34 | 32 on XAUUSD, 2 on EURUSD (symbol-restricted) |
| **Executed ≥1 Trade** | 7 | `watukushay_no1` (2), `doyle_sd` (4), `smart_risk_ob_ifvg_1m` (2), `lewis_kelly_smc_ny_shorts` (1), `waqar_v2` (10), `orb_classic` (0 — was 35 in prior run, now 0), `forex_strategy_orb` (0) |
| **Zero Executions** | 24 | 21 due to setup-engine BLOCK, 2 due to warmup skip, 1 DB timeout |
| **BLOCKED_SYSTEM_QUALITY** | 2 | `keylevel_bounce_v2` (missing zone_retest@1m), `scarface_5m_orb` (missing candle_pattern@1m, pricing@1m) |
| **DEGRADED Quality** | 3 | `waqar_v2` (sparse displacement@1m), `sniper_10r_fx` (sparse sweep@15m), `xauusd_v1` (READY but 0 exec) |
| **DB Timeout (57014)** | 1 | `a_plus_orb_fvg_5m` — query on 2.3M zone rows |

**Critical Finding:** The **setup-engine is blocking 85-99% of signals** across nearly all strategies with two repetitive reasons:
1. `"All nearby zones have already been tapped"` 
2. `"No entry zone within 1.5 ATR of current price"`

This is a **skeleton/architecture bug**, not a strategy issue. The zone freshness/tap logic in `evaluateSetupBatch()` is likely misconfigured or the feature data is stale.

## Codex Verification Addendum - 2026-07-11

I reran the key V4 claims against the local DB and PIT runner. The broad V4 conclusion is confirmed: the system is still failing at the architecture/data-contract layer before strategy edge can be measured. The most critical new finding is worse than a low win rate: one ORB path can generate trades from stale opening-range rows, while the registry/compiler path correctly produces zero setup rows.

### Verification Commands Run

```powershell
node scripts/audit-feature-contracts.js
$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/check-feature-freshness.js XAUUSD
node scripts/check-candle-coverage.js XAUUSD 90 '1m,5m,15m,1h,4h,1d'
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research
$env:PIT_USE_COMPILER_SQL='1'; node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research --debug
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 watukushay_no1 --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v1 --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v2 --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 scarface_5m_orb --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 a_plus_orb_fvg_5m --json --mode=full
node scripts/backtest-pit-v2.js ALL 90 waqar_v2 --json --mode=full
```

### Verified Claims

| Claim | Rerun Result | Status |
|---|---:|---|
| Setup engine dominates full-mode outcomes | `orb_classic`: 36 raw, 35 setup-blocked, 0 executed. `doyle_sd`: 71 raw, 62 setup-blocked, 4 executed. `waqar_v2` ALL: 1,610 raw, 1,505 setup-blocked, 60 executed. | Confirmed |
| Missing 1m feature surfaces block strategies | `keylevel_bounce_v2` blocked by `features_zone_retest@1m=0`; `scarface_5m_orb` blocked by `features_candle_pattern@1m=0`, `features_pricing@1m=0`; `features_displacement@1m` also 0/warning. | Confirmed |
| Warmup gate kills low-sample keylevel variants | `keylevel_bounce_v1`: 1 raw signal, 1 warmup skip, 0 executed. | Confirmed |
| `a_plus_orb_fvg_5m` times out | PostgreSQL `57014 canceling statement due to statement timeout`. | Confirmed |
| Zone table explosion | `features_zone` estimated live rows: 24,613,707. XAUUSD `features_zone@5m`: 2,312,421 rows in 90d. | Confirmed |
| Freshness is unsafe | Freshness probe after loading `.env.local`: FRESH 0, STALE 134, EMPTY 28 for XAUUSD surfaces. XAUUSD `features_atr@1m` latest 2026-07-03 14:52 UTC; `features_spread@1m` only 286 rows in 90d. | Confirmed |

### New Critical BUG-11: ORB Uses Stale Opening Range Rows

**Severity:** P0 - invalidates ORB backtest signal counts and any claimed ORB win rate until fixed.

**Evidence:**

- Default legacy PIT, research mode: `orb_classic` produced 36 raw signals and 35 executed trades, 54.3% WR, +22R.
- Compiler PIT with `PIT_USE_COMPILER_SQL=1`, same symbol/window/mode: 0 raw signals.
- Compiler debug: `bias_rows=455`, `setup_rows=0`, `entry_rows=0`.
- DB proof for XAUUSD 15m opening-range joins during the ORB signal window:
  - 455 ORB bias candidates.
  - 0 candidates had an opening-range row within 15 minutes.
  - 364 candidates had a prior opening-range row within 24h.
  - 91 candidates used an opening-range row older than 1 day if the join allows generic latest-as-of.
  - Median opening-range age at signal time was about 465 minutes; max was about 4,200 minutes.

**Root Cause:**

`scripts/backtest-pit-v2.js` legacy ORB SQL joins `features_opening_range` with:

```sql
o.ts = (
  SELECT MAX(ts)
  FROM features_opening_range
  WHERE symbol = e.symbol
    AND tf = '<orbTf>'
    AND ts <= e.ts
)
```

That is a generic latest-as-of state join. Opening range is not a generic state. It is a session-scoped market object with a start time, completion time, session date, and valid window. The current join can use stale ranges from earlier sessions or prior days. The compiler path is stricter through the registry and finds zero setup rows, which exposes the leak.

**Long-Term Fix:**

1. Reclassify `features_opening_range` from generic `latest_as_of` state to `session_scoped_event` or `session_state`.
2. Add/openly enforce columns: `session_date`, `session_name`, `range_start_ts`, `range_end_ts`, `valid_from_ts`, `valid_until_ts`, `range_minutes`, `source_tf`, `producer_version`.
3. Normalize session labels across tables (`NY` vs `ny`, `LONDON` vs `london`) using the DB contract map.
4. ORB joins must require same `symbol`, `tf`, `session_name`, `session_date`, and `valid_from_ts <= signal_ts < valid_until_ts`.
5. ORB strategy windows must start after the opening range is complete. If the range is 15 minutes, entries cannot evaluate before `range_end_ts`.
6. Add a parity test: legacy/default PIT and compiler PIT must produce the same ORB candidates before either path is allowed for promotion.

### New Critical BUG-12: `dataQuality = READY` Is Failing Open

**Severity:** P0 - the backtester can call a result READY even when required feature state is stale, sparse, or semantically invalid.

**Evidence:**

- `orb_classic`, `doyle_sd`, and `watukushay_no1` run with `dataQuality: READY` even while producer/freshness checks show stale ATR, sparse spread, stale producer watermarks, and ORB opening-range semantic leakage.
- `check-candle-coverage.js XAUUSD 90 '1m,5m,15m,1h,4h,1d'` reports OK despite ratios around 119-125% and 5m gaps. A ratio above 100% is not automatically healthy; it means expected-bar math, market calendar assumptions, duplicate/extra bars, or broker-session handling need reconciliation.
- Producer ledger examples showed many XAUUSD feature producers last finished hundreds to thousands of minutes ago. This should be a blocking condition for dense/state features in research/promotion mode.

**Long-Term Fix:**

1. Replace row-count-only readiness with shared `runSystemHealthCheck()` used by live analysis, PIT backtest, and promotion.
2. Health gate must combine candle coverage, gap count, ratio lower/upper bounds, producer SLA, feature semantic type, feature density expectations, and DB contract-map names.
3. Dense/state features (`atr`, `spread`, `session`, `pricing`, `direction_state`) must block when stale or sparse.
4. Sparse event features (`ifvg`, `sweep`, `order_block`) should not require density, but if a strategy explicitly depends on them, the strategy must report whether zero events is real market absence or missing producer coverage.
5. `dataQuality` should have separate statuses: `READY`, `DEGRADED_DATA`, `BLOCKED_MISSING_DATA`, `BLOCKED_STALE_STATE`, `BLOCKED_SEMANTIC_JOIN`, and `BLOCKED_COVERAGE`.

### New BUG-13: Audit Scripts Can Mislead the Operator

**Severity:** P1 - this does not directly create bad trades, but it hides or distorts system health.

**Evidence:**

- `scripts/check-feature-freshness.js` does not load `.env.local`; without `node -r dotenv/config` it fails every query with DB auth errors (`client password must be a string`).
- The same script uses flat freshness semantics, so sparse event features and dense state features are judged too similarly.
- `scripts/check-candle-coverage.js XAUUSD 90 1m,5m,15m,1h,4h,1d` breaks in PowerShell because comma lists are parsed as separate arguments unless quoted. The command must be quoted or the parser must accept multiple argv fragments.

**Long-Term Fix:**

1. Load dotenv consistently in all audit scripts or centralize DB bootstrap through the shared DB utility.
2. Drive audit thresholds from `FEATURE_REGISTRY` instead of hardcoded generic rules.
3. Make CLI parsers robust to PowerShell comma splitting.
4. Audit scripts must exit nonzero on DB connection failure and report connection errors separately from feature failures.

### Corrections / Reclassifications From Original V4

| Original Claim | Corrected Finding |
|---|---|
| Plain `candles_1d` missing means daily features are broken | Reclassified. The canonical daily source is `candles_1d_utc`; `candles_1d_ny` is auxiliary. The bug is any code path that still expects plain `candles_1d`. |
| `market_levels` has 3.3M stale rows | Reclassified for current DB. `market_levels` is currently empty and `market_levels_view` is the intended canonical direction. Pending work is moving all consumers to the view and enforcing the DB contract map. |
| PIT SQL compiler is validated | Reclassified. The compiler is the correct architectural direction, but compiler/default PIT parity is broken for ORB. Until parity is enforced, default backtest results are not trustworthy. |

---

## Per-Strategy Results Summary

| Strategy | Symbol | Raw Signals | Setup Blocked | Executed | Win Rate | Net R | Query Ms | Key Issue |
|----------|--------|-------------|---------------|----------|----------|-------|----------|-----------|
| `orb_classic` | XAUUSD | 36 | 35 | **0** | — | — | 135 | Setup BLOCK: zone tapped/ATR |
| `watukushay_no1` | XAUUSD | 84 | 66 | **2** | 50% | -0.80 | 73 | Low sample, vol/spread gates |
| `doyle_sd` | XAUUSD | 71 | 62 | **4** | 25% | -1.35 | **1,508** | Slow query (2.3M zone rows) |
| `smart_risk_ob_ifvg_1m` | XAUUSD | 5 | 3 | **2** | 50% | +0.46 | 20 | Tiny sample |
| `sniper_10r` | XAUUSD | 0 | 0 | **0** | — | — | 22 | No signals generated |
| `sniper_10r_fx` | EURUSD | 24 | 23 | **0** | — | — | 103 | Setup BLOCK |
| `keylevel_bounce_v1` | XAUUSD | 1 | 0 | **0** | — | — | 23 | **Warmup skip (1 signal)** |
| `keylevel_bounce` | XAUUSD | 1 | 0 | **0** | — | — | 24 | **Warmup skip** |
| `keylevel_bounce_v2` | XAUUSD | 0 | 0 | **0** | — | — | 0 | **BLOCKED: missing zone_retest@1m** |
| `keylevel_bounce_v3` | XAUUSD | 1 | 0 | **0** | — | — | 25 | **Warmup skip** |
| `keylevel_bounce_v4` | XAUUSD | 1 | 0 | **0** | — | — | 24 | **Warmup skip** |
| `keylevel_bounce_v5_longs` | XAUUSD | 0 | 0 | **0** | — | — | 11 | No signals |
| `keylevel_bounce_v5_shorts` | XAUUSD | 1 | 0 | **0** | — | — | 13 | **Warmup skip** |
| `keylevel_bounce_v6_ny` | XAUUSD | 1 | 0 | **0** | — | — | 12 | **Warmup skip** |
| `keylevel_bounce_v7_shorts` | XAUUSD | 1 | 0 | **0** | — | — | 12 | **Warmup skip** |
| `keylevel_bounce_v8b_zone_tp` | XAUUSD | 1 | 0 | **0** | — | — | 24 | **Warmup skip** |
| `keylevel_bounce_v8c_min3` | XAUUSD | 1 | 0 | **0** | — | — | 32 | **Warmup skip** |
| `keylevel_bounce_v8_levels` | XAUUSD | 1 | 0 | **0** | — | — | 17 | **Warmup skip** |
| `keylevel_bounce_v1_4r` | XAUUSD | 1 | 0 | **0** | — | — | 11 | **Warmup skip** |
| `keylevel_bounce_v1_fx` | EURUSD | 0 | 0 | **0** | — | — | 26 | No signals |
| `keylevel_bounce_v1_limit` | XAUUSD | 1 | 0 | **0** | — | — | 23 | **Warmup skip** |
| `keylevel_bounce_v1_wider` | XAUUSD | 1 | 0 | **0** | — | — | 25 | **Warmup skip** |
| `lewis_kelly_smc_ny_shorts` | EURUSD | 30 | 29 | **1** | 100% | +0.70 | 367 | Tiny sample |
| `pb_blake_2026_smc` | XAUUSD | 0 | 0 | **0** | — | — | 35 | No signals |
| `scarface_5m_orb` | XAUUSD | 0 | 0 | **0** | — | — | 0 | **BLOCKED: missing candle_pattern@1m, pricing@1m** |
| `smart_risk_ob_ifvg_1m_runon_15r` | XAUUSD | 5 | 3 | **0** | — | — | 27 | Vol gate + setup BLOCK |
| `smart_risk_ob_ifvg_1m_runon_15r_ob_tp` | XAUUSD | 5 | 3 | **0** | — | — | 25 | Vol gate + setup BLOCK |
| `smart_risk_ob_ifvg_1m_runon_15r_zone_tp` | XAUUSD | 5 | 3 | **0** | — | — | 288 | Vol gate + setup BLOCK |
| `waqar_v2` | EURUSD | 370 | 347 | **10** | 10% | -8.13 | **1,540** | 94% setup BLOCK, slow query |
| `watukushay` | XAUUSD | 11 | 11 | **0** | — | — | 24 | 100% setup BLOCK |
| `watukushay_fe` | XAUUSD | 11 | 11 | **0** | — | — | 24 | 100% setup BLOCK |
| `xauusd_v1` | XAUUSD | 8 | 8 | **0** | — | — | 165 | 100% setup BLOCK |
| `a_plus_orb_fvg_5m` | XAUUSD | — | — | **FAILED** | — | — | — | **DB timeout (57014)** |
| `forex_strategy_orb` | XAUUSD | 12 | 10 | **0** | — | — | 1,426 | Setup BLOCK + vol gate |

---

## 🔴 CRITICAL SYSTEMIC BUGS (Architecture-Level)

### BUG-1: Setup-Engine Blocking 85-99% of All Signals
**File:** `packages/setupEngine/src/evaluateSetup.ts` → `evaluateSetupBatch()` / `finalizeSetup()`  
**Evidence:** 24 of 34 strategies have >80% setup-engine BLOCK rate. Dominant reasons:
- `"All nearby zones have already been tapped"` — zone tap tracking logic appears over-aggressive
- `"No entry zone within 1.5 ATR of current price"` — ATR-based distance filter using stale ATR (see BUG-2)

**Root Cause Hypothesis:** The `features_zone` table's `is_fresh` / `tapped` columns are not being reset correctly per-bar, or the PIT query in `compilePITSQL` pulls zones that are already "tapped" in the current bar context. The `evaluateSetupBatch` groups by `(symbol, tf)` and reuses context — if zone tap state persists across signals incorrectly, every subsequent signal sees zones as "already tapped."

**Impact:** Backtest results are **meaningless** — strategies appear to have no edge when actually the setup-engine is filtering everything out.

**Fix Required:**
1. Audit `finalizeSetup()` zone freshness/tap logic — add debug logging for tap state per signal
2. Verify `features_zone.is_fresh` and `tapped` are computed correctly in feature engine
3. Add `--debug-setup-engine` flag to backtest runner to trace block reasons per signal

---

### BUG-2: `features_atr` Stale → Volatility Gates & ATR Distance Filters Flying Blind
**File:** `scripts/refresh-lifecycle.js` (not scheduled), `apps/web/src/lib/pipelineTrigger.ts` (inline trigger missing ATR)  
**Evidence:** 
- `features_atr` @ 1m = 195h stale (8 days) per prior audit
- `orb_classic`: 1 volatility gate skip
- `watukushay_no1`: 4 volatility + 2 spread gate skips
- `forex_strategy_orb`: 2 volatility gate skips
- `smart_risk_ob_ifvg_1m_runon_15r*`: 2 volatility gate skips each

**Root Cause:** ATR producer not in scheduled refresh (15-min cron) AND not in inline `runFeatureEngine()` trigger (which only runs zone, ifvg, order_block, bias, htf_bias).

**Impact:** Every volatility gate (`maxAtrPercentile`, `maxAtr5Pips`) and every ATR-based distance filter (`"No entry zone within 1.5 ATR"`) uses stale data → false positives/negatives.

**Fix Required:**
1. Add `features_atr` to `refresh-lifecycle.js` scheduled run (every 15 min per symbol)
2. Add `features_atr` to inline `pipelineTrigger.ts` feature set
3. Deploy PM2/Task Scheduler job for `refresh-lifecycle.js`

---

### BUG-3: `features_zone` 5m = 2.3M Rows → Query Timeouts & 1.5s+ Latency
**File:** `scripts/backtest-pit-v2.js` → `compilePITSQL()` (LATERAL joins on full table)  
**Evidence:**
- `a_plus_orb_fvg_5m`: **PostgreSQL statement_timeout (57014)** — query killed
- `doyle_sd`: 1,508ms query (2.3M zone rows @ 5m)
- `forex_strategy_orb`: 1,426ms query (2.3M zone rows @ 5m)
- `waqar_v2`: 1,540ms query (296K zone rows @ 1m)
- `xauusd_v1`: 165ms but uses 2.3M zone rows @ 5m

**Root Cause:** PIT compiler generates `LATERAL JOIN` with `ts <= signal_ts` on unpartitioned 2.3M-row table. No index can satisfy this efficiently.

**Fix Required:**
1. **Partition `features_zone` by time** (TimescaleDB hypertable, chunk_interval = 1 day)
2. **Add partial index:** `CREATE INDEX ON features_zone (symbol, tf, ts DESC) WHERE tf = '5m' AND is_fresh = true`
3. **Add PIT lookback window** to compiler: `AND ts >= signal_ts - INTERVAL '7 days'` (configurable per strategy via `pitLookbackInterval`)
4. **Retention policy:** `SELECT add_retention_policy('features_zone', INTERVAL '90 days')`

---

### BUG-4: `MIN_WARMUP_CANDLES = 200` Kills All Single-Signal Strategies
**File:** `scripts/backtest-pit-v2.js` line ~126: `const MIN_WARMUP_CANDLES = 200`  
**Evidence:** 12 `keylevel_bounce_*` variants generate exactly **1 raw signal** each, all skipped by warmup gate.

**Root Cause:** Warmup requires 200 candles before first signal. For 1h/4h strategies on 90-day window, first signal often occurs before 200 bars elapsed.

**Fix Required:**
1. Make `MIN_WARMUP_CANDLES` configurable per-strategy (via `spec.warmupBars` or `spec.filters.warmupBars`)
2. Default to `max(200, required_lookback_bars)` where `required_lookback_bars` derived from strategy's highest-timeframe feature
3. Backtest preflight: warn if `rawSignals > 0 && executed === 0 && warmupSkipped === rawSignals`

---

### BUG-5: Missing Feature Tables → BLOCKED_SYSTEM_QUALITY / DEGRADED
**Evidence:**
- `keylevel_bounce_v2`: **BLOCKED** — `features_zone_retest@1m = 0 rows`
- `scarface_5m_orb`: **BLOCKED** — `features_candle_pattern@1m = 0`, `features_pricing@1m = 0`
- `waqar_v2`: **DEGRADED** — `features_displacement@1m = 295` (sparse)
- `sniper_10r_fx`: **DEGRADED** — `features_sweep@15m = 0 rows`
- `xauusd_v1`: Uses `features_correlation@15m = 278 rows` (only TF with data)

**Root Cause:** Feature producers for 1m timeframe not implemented or not scheduled: `zone_retest`, `candle_pattern`, `pricing`, `displacement`. `features_sweep` only at 5m/1h, not 15m.

**Fix Required:**
1. Implement missing 1m feature producers in `packages/engine/src/features/`
2. Add to `refresh-lifecycle.js` scheduled run
3. Add to inline `pipelineTrigger.ts`
4. Backfill historical: `node scripts/backfill-historical-features.js XAUUSD 1m --features=zone_retest,candle_pattern,pricing,displacement`

---

### BUG-6: Symbol Restrictions Prevent XAUUSD Testing for FX Strategies
**Evidence:** 
- `keylevel_bounce_v1_fx`: `allowed: [EURUSD, GBPUSD]` — fails on XAUUSD
- `lewis_kelly_smc_ny_shorts`: `allowed: [EURUSD, GBPUSD]` — fails on XAUUSD
- `waqar_v2`: `allowed: [EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY]` — fails on XAUUSD
- `sniper_10r_fx`: `allowed: [EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY]` — fails on XAUUSD

**Impact:** Cannot validate FX strategies on gold; must run separate EURUSD sweep.

**Fix Required:** Backtest runner should auto-detect symbol from spec `filters.symbols` and run per-symbol, or accept `--symbol=ALL` to iterate spec's allowed symbols.

---

### BUG-7: `features_spread` = 294 Rows Total → Spread Gates Useless
**Evidence:** `watukushay_no1` (2 spread skips), `orb_classic` (no spread gate but should have), `a_plus_orb_fvg_5m` (spread gate in live config).

**Root Cause:** `features_spread` producer not in scheduled refresh or inline trigger.

**Fix Required:** Same as BUG-2 — add to `refresh-lifecycle.js` and `pipelineTrigger.ts`.

---

### BUG-8: `features_order_block` 1m = 3 Rows → 1m OB Strategies Starved
**Evidence:** `scarface_5m_orb` uses `features_order_block@1m` (not in coverage — likely 0 rows). `waqar_v2` uses `features_zone@1m` (296K rows) but no 1m OB.

**Fix Required:** Verify 1m OB producer exists in engine; if not, document limitation and prevent 1m OB specs from seeding.

---

### BUG-9: `candles_1d` Table Missing → Daily Features Broken
**Evidence:** `xauusd_v1` uses `features_time_of_day_edge@15m` (OK), but any daily-bias strategy would fail. `CANDLE_TABLE_BY_TF['1d']` in `packages/shared/src/db/timeBucket.ts` points to `candles_1d_utc` (cagg) but raw `candles_1d` doesn't exist.

**Fix Required:** Create `candles_1d` hypertable with cagg policies for `1d_utc` and `1d_ny`.

---

### BUG-10: `market_levels` = 3.3M Rows, 9 Days Stale
**Evidence:** Prior audit shows 3,332,258 rows, last_ts 2026-07-02. Heavy table with no retention.

**Fix Required:** Partition by time + retention policy + scheduled refresh.

---

## 🟡 HIGH-SEVERITY ISSUES

### ISSUE-1: `waqar_v2` 94% Setup Block Rate on EURUSD (370→10 trades)
**Spec:** Uses `features_zone@1m` (296K rows) + `features_displacement@1m` (only 295 rows — sparse!)  
**Block Reasons:** "All nearby zones have already been tapped" (5), "No entry zone within 1.5 ATR" (342)  
**Root Cause:** 1m displacement feature nearly empty → setup-engine can't confirm displacement → blocks. Combined with zone tap logic (BUG-1).

### ISSUE-2: `doyle_sd` / `forex_strategy_orb` / `waqar_v2` Slow Queries (1.4-1.5s)
**Cause:** `features_zone` 5m/1m massive tables (BUG-3). Fixing BUG-3 resolves this.

### ISSUE-3: `sniper_10r` Variants Generate 0 Signals on XAUUSD
**Spec:** Requires `features_zone@15m` (fresh demand/supply, fill_pct < 0.8) + `features_ifvg@5m` (fill_pct >= 0.5)  
**Data:** `features_zone@15m` = 144K rows, `features_ifvg@5m` = 273 rows — extremely sparse iFVG at 5m.  
**Fix:** Verify iFVG producer at 5m; backfill; or adjust spec to use 15m iFVG.

### ISSUE-4: `pb_blake_2026_smc` 0 Signals
**Spec:** Uses `features_zone@1h` (146K), `features_zone@15m` (144K), `features_order_block@15m` (312), `features_ifvg@5m` (273) — all present but no signal passes all filters. Likely over-constrained.

### ISSUE-5: `xauusd_v1` 8 Signals, 100% Setup Block
**Block:** "No entry zone within 1.5 ATR" (7), "All nearby zones tapped" (1) — same as BUG-1 + BUG-2.

---

## 🟢 WORKING COMPONENTS (Validated)

| Component | Status | Evidence |
|-----------|--------|----------|
| PIT SQL Compiler (`compilePITSQL`) | ✅ | Generates correct LATERAL joins for all strategies |
| Trade Simulation (`simulateTrade`) | ✅ | Intrabar modes (sl_first/tp_first/close/random_walk/momentum) work |
| Gate System (vol/spread/session/rateLimit/heat) | ✅ | Skip reasons logged correctly per strategy |
| Warmup Gate | ✅ | Correctly skips early signals (but threshold too high — BUG-4) |
| Deduping | ✅ | `dedupeTrades()` reduces duplicates |
| Portfolio Heat (post-pass) | ✅ | `applyPortfolioHeatPostPass()` marks heat-dropped trades |
| Persistence (`backtest_results`) | ✅ | All results written with run_id, heat_dropped, variant_id |
| Coverage Preflight | ✅ | Detects missing features (BLOCKED_SYSTEM_QUALITY) |
| Data Quality Grading | ✅ | READY/DEGRADED/BLOCKED correctly assigned |

---

## 📋 PRIORITIZED FIX ROADMAP

### P0 — DO FIRST (Unblocks All Backtests)
| # | Fix | Files | Effort |
|---|-----|-------|--------|
| 1 | Partition `features_zone` + partial index + retention + PIT lookback | Migration + `compilePITSQL` | 2-3 days |
| 2 | Schedule `refresh-lifecycle.js` (15 min/symbol) + add ATR/spread to inline trigger | `refresh-lifecycle.js`, `pipelineTrigger.ts` | 1 day |
| 3 | Fix setup-engine zone tap/freshness logic | `packages/setupEngine/src/evaluateSetup.ts` | 2-3 days |
| 4 | Make `MIN_WARMUP_CANDLES` configurable per-strategy | `backtest-pit-v2.js`, spec schema | 0.5 day |

### P1 — HIGH IMPACT
| # | Fix | Files | Effort |
|---|-----|-------|--------|
| 5 | Implement missing 1m feature producers (zone_retest, candle_pattern, pricing, displacement) | `packages/engine/src/features/` | 3-5 days |
| 6 | Backfill missing features + schedule | `scripts/backfill-historical-features.js` | 1 day |
| 7 | Add `features_sweep@15m` producer | `packages/engine/src/features/sweep.ts` | 1 day |
| 8 | Create `candles_1d` hypertable + cagg policies | Migration | 0.5 day |
| 9 | Partition `market_levels` + retention | Migration | 0.5 day |

### P2 — MEDIUM
| # | Fix | Files | Effort |
|---|-----|-------|--------|
| 10 | Backtest runner: auto-iterate spec's allowed symbols | `backtest-pit-v2.js` | 1 day |
| 11 | Add `--debug-setup-engine` flag for block tracing | `backtest-pit-v2.js`, `evaluateSetup.ts` | 0.5 day |
| 12 | Spec validation CI gate (reject incomplete specs) | `scripts/seed-strategy-specs.js` | 0.5 day |
| 13 | Telemetry: `avgHoldBars/timeoutBars` ratio alert | `backtest-pit-v2.js` | 0.5 day |

### P3 — POLISH
| # | Fix | Files | Effort |
|---|-----|-------|--------|
| 14 | Document 1m OB limitation / prevent 1m OB specs | Spec schema + docs | 0.5 day |
| 15 | Update AGENTS.md with new architecture decisions | `AGENTS.md` | 0.5 day |

---

## 🔍 VERIFICATION CHECKLIST (Post-Fix)

After P0 fixes, re-run sweep and verify:

```bash
# 1. No strategy has >50% setup-engine BLOCK rate (currently 24/34 do)
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json
# Expect: executed > 0, setupBlocked < 50%

# 2. Query times < 500ms for zone-heavy strategies
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json
# Expect: queryMs < 500 (was 1508)

# 3. a_plus_orb_fvg_5m completes without timeout
node scripts/backtest-pit-v2.js XAUUSD 90 a_plus_orb_fvg_5m --json
# Expect: success, not 57014 error

# 4. keylevel_bounce variants execute (not warmup-skipped)
node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v1 --json
# Expect: executed > 0 (with spec completed)

# 5. ATR freshness < 30 min on all TFs
node scripts/check-feature-freshness.js XAUUSD
# Expect: features_atr@1m STALE = false

# 6. No BLOCKED_SYSTEM_QUALITY for core strategies
node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v2 --json
# Expect: dataQuality = READY (not BLOCKED)
```

---

## 📎 APPENDIX: Key Code Pointers

| Component | File | Key Functions |
|-----------|------|---------------|
| PIT SQL Compiler | `scripts/backtest-pit-v2.js` | `compilePITSQL()` (~line 881) |
| Trade Simulation | `scripts/backtest-pit-v2.js` | `simulateTrade()` (~line 1125) |
| Setup Engine Batch | `packages/setupEngine/src/evaluateSetup.ts` | `evaluateSetupBatch()` (~line 292), `finalizeSetup()` |
| Gate Application | `scripts/backtest-pit-v2.js` | `applyGates()` (~line 2275) |
| Warmup Computation | `scripts/backtest-pit-v2.js` | `computeWarmupTs()` (~line 126) |
| Persistence | `scripts/backtest-pit-v2.js` | `persistTrades()` (~line 2497) |
| Inline Feature Trigger | `apps/web/src/lib/pipelineTrigger.ts` | `runFeatureEngine()` |
| Scheduled Refresh | `scripts/refresh-lifecycle.js` | Main entry |
| Feature Freshness Check | `scripts/check-feature-freshness.js` | (newly created) |
| Spec Validation | `scripts/seed-strategy-specs.js` | `validateSpec()` |

---

## 🎯 CONCLUSION

**The backtest infrastructure is functionally correct but the data pipeline and setup-engine are broken in ways that make all results invalid:**

1. **Setup-engine blocks 85-99% of signals** — zone tap/freshness logic bug
2. **ATR 195h stale** — volatility gates and ATR-distance filters use garbage data  
3. **Zone table 2.3M rows unpartitioned** — causes timeouts and 1.5s queries
4. **1m feature gaps** — zone_retest, candle_pattern, pricing, displacement missing → BLOCKED_SYSTEM_QUALITY
5. **Warmup threshold too aggressive** — kills single-signal strategies

**Do not optimize strategies until P0 fixes are deployed.** Current win rates, net R, and trade counts are artifacts of broken infrastructure, not strategy quality.

Once P0 complete, re-run full sweep. Expect:
- `orb_classic`: 35+ trades (was 35 in prior run, now 0 due to setup-engine regression)
- `doyle_sd`: query <500ms, meaningful trade count
- `a_plus_orb_fvg_5m`: completes, evaluates on merits
- `keylevel_bounce` family: executes (with completed specs)
- `waqar_v2`: displacement@1m populated → setup block rate drops from 94%
