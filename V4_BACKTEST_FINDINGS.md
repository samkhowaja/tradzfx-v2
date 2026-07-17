# V4 Backtest Sweep — Architecture/Skeleton Findings Report

**Date:** 2026-07-11  
**Scope:** 7 strategy variants on XAUUSD, 90-day window (2026-04-12 → 2026-07-11)  
**Runner:** `scripts/backtest-pit-v2.js` (PIT backtester, `--mode=full` default)  
**DB:** `tradzfx_v2` on localhost:5432 (TM_DB_PASSWORD auth)  
**Goal:** Find skeleton/architecture failures — NOT strategy optimization

---

## Executive Summary

| Strategy | Raw Signals | Executed | Win Rate | Net R | Key Issue |
|----------|-------------|----------|----------|-------|-----------|
| `orb_classic` | 64 | **35** | **54.3%** | **+22.0R** | ✅ Fixed (was 0 in V3) |
| `watukushay_no1` | 124 | **64** | 29.7% | -26.0R | ⚠️ Low WR, 10 timeouts |
| `doyle_sd` | 128 | **65** | **9.2%** | **-44.0R** | 🔴 Critical WR + 6.4s query |
| `smart_risk_ob_ifvg_1m` | 12 | **5** | 80.0% | +7.0R | ✅ Good but tiny sample |
| `smart_risk_ob_ifvg_1m_sniper_10r` | 8 | **3** | 0% | -3.0R | 🔴 avgHoldBars=221 (timeout bug) |
| `keylevel_bounce_v1` | 1 | **0** | — | — | 🔴 Spec is empty stub (8 lines) |
| `a_plus_orb_fvg_5m` | — | **FAILED** | — | — | 🔴 **DB statement_timeout** (57014) |

**V3→V4 Delta:** `orb_classic` (0→35) and `watukushay_no1` (0→64) now execute — setup-engine blocking was fixed. But **3 skeleton bugs remain** that no strategy tweak can fix.

---

## 🔴 CRITICAL SKELETON BUGS (Architecture-Level)

### BUG-1: `features_zone` 5m Table = 2.91M Rows → Query Timeouts
**File:** `scripts/backtest-pit-v2.js` (compilePITSQL, line ~881)  
**DB Evidence:** `features_zone` @ 5m = 2,911,399 rows (15× larger than 1h @ 191K)  
**Impact:** 
- `doyle_sd`: 6,442ms query (LATERAL join on 2.9M rows × 128 signals)
- `a_plus_orb_fvg_5m`: **PostgreSQL statement_timeout (57014)** — query killed
- `orb_classic`: 29 volatility gate skips (ATR stale → vol gate misfires)

**Root Cause:** `features_zone` 5m has no retention policy, no partitioning, and the PIT compiler generates a `LATERAL JOIN` per signal that scans the full 5m zone table with `ts <= signal_ts` — no index can satisfy this efficiently at 2.9M rows.

**Fix Required (Architecture):**
1. **Partition `features_zone` by time** (TimescaleDB hypertable with chunk_interval = 1 day)
2. **Add partial index:** `CREATE INDEX ON features_zone (symbol, tf, ts DESC) WHERE tf = '5m' AND is_fresh = true`
3. **Add retention policy:** `SELECT add_retention_policy('features_zone', INTERVAL '90 days')`
4. **PIT compiler optimization:** For `features_zone` @ 5m, add `AND ts >= signal_ts - INTERVAL '7 days'` (configurable per-strategy `pitLookbackInterval`)

---

### BUG-2: `features_atr` 1m = 195 Hours Stale (8 Days) — All Vol Gates Flying Blind
**File:** `packages/shared/src/utils/marketCalendar.ts` / `scripts/refresh-lifecycle.js`  
**DB Evidence:** `features_atr` @ 1m last_ts = 2026-07-03T14:52 (195h ago); 1h = 20h, 4h = 20h, 1d = 90h  
**Impact:** Every volatility gate (`maxAtrPercentile`, `maxAtr5Pips`) reads stale ATR → false positives/negatives

**Root Cause:** `scripts/refresh-lifecycle.js` (scheduled maintenance) not running on 15-30 min cadence. The inline `runFeatureEngine()` in `pipelineTrigger.ts` has a 25s `Promise.race` timeout and **does not recompute ATR** — it only refreshes lifecycle flags.

**Fix Required (Architecture):**
1. **Deploy `refresh-lifecycle.js` as PM2/Task Scheduler job** every 15 min per active symbol (per AGENTS.md § "Live feature pipeline & lifecycle")
2. **Add ATR to inline pipeline trigger** (`pipelineTrigger.ts`) — currently only runs `features_zone`, `features_ifvg`, `features_order_block`, `features_bias`, `features_htf_bias`
3. **Add producer-freshness alerting:** `assertProducerFresh('features_atr', '1m', '15 minutes')` in health monitor

---

### BUG-3: `keylevel_bounce_v1` Spec is an 8-Line Stub — Zero Executable Logic
**File:** `packages/strategies/src/specs/keylevel_bounce_v1.yaml` (8 lines total)  
**Impact:** 1 raw signal → warmup-skipped → 0 executed. Strategy is **dead code**.

**Root Cause:** Spec file contains only `id`, `familyId`, `active`, `name`, `version`, `description` — **no `filters`, `setup`, `entry`, `risk`, `gates` sections**.

**Fix Required (Architecture):**
1. **CI gate:** Add spec validation in `scripts/seed-strategy-specs.js` — reject specs missing required sections
2. **Seed complete spec** or deactivate (`active: false`) until implemented
3. **Backtest preflight:** Skip specs with `setup.length === 0 || entry.length === 0` (currently runs and produces 0 trades silently)

---

## 🟠 HIGH-SEVERITY SKELETON ISSUES

### BUG-4: `sniper_10r` `timeoutBars: 480` + `minRR: 10` → avgHoldBars=221 (Trades Never Close)
**File:** `packages/strategies/src/specs/smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp.yaml` (line ~65)  
**Evidence:** 3 executed, 0% WR, avgHoldBars=221, `timeoutBars: 480` (8 hours on 1m)  
**Root Cause:** `tp: opposing_zone_profit_beyond_min_rr` requires an opposing HTF zone to form as TP target. With `minRR: 10`, the opposing zone must be 10R away — extremely rare. Trades hold for hours until timeout (480 bars).

**Fix Required (Architecture):**
1. **Add `maxHoldBars` gate** (separate from `timeoutBars`) that forces exit at fixed horizon
2. **Validate TP logic in spec compiler:** Reject `opposing_zone_profit_beyond_min_rr` with `minRR > 5` without `maxHoldBars`
3. **Telemetry:** Log `avgHoldBars / timeoutBars` ratio; alert if > 0.5

---

### BUG-5: `features_spread` = 294 Rows Total — Spread Gate Running Blind
**DB Evidence:** `features_spread` total rows = 294 (across all TFs/symbols)  
**Impact:** `watukushay_no1` (7 spread skips), `orb_classic` (no spread gate but should have), `a_plus_orb_fvg_5m` (spread gate in live config) — all evaluating against near-empty table

**Root Cause:** `features_spread` producer not in scheduled refresh; only computed inline on 15m trigger (which runs every 15m but spread needs higher frequency).

**Fix Required (Architecture):**
1. Add `features_spread` to `refresh-lifecycle.js` scheduled run (every 5 min)
2. Add to inline `pipelineTrigger.ts` feature set
3. Backfill: `node scripts/backfill-historical-features.js XAUUSD 5m,15m,1h --features=features_spread`

---

### BUG-6: `features_order_block` 1m = 3 Rows — 1m OB Strategies Starved
**DB Evidence:** `features_order_block` @ 1m = 3 rows; @ 5m = 1,247; @ 15m = 3,847  
**Impact:** Any strategy using `features_order_block` @ 1m (e.g., scalpers) gets zero signals

**Root Cause:** OB detection at 1m not implemented in feature engine or not scheduled.

**Fix Required (Architecture):**
1. Verify `features_order_block` producer supports 1m TF in `packages/engine/src/features/orderBlock.ts`
2. Add 1m to scheduled refresh if supported
3. If not supported, document limitation and prevent 1m OB specs from seeding

---

### BUG-7: `candles_1d` Table Does Not Exist — Daily Features Broken
**DB Evidence:** `candles_1d` missing; `candles_1d_utc` and `candles_1d_ny` exist as continuous aggregates  
**Impact:** Any feature requiring daily candles (bias, structure, ATR 1d) falls back or fails silently

**Root Cause:** Migration never created base `candles_1d` table; only caggs exist. `CANDLE_TABLE_BY_TF['1d']` in `packages/shared/src/db/timeBucket.ts` points to `candles_1d_utc` but raw queries may reference `candles_1d`.

**Fix Required (Architecture):**
1. **Create `candles_1d` as hypertable** with continuous aggregate policies for `1d_utc` and `1d_ny`
2. **Update `CANDLE_TABLE_BY_TF`** to use `candles_1d_utc` as canonical daily
3. **Backfill:** `node scripts/refresh-candle-caggs.js` (full range)

---

## 🟡 MODERATE SKELETON ISSUES

### BUG-8: `market_levels` = 3.33M Rows, 9 Days Stale — Heavy Table, No Retention
**DB Evidence:** 3,332,258 rows, last_ts = 2026-07-02 (9 days ago)  
**Impact:** Any query joining `market_levels` scans 3.3M rows; stale data = wrong levels  
**Fix:** Partition by time + retention policy (90 days) + scheduled refresh

### BUG-9: `features_correlation` Only 278 Rows @ 15m — Correlation Gates Dead
**DB Evidence:** Only 15m has data (278 rows); 1h/4h/1d empty  
**Impact:** Strategies using correlation filter get zero signals

### BUG-10: `features_ifvg` Sparse — 5m=273, 15m=81, 1h=21, 4h=9, 1d=2
**Impact:** `smart_risk_ob_ifvg_1m` (5m iFVG entry) has tiny candidate pool

### BUG-11: `setup_evaluations` = 3 Rows (LIVE Only) — Backtest Writes to `backtest_results`
**Clarification:** This is **NOT a bug**. `setup_evaluations` has `order_id` column (LIVE only). Backtest correctly writes to `backtest_results`. Confirmed in `packages/shared/src/utils/setupEvaluations.ts` and `backtest-pit-v2.js` line 2497.

### BUG-12: `doyle_sd` Uses 5m `features_zone` (2.9M rows) + 5m `features_structure` → 6.4s Query
**Fix:** Same as BUG-1 (partition + index + lookback window)

### BUG-13: `watukushay_no1` 29.7% WR + 10 Timeouts — `regimeRelax` Gate May Be Misconfigured
**Spec:** `regimeRelax.enabled: true`, `tf: "1h"`, `agreement: true`, `regimeIn: ["trending"]`, `mode: "bypass"`  
**Issue:** `features_direction_state` @ 1h = 100% reconciled (per AGENTS.md), but `regimeRelax` bypasses vol gate ONLY when direction_state agrees. Low WR suggests either:
- Regime detection wrong (check `features_direction_state.regime` values)
- TP/SL logic flawed (`sl: "atr(5m) * 1.2"`, `tp: "sl * 2.5"` on 1h bias)

---

## 🟢 HEALTHY / WORKING AS DESIGNED

| Component | Status | Evidence |
|-----------|--------|----------|
| `orb_classic` execution | ✅ Fixed | 35 trades, 54% WR, +22R (was 0 in V3) |
| `watukushay_no1` execution | ✅ Fixed | 64 trades (was 0 in V3) |
| `smart_risk_ob_ifvg_1m` | ✅ Healthy | 5 trades, 80% WR, +7R |
| `backtest_results` persistence | ✅ Working | All results written (line 2497) |
| `simulateTrade()` intrabar logic | ✅ Correct | `sl_first`/`tp_first`/`close`/`random_walk`/`momentum` modes |
| `timeoutBars` default (24) + spec override | ✅ Working | `doyle_sd: 60`, `sniper_10r: 480`, `orb_classic: 24` |
| Warmup gate (`MIN_WARMUP_CANDLES=200`) | ✅ Working | `keylevel_bounce_v1` 1 signal skipped correctly |
| Gate system (vol/spread/session/rateLimit/heat) | ✅ Working | Skip reasons logged per strategy |
| PIT compiler (`compilePITSQL`) | ✅ Working | Generates correct LATERAL joins |
| `evaluateSetupBatch()` | ✅ Working | Batch eval per (symbol, tf) group |
| `evaluatePortfolioHeat()` | ✅ Working | Research mode bypasses; live mode enforces |

---

## 📋 ARCHITECTURE FIX ROADMAP (Priority Order)

### P0 — Must Fix Before Any Strategy Tuning
1. **Partition `features_zone` by time** + partial index + retention policy + PIT lookback window
2. **Deploy `refresh-lifecycle.js` as scheduled job** (15 min/symbol) + add ATR to inline trigger
3. **CI gate for strategy specs** — reject incomplete specs; deactivate `keylevel_bounce_v1` until implemented
4. **Create `candles_1d` hypertable** + update `CANDLE_TABLE_BY_TF` + backfill caggs

### P1 — High Impact, Quick Wins
5. **Add `maxHoldBars` gate** + spec compiler validation for extreme RR TP logic
6. **Schedule `features_spread` refresh** (5 min) + backfill
7. **Verify/implement 1m `features_order_block`** or document limitation
8. **Partition `market_levels`** + retention + refresh

### P2 — Medium Impact
9. **Backfill `features_correlation`** + schedule refresh
10. **Investigate `features_ifvg` sparsity** — producer issue or data limitation?
11. **Debug `watukushay_no1` regimeRelax** — verify `features_direction_state.regime` values at 1h

### P3 — Polish
12. **Telemetry:** `avgHoldBars/timeoutBars` ratio alerting
13. **Preflight:** Skip empty-spec strategies with clear log message
14. **Documentation:** Update AGENTS.md with new architecture decisions

---

## 🔍 LOGIN RESPONSE FORMAT INVESTIGATION (Separate Track)

**User Report:** "manifest code and name don't get set automatically on log in yet they had to be" after switching from multi-tenant plugin to custom tenancy.

**Suspected Files:**
- `apps/web/src/app/api/auth/login/route.ts` (or similar auth endpoint)
- `apps/web/src/lib/auth/tenancy.ts` (custom tenancy logic)
- Payload CMS config: `packages/payload/config/tenancy.ts` (if exists)

**Expected Expo App Response Format:**
```json
{
  "token": "jwt...",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "tenants": [{ "tenant": { "id": "tenant-id", "slug": "tenant-slug", "name": "Tenant Name" } }]
  }
}
```

**Action:** Search for login response construction in web app and verify tenant array format matches Expo expectation.

---

## 📝 Notes

- All DB evidence from `temp/v4_db_audit_v3.js` (33 queries, all successful)
- Backtest results from `node scripts/backtest-pit-v2.js XAUUSD 90 <strategy> --json`
- `a_plus_orb_fvg_5m` failed with PostgreSQL error 57014 (statement_timeout) — needs retry with longer timeout or query optimization
- `setup_evaluations` table is LIVE-only (has `order_id`); backtest uses `backtest_results` — confirmed not a bug
- The V3→V4 fix that unblocked `orb_classic` and `watukushay_no1` was likely in `evaluateSetupBatch()` or setup-engine grading logic — exact change not traced but confirmed working