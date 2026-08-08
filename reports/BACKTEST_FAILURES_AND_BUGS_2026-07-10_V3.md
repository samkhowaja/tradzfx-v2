# V3 Backtest & Live Engine Investigation Report
**Date**: 2026-07-10  
**Scope**: Post-V2-bug-fix re-validation — backtests, live engine audit, deep-dive  
**Previous Report**: `reports/BACKTEST_FAILURES_AND_BUGS_2026-07-09_V2.md`

---

## Executive Summary

After the user implemented fixes for several V2 bugs, a comprehensive V3 investigation was conducted covering:
1. DB state verification (feature freshness, lifecycle, data integrity)
2. Backtests on all key strategies (XAUUSD, 90-day, fast mode)
3. Live engine audit (signal generation, rejections, deployments)

**Result**: 2 of 3 live strategies produce **ZERO trades** on XAUUSD due to a volatility gate misconfiguration. The DB state has massively improved from V2 (ifvg freshness restored, sweep data populated, bug scars cleaned), but critical new issues were discovered in the gate layer and data pipeline.

---

> **Reading order / status (Jul 10).** Parts 1–7 below are the V3 investigation narrative. The **system skeleton architecture** (time / data / event / lifecycle / direction truth, plus the skeleton-first pivot and acceptance bar) now lives in its own living document: **`reports/SYSTEM_SKELETON_ARCHITECTURE_2026-07-10.md`**. Strategy / gate-threshold tuning is frozen until its §7 acceptance bar holds.

---

## Part 1: DB State — What Improved Since V2

| Metric | V2 State | V3 State | Status |
|--------|----------|----------|--------|
| ifvg@5m freshness | 0% fresh (all stale) | 91% fresh (427K/470K) | ✅ FIXED |
| sweep@15m rows | 1 row total | 849 rows | ✅ FIXED |
| zone retest_count | All NULL | Populated across all TFs | ✅ FIXED |
| Bug scars (invalidated_at < ts) | Present in ifvg & zone | 0 rows in both tables | ✅ FIXED |
| ifvg@15m freshness | Dead | 90.5% fresh (62.8K/69.4K) | ✅ FIXED |
| candles_1m coverage | All 10 symbols current | All 10 symbols up to Jul 10 00:40-00:42 EDT | ✅ MAINTAINED |

---

## Part 2: Backtest Results — All Strategies (XAUUSD, 90-day, fast mode)

### Live Strategies (promoted via `promote-top3-live.js`)

| Strategy | Raw Signals | Executed | Win Rate | Net R | Status |
|----------|------------|----------|----------|-------|--------|
| **doyle_sd** | 71 | 30 | 66.7% | +28.48R | ✅ HEALTHY |
| **orb_classic** | 31 | **0** | N/A | 0.00 | ❌ ALL BLOCKED |
| **watukushay_no1** | 87 | **0** | N/A | 0.00 | ❌ ALL BLOCKED |

### Other Key Strategies

| Strategy | Raw Signals | Executed | Win Rate | Net R | Blocker |
|----------|------------|----------|----------|-------|---------|
| smart_risk_ob_ifvg_1m | 557 | 20 | 75.0% | +16.87R | 529 blocked by volatility |
| smart_risk_ob_ifvg_1m_sniper_10r | 282 | **0** | N/A | 0.00 | ALL blocked by volatility |
| keylevel_bounce_v1 | 1 | 0 | N/A | 0.00 | Session gate |
| pb_blake_2026_smc | N/A | N/A | N/A | N/A | XAUUSD not in symbol list |
| waqar_v2 | N/A | N/A | N/A | N/A | XAUUSD not in symbol list |
| lewis_kelly_smc_ny_shorts | N/A | N/A | N/A | N/A | XAUUSD not in symbol list |
| a_plus_orb_fvg_5m | N/A | N/A | N/A | N/A | Statement timeout |
| scarface_5m_orb | N/A | N/A | N/A | N/A | XAUUSD not in symbol list |

---

## Part 3: Critical Bugs Found

### BUG-3.1 [CRITICAL] Volatility Gate Blocks 100% of XAUUSD Trades for Most Strategies

**Severity**: CRITICAL — 2 of 3 live strategies produce zero trades

**Root Cause**: The volatility gate thresholds are calibrated for forex pairs (2-5 pips) but XAUUSD ATR5 is 50-90 pips. The gate computes `atr5Pips = atr5_raw / pipSize` where `pipSize("XAUUSD") = 0.1`. With XAUUSD 5m ATR5 median = 4.99 raw → 49.9 pips, every bar exceeds the forex-calibrated thresholds.

**Evidence**:
```
XAUUSD ATR5 stats (5m): min=0.00, max=1643.10, avg=6.09, median=4.99 raw
  → In pips: median = 4.99 / 0.1 = 49.9 pips

orb_classic volatility gate: maxAtr5Pips=2.5 (global), NY=3.5
  → 49.9 > 3.5 → 100% blocked

watukushay_no1 (inherits from watukushay base): maxAtr5Pips=3
  → 49.9 > 3 → 100% blocked

smart_risk_ob_ifvg_1m: maxAtr5Pips=30.0 (manually adjusted for XAUUSD)
  → 49.9 > 30 → 95% blocked (529/557), but 20 still pass
```

**Why doyle_sd works**: It has **NO volatility gate** in its spec — only session, spread, portfolioHeat, and rateLimit gates.

**Affected Strategies**:
- `orb_classic` — LIVE, 0 trades
- `watukushay_no1` — LIVE, 0 trades
- `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp` — 0 trades
- `smart_risk_ob_ifvg_1m` — 95% blocked (only 20/557 pass)

**Fix**: Either:
1. Add per-symbol volatility thresholds to strategy specs (like `smart_risk_ob_ifvg_1m` did with `maxAtr5Pips: 30.0`)
2. Make the volatility gate symbol-aware with sensible defaults per asset class
3. Remove the volatility gate from strategies that trade XAUUSD

---

### BUG-3.2 [CRITICAL] ATR5 Data Corruption — Extreme Outliers

**Severity**: CRITICAL — Corrupted data poisons backtest results and live gate decisions

**Evidence**:
```
XAUUSD 5m ATR5 extreme values:
  1643.10 at Jul 07 18:15 EDT  (330x normal ~5.0)
  1643.00 at Jul 07 18:10 EDT
  1642.61 at Jul 07 18:05 EDT
   823.25 at Jul 07 18:25 EDT
   822.70 at Jul 07 17:04 EDT
```

The `min=0.00000` and `max=1643-1695` across ALL timeframes (1m through 1d) indicates systemic corruption, not just a few bad ticks. The backtest runner has `SPREAD_SANITY_MULTIPLIER = 10` for spread quarantine but **no equivalent ATR sanity cap**.

**Impact**:
- Backtest volatility gate decisions use corrupted ATR values
- The `smart_risk_ob_ifvg_1m` strategy's 20 passing trades may have passed only because they happened to land on non-corrupted ATR bars
- Live engine volatility gate decisions are affected

**Fix**:
1. Add ATR sanity cap in backtest runner (similar to `SPREAD_SANITY_MULTIPLIER`)
2. Investigate and fix the root cause of ATR corruption (likely bad tick data feeding the ATR calculation)
3. Recompute ATR5 for affected periods

---

### BUG-3.3 [HIGH] XAUUSD Lifecycle Refresh Severely Stale

**Severity**: HIGH — Feature freshness lifecycle not running for XAUUSD

**Evidence**:
```
lifecycle_refresh_state for XAUUSD:
  features_ifvg:  last = Jun 18 12:05 EDT (516 hours ago!)
  features_zone:  last = Jun 10 12:15 EDT (708 hours ago!)

All other symbols: ~39 hours ago (normal)
```

While the actual feature data is current (ifvg@5m latest = Jul 09 17:45, zone@5m latest = Jul 10 00:25), the lifecycle refresh process that marks stale rows as `is_fresh=false` and `invalidated_at` has not run for XAUUSD in 3-4 weeks. This means:
- Stale zones/ifvgs are NOT being invalidated
- `is_fresh=true` may be incorrect for older rows
- The 91% freshness rate may be artificially inflated

**Fix**: Investigate why the lifecycle refresh skips XAUUSD. Check for errors in the refresh job logs.

---

### BUG-3.4 [HIGH] Live Engine Rejection Flood — 8,379 Rejections in 7 Days

**Severity**: HIGH — Live engine is mostly rejecting, not trading

**Evidence** (from `live_signal_rejection`, last 7 days):
```
Total rejections: 8,379
Only 4 live_signal rows generated

Top rejection reasons:
  no_signal:                                    630  (7.5%)
  gates_failed: volatility_gate:                320  (3.8%)
  gates_failed: volatility_gate, portfolio_heat: 70  (0.8%)
  stale_features: features_zone@5m(16.8min):     60  (0.7%)
  stale_features: features_zone@5m(16.9min):     51  (0.6%)
  gates_failed: portfolio_heat:                  49  (0.6%)
  setup_blocked: Spread 40.5p exceeds max...:    48  (0.6%)
  setup_blocked: Spread 102.3p exceeds max...:   46  (0.5%)
  ...hundreds more stale_features and spread rejections...
```

**Key Observations**:
1. **Spread values are corrupted in the live engine**: The `features_spread` table shows normal XAUUSD spreads (2.7-3.1), but the live engine sees 40-102 pip spreads. This suggests the spread gate is reading from a different source or the spread is being miscalculated.
2. **Stale features**: Zone data is 5-17 minutes stale at signal time — this is a timing/refresh issue
3. **Only 4 signals in 7 days**: The engine is running but almost never producing actionable signals

**Fix**:
1. Investigate spread value discrepancy between `features_spread` table and live engine
2. Reduce feature staleness by ensuring feature refresh runs before signal evaluation
3. Consider relaxing the volatility gate for XAUUSD (see BUG-3.1)

---

### BUG-3.5 [MEDIUM] Statement Timeout on Complex Strategies

**Severity**: MEDIUM — Some strategies cannot complete backtests

**Evidence**:
```
a_plus_orb_fvg_5m:      "canceling statement due to statement timeout" (5 min)
smart_risk_ob_ifvg_1m_sniper_10r:  11,352ms signal query (approaching timeout)
```

The 5-minute `statement_timeout` is too low for strategies with many feature joins. The sniper strategy took 11.3 seconds just for the signal query.

**Fix**: Increase `TM_DB_STATEMENT_TIMEOUT` or optimize the signal SQL for complex strategies.

---

### BUG-3.6 [MEDIUM] XAUUSD Missing from Many Strategy Symbol Lists

**Severity**: MEDIUM — Limits backtest coverage for the primary traded symbol

**Affected Strategies** (XAUUSD not in `filters.symbols`):
- `pb_blake_2026_smc` — forex only
- `waqar_v2` — forex only
- `lewis_kelly_smc_ny_shorts` — forex only
- `scarface_5m_orb` — forex only

**Fix**: Add XAUUSD to symbol lists where the strategy logic supports it, or document that these are intentionally forex-only.

---

### BUG-3.7 [LOW] features_displacement@1m Coverage Gap for XAUUSD

**Severity**: LOW — Missing data for specific feature/symbol/TF combinations

**Evidence**:
```
XAUUSD features_displacement@1m: 0 rows
Other symbols displacement@1m: 240-251 rows each
```

The displacement engine is not generating 1m data for XAUUSD while it does for all forex pairs.

---

## Part 4: Live Deployments Status

Active deployments found in `live_deployment`:
| Strategy | Mode | Started |
|----------|------|---------|
| doyle_sd | paper | Jul 06 |
| forex_strategy_orb | paper | Jul 06 |
| orb_classic | paper | Jul 06 |
| scarface_5m_orb | paper | Jul 06 |
| waqar_v2 | paper | Jul 06 |

All deployments started Jul 06 and are still active. Note: `watukushay_no1` is listed as a LIVE_VARIANT in `promote-top3-live.js` but has no active deployment.

---

## Part 5: Summary of All Findings

| ID | Severity | Title | Impact |
|----|----------|-------|--------|
| BUG-3.1 | CRITICAL | Volatility gate blocks 100% of XAUUSD trades | 2/3 live strategies dead |
| BUG-3.2 | CRITICAL | ATR5 data corruption (extreme outliers) | Poisons backtests & live gates |
| BUG-3.3 | HIGH | XAUUSD lifecycle refresh 500-700h stale | is_fresh may be incorrect |
| BUG-3.4 | HIGH | Live engine: 8,379 rejections, only 4 signals | Engine mostly rejecting |
| BUG-3.5 | MEDIUM | Statement timeout on complex strategies | Can't backtest some strats |
| BUG-3.6 | MEDIUM | XAUUSD missing from strategy symbol lists | Limited coverage |
| BUG-3.7 | LOW | displacement@1m missing for XAUUSD | Minor data gap |

---

## Part 6: Recommended Priority Actions

1. **IMMEDIATE**: Fix volatility gate thresholds for XAUUSD on `orb_classic` and `watukushay_no1` — these are LIVE strategies producing ZERO trades
2. **IMMEDIATE**: Investigate and fix ATR5 data corruption — add sanity cap in backtest runner
3. **HIGH**: Fix XAUUSD lifecycle refresh — it hasn't run in 3-4 weeks
4. **HIGH**: Investigate spread value discrepancy in live engine (40-102 pip spreads vs 2.7-3.1 in DB)
5. **MEDIUM**: Increase statement timeout or optimize complex strategy SQL
6. **LOW**: Add XAUUSD to forex-only strategy symbol lists where appropriate
---

## Part 7: V4 Full Sweep Merge and Current Architecture Status

**Merged source**: `V4_FULL_SWEEP_FINDINGS.md`  
**Merge date**: 2026-07-11  
**Scope added**: 34-strategy full sweep, setup-engine block analysis, current DB feature/data state, and root architecture plan for data collection plus market-analysis inputs.

### 7.1 V4 Executive Update

The V4 sweep confirms the core V3 conclusion but moves the failure higher up the stack:

- V3 found dead live strategies mostly through volatility gates and stale/corrupt feature state.
- V4 found that in full mode the **setup engine blocks most raw candidates before strategy quality can be measured**.
- The repeated block reasons are `"All nearby zones have already been tapped"` and `"No entry zone within 1.5 ATR of current price"`.
- This is not a normal strategy-selection result. It is a system-skeleton failure: setup evaluation, lifecycle state, ATR state, feature coverage, and zone data model are still not stable enough to make win rate or net R trustworthy.

The important correction to V4: several items listed as missing are now **partially implemented** in code. The remaining problem is enforcement and unification, not total absence.

### 7.2 What Is Already Done or Partially Done

| Area | Current Status | Evidence / Notes |
|---|---|---|
| `BLOCKED_SYSTEM_QUALITY` | **Partially done** | `scripts/backtest-pit-v2.js` now blocks missing dense features/candles and lifecycle scars instead of reporting fake 0-trade results. |
| Live feature freshness | **Partially done** | `liveRunner.ts` uses registry semantic type for state/event/level freshness and includes producer SLA checks. |
| Inline live feature trigger | **Partially done** | `pipelineTrigger.ts` now collects strategy-required features and core gate inputs, including `features_atr@15m`, `features_spread@1m`, and `features_session@1m`. V4's claim that ATR/spread are missing from the inline trigger is outdated. |
| Market-data truth layer | **Partially done** | `candleSource.ts` supports deterministic HTF rollup from `candles_1m`, market-calendar-aware coverage, gap counts, and `candles_1d_utc` as canonical daily truth. |
| Feature registry | **Partially done** | `FEATURE_REGISTRY` defines semantic type, join policy, freshness, required columns, and lookback defaults. |
| SQL builder | **Partially done** | `packages/strategies/src/sqlBuilder.ts` can build registry-driven PIT lateral joins. |
| Producer ledger | **Partially done** | `feature_producer_runs` exists and receives engine/lifecycle entries, but enforcement is inconsistent and live producer stale action defaults to warn. |
| ATR quality fields | **Partially done** | `features_atr` has `effective_value`, `is_valid`, `outlier_score`, `tick_count`, `quality_reason`; raw historical outliers still exist and consumers must consistently use `effective_value`. |
| Direction state | **Early partial** | `features_direction_state` exists and live volatility gate can opt into regime-aware relaxation, but this is not yet the full Direction Arbiter described in the skeleton document. |
| Market levels | **Partially done** | `market_levels_view` exists and `market_levels` is currently empty, so the old stale monolithic table is no longer the main source. Strategies still query raw level tables directly. |

### 7.3 What Is Still Pending / Still Dangerous

| Pending Area | Current Risk | Root Fix |
|---|---|---|
| Setup engine as universal hard block | Full-mode results are dominated by zone proximity/tapped-zone rules even for ORB, continuation, and non-zone strategies. | Make setup evaluation family-aware and opt-in. ORB should use ORB/displacement/session rules, not supply/demand zone proximity. |
| Backtester SQL fork | `backtest-pit-v2.js` still defaults to its own PIT SQL path; `PIT_USE_COMPILER_SQL=1` is off by default. It still contains `MAX(ts)` joins for pricing/ATR and hardcoded feature whitelists. | One compiler path for live and PIT. Delete or deprecate the fork after parity tests pass. |
| Coverage preflight | Backtest coverage still mainly counts rows. It does not use `candleSource.checkCandleCoverage()` ratios/gap data, producer SLA, or semantic feature expectations deeply enough. | Shared `runSystemHealthCheck()` used by live and backtest before any signal query. |
| Feature producer scheduling | Engine ledgers exist, but many XAUUSD producers have watermarks 23-96h old and producer checks are warn-only in live unless configured otherwise. | Dedicated producer scheduler with per-feature SLAs, retry policy, and blocking health gate. |
| `features_zone` explosion | DB estimates show `features_zone` around **24.6M rows**; XAUUSD 5m has **2.31M rows in 90d**. Zone-heavy strategies still hit slow queries/timeouts. | Stable zone identity + dedupe, hypertable/partitioning, PIT lookback, canonical level view, and lifecycle expiry. |
| Data collection completeness | XAUUSD 1m spread has only **286 rows in 90d**; XAUUSD has no current `features_pricing@1m`, `features_displacement@1m`, `features_candle_pattern@1m`, or `features_zone_retest@1m` in the 90d count. | Data-collection contract per required feature/tf; do not seed specs that require missing producer coverage. |
| ATR outliers | XAUUSD 5m ATR period 5 still has raw max **1643.10**, 7 rows >100, and 11 invalid rows in 90d. | Quality quarantine at candle ingest + ATR recompute pipeline; all gates/risk/setup must use `effective_value`. |
| Spread source quality | XAUUSD 1m spread median is **2.825**, max **28.15**, but historical coverage is tiny. Prior live rejections saw 40-102p spread values, so source/unit drift remains possible. | Single spread contract: value units, source, samples, bid/ask provenance, sanity caps, and snapshot in candidate audit. |
| Direction selection | Strategy specs still carry their own bias conditions; wrong-direction prevention is not centralized. | Promote Direction Arbiter to mandatory pre-strategy decision (`direction_state`) with confidence, invalidation, and recency decay. |
| Candidate explainability | Backtest does not persist every accepted/rejected candidate with exact feature/candle/direction/gate snapshot. | `strategy_signal_candidates` table and stage-waterfall reporting. |

### 7.4 Current DB Evidence From Jul 11 Spot Check

These are current local DB observations collected during this merge pass:

| Check | Current Evidence | Interpretation |
|---|---|---|
| XAUUSD `features_zone@5m` | 2,312,421 rows in 90d, latest 2026-07-10 23:35 UTC | Massive level table remains the main query/duplication risk. |
| All `features_zone` | ~24,613,707 estimated live rows | The system needs stable identity/dedupe and retention, not more indexes alone. |
| XAUUSD `features_atr@1m` | latest 2026-07-03 14:52 UTC, age ~198h | 1m ATR remains stale; any 1m ATR-dependent strategy/gate is unsafe. |
| XAUUSD `features_atr@5m/15m/1h/4h` | latest 2026-07-10 21:55 UTC, age ~23h | Better than V3, but not live-fresh. |
| XAUUSD ATR outliers | median 4.64, p95 10.00, max 1643.10, 7 rows >100, 11 invalid | Quality columns exist, but raw outliers still live in history. |
| XAUUSD `features_spread@1m` | 286 rows in 90d, median 2.825, max 28.15 | Spread history is far too sparse for robust spread analysis/calibration. |
| XAUUSD `features_zone_retest@1m` | no 1m rows in the 90d count | Any spec requiring 1m retest should be blocked before backtest. |
| XAUUSD `features_order_block@1m` | 3 rows in 90d, latest 2026-07-01 | 1m OB strategies are starved and should be disabled or explicitly marked experimental. |
| XAUUSD `features_direction_state` | 15m/1h rows exist, latest around 2026-07-10 20:45 | Direction state exists, but is not yet a mandatory arbiter for strategy entry. |
| XAUUSD candle coverage | 5m ratio 0.9776 with gaps; 15m/1h/4h also show gaps; 1m ratio >1 due expected-count mismatch | Coverage math improved but still needs strict, calendar-aware acceptance rules and gap blocking. |

### 7.5 V4 Findings Reclassified

| V4 Finding | Current Classification | Merge Decision |
|---|---|---|
| Setup engine blocks 85-99% | **Confirmed current critical** | Keep as P0, but root fix is family-aware setup + direction arbiter, not just debugging tap logic. |
| ATR stale | **Partially fixed, still unsafe** | ATR producers are running for some TFs, but XAUUSD 1m is stale and 5m/15m are not live-fresh. |
| `features_zone` too large | **Confirmed current critical** | Keep as P0. Table explosion is worse than a simple indexing issue. |
| `MIN_WARMUP_CANDLES=200` | **Confirmed design smell** | Replace with computed warmup from registry/spec requirements. |
| Missing 1m feature tables | **Confirmed for XAUUSD-required surfaces** | Do not backtest specs requiring missing tf coverage; build feature/tf capability matrix. |
| Symbol restrictions | **Valid tooling issue** | Add `ALL_ALLOWED` mode; do not force XAUUSD onto FX-only specs unless market logic supports metals. |
| Spread rows sparse | **Confirmed** | Historical spread is not a reliable dataset yet. |
| 1m OB starved | **Confirmed** | Mark 1m OB specs experimental/blocked until producer quality is proven. |
| `candles_1d` missing | **Reclassified** | Not a bug by itself. `1d` canonical table is `candles_1d_utc`; `candles_1d_ny` is auxiliary. The bug is if any code expects plain `candles_1d`. |
| `market_levels` stale | **Reclassified** | `market_levels` is empty; `market_levels_view` is the canonical direction. Pending work is migration of consumers to the view. |

### 7.6 Better Long-Term Architecture: Data Collection First

Good trading analysis needs more than feature tables. The engine needs a **data collection contract** before strategy optimization:

1. **Raw market data layer**
   - Store broker, symbol, broker server time, UTC time, bid, ask, mid, volume/tick volume, spread, and import source.
   - Keep raw 1m OHLC only as a derived candle from raw ticks or broker-exported bars with quality flags.
   - Record duplicates, missing bars, weekend bars, maintenance gaps, and suspicious OHLC ordering.

2. **Symbol contract layer**
   - One `symbol_contracts`/`pair_characteristics` truth for pip size, tick size, digits, point value, typical spread, session behavior, broker suffix, metals/FX/index class, and allowed trading sessions.
   - This removes XAUUSD-vs-FX pip mistakes from gates, ATR, spread, stops, and performance reporting.

3. **Market calendar layer**
   - FX 24/5 calendar, broker maintenance windows, holidays, DST/session definitions, and expected tradable bars by symbol.
   - Candle coverage must use this calendar, not simple 24/7 math.

4. **Candle quality layer**
   - `candles_1m` remains source-of-truth candle table, but every candle gets quality metadata: import source, adjusted timestamp, duplicate flag, gap-before minutes, suspicious range flag, tick/sample count, and spread sanity status.
   - HTF candles are deterministic rollups or verified continuous aggregates only.

5. **Feature producer contract**
   - Every feature/tf/symbol has an explicit producer owner, SLA, expected density, semantic type, and required dependencies.
   - Example: `features_spread@1m` should be dense; `features_sweep@15m` is sparse; `features_zone@5m` is level/interval and must have lifecycle state.
   - Preflight blocks when dense/state features are missing or stale; sparse event features warn unless the strategy explicitly requires recent occurrence.

6. **Canonical market object layer**
   - `market_levels_view`: zones, OBs, iFVGs, pivots, liquidity pools with common geometry and provenance.
   - `market_events_view`: sweeps, BOS/CHoCH, displacement, candle events, retests with event kind, direction, price, score, lifecycle, and provenance.
   - Strategy SQL should ask for canonical market objects first, raw feature tables only for source-specific details.

7. **Direction/state layer**
   - Mandatory Direction Arbiter consumes HTF/LTF structure, sweeps, displacement, premium/discount, session, active levels, and recent invalidation.
   - Outputs direction, confidence, regime, valid-until, invalidation level, and component votes.
   - Strategies align with this or declare countertrend mode with stricter evidence.

8. **Candidate audit layer**
   - Persist every candidate, even rejects: exact candle snapshot, feature snapshot, direction state, setup result, gate result, and final decision stage.
   - This turns "why no trades?" from guesswork into a SQL query.

### 7.7 P0 Plan After V4 Merge

1. **Stop trusting full-mode win rates until setup engine is family-aware.**
   - Add `setupProfile` / `familyId` behavior: `zone_reversal`, `orb_breakout`, `fvg_continuation`, `indicator`, `moving_average`.
   - Zone proximity/tapped-zone rules only apply where the strategy family actually needs a zone.

2. **Unify live/backtest/compiler SQL.**
   - Make registry-driven compiler PIT mode the default.
   - Remove `MAX(ts)` latest-row joins for event/candidate features.
   - Keep one set of predicate, freshness, lifecycle, and join-policy rules.

3. **Build a feature/tf capability matrix and block impossible specs.**
   - Generate `reports/feature-tf-capability-latest.md`.
   - Include rows, latest timestamp, producer freshness, expected density, and status per symbol/tf/feature.
   - Seeding/promoting specs should fail if they require a blocked feature/tf surface.

4. **Fix zone explosion structurally.**
   - Add stable `zone_id`/`anchor_hash` based on formation candle, symbol, tf, type, direction, and rounded geometry.
   - Upsert by stable identity instead of floating geometry.
   - Add lifecycle expiry and canonical `market_levels_view` consumption.
   - Add hypertable/partitioning and PIT lookback, but treat indexing as support, not the fix.

5. **Make producer freshness blocking in research/promotion.**
   - Live can roll out as warn -> block, but backtest promotion must be strict now.
   - `feature_producer_runs` should include `rows_seen`, `rows_inserted`, `rows_updated`, `rows_invalidated`, `producer_version`, `watermark_ts`, and quality stats for every run.

6. **Repair data collection for spreads and execution costs.**
   - Persist bid/ask or spread on every 1m candle/import row, not 286 rows per 90 days.
   - Normalize spread units through symbol contract.
   - Store execution-cost profiles by symbol/session, and snapshot the cost model used in every backtest.

7. **Recompute ATR after candle-quality quarantine.**
   - Any raw ATR outlier remains in history only as evidence; backtest/gates use `effective_value`.
   - Add an audit that fails if any ATR consumer selects `value` without `COALESCE(effective_value, value)` where quality fields exist.

8. **Promote Direction Arbiter from optional feature to mandatory skeleton.**
   - No strategy gets to decide direction alone.
   - Wrong-side entries become a separate rejection class: `direction_conflict`, `direction_stale`, `direction_low_confidence`, `countertrend_not_allowed`.

### 7.8 Updated Verification Checklist

Run these after P0 changes, before accepting any strategy WR:

```bash
pnpm -r build
node scripts/audit-feature-contracts.js
node scripts/check-candle-coverage.js XAUUSD 90 '1m,5m,15m,1h,4h,1d'
$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/check-feature-freshness.js XAUUSD
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 a_plus_orb_fvg_5m --json --mode=research
node scripts/backtest-pit-v2.js ALL 90 waqar_v2 --json --mode=research
```

Acceptance conditions:

- No core strategy returns `BLOCKED_SYSTEM_QUALITY` unless the missing data is real and documented.
- Full-mode setup-block rate is explained by family-specific rules, not generic zone proximity.
- Zone-heavy strategy query time stays below 500ms or reports a bounded-data-quality reason.
- Feature/tf capability matrix marks all strategy-required features `READY`.
- `features_spread@1m` is dense enough to model execution cost by session.
- ATR raw outliers are quarantined and all consumers use effective ATR.
- Direction state is present and fresh before any strategy signal is evaluated.

### 7.9 Codex Rerun Verification Addendum - 2026-07-11

I reran the important V4 claims instead of only merging the text. The rerun confirms the architecture-level diagnosis and adds one P0 issue that is more dangerous than a bad win rate: the default ORB backtest path can generate signals from stale opening-range rows.

#### Confirmed By Rerun

| Area | Evidence | Status |
|---|---|---|
| Setup engine blocks most candidates | `orb_classic`: 36 raw, 35 setup-blocked, 0 executed. `doyle_sd`: 71 raw, 62 setup-blocked, 4 executed. `waqar_v2` ALL: 1,610 raw, 1,505 setup-blocked, 60 executed. | Confirmed P0 |
| Missing required 1m feature surfaces | `keylevel_bounce_v2` blocked by `features_zone_retest@1m=0`; `scarface_5m_orb` blocked by `features_candle_pattern@1m=0` and `features_pricing@1m=0`; displacement 1m also missing/sparse. | Confirmed P0/P1 |
| Warmup design blocks low-sample strategies | `keylevel_bounce_v1`: 1 raw signal, 1 warmup skip, 0 executed. | Confirmed P1 |
| Zone table explosion | `features_zone` estimated live rows: 24,613,707; XAUUSD `features_zone@5m`: 2,312,421 rows in 90d. | Confirmed P0 |
| A+ ORB/FVG query failure | `a_plus_orb_fvg_5m` still fails with PostgreSQL `57014 canceling statement due to statement timeout`. | Confirmed P0 |
| Feature freshness unsafe | XAUUSD freshness probe with `.env.local` loaded: FRESH 0, STALE 134, EMPTY 28. XAUUSD `features_atr@1m` latest 2026-07-03 14:52 UTC; spread 1m only 286 rows in 90d. | Confirmed P0 |

#### New P0: ORB Opening-Range Stale Join / Compiler Parity Break

Default legacy PIT and compiler PIT disagree on the same `orb_classic` window:

| Run | Result |
|---|---|
| `node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research` | 36 raw, 35 executed, 54.3% WR, +22R |
| `$env:PIT_USE_COMPILER_SQL='1'; node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research --debug` | 0 raw, debug showed `bias_rows=455`, `setup_rows=0`, `entry_rows=0` |

The DB explains why. During the ORB signal window, XAUUSD 15m had 455 bias candidates, but none had an opening-range row within 15 minutes. A generic latest-as-of join still finds prior rows: 364 within 24h and 91 older than 1 day. Median opening-range age at signal time was about 465 minutes, max about 4,200 minutes.

Root cause: default PIT joins `features_opening_range` by `MAX(ts) <= signal_ts`. That treats opening range as a generic state feature. It is not. Opening range is a session-scoped market object and must be joined by same symbol, timeframe, session name, session date, completion window, and validity window.

Long-term root fix:

1. Reclassify `features_opening_range` in the feature registry from generic `latest_as_of` to `session_scoped_event` or `session_state`.
2. Add/enforce DB columns: `session_date`, `session_name`, `range_start_ts`, `range_end_ts`, `valid_from_ts`, `valid_until_ts`, `range_minutes`, `source_tf`, `producer_version`.
3. Normalize session labels through the DB contract map; do not allow `NY`/`ny` drift between tables.
4. ORB joins must require same session/date and `valid_from_ts <= signal_ts < valid_until_ts`.
5. Strategy entry windows must start after `range_end_ts`.
6. Add parity tests where default PIT and compiler PIT must produce identical candidate IDs before promotion.

This is exactly the kind of skeleton issue that creates wrong-direction or fake-confidence entries. It is not an SL/TP problem.

#### New P0: `dataQuality = READY` Is Too Weak

Several reruns still reported READY while the system had stale/sparse state:

- `orb_classic`, `doyle_sd`, and `watukushay_no1` could run with READY even though ATR/spread/producers were stale or sparse.
- Candle coverage for XAUUSD 90d returned ratios around 119-125% and 5m gaps. That should not be a clean OK. A ratio above 100% means expected-bar math, broker-session handling, duplicate bars, weekend bars, or market-calendar assumptions need reconciliation.
- Producer ledger watermarks showed multiple state producers hundreds to thousands of minutes old.

Root fix: create one shared `runSystemHealthCheck()` for live, PIT, and promotion. It must combine candle coverage with upper/lower bounds, gap count, producer SLA, feature registry semantic type, feature density expectation, DB contract-map naming, and strict stale-state blocking. Replace the single READY/BLOCKED shape with `READY`, `DEGRADED_DATA`, `BLOCKED_MISSING_DATA`, `BLOCKED_STALE_STATE`, `BLOCKED_SEMANTIC_JOIN`, and `BLOCKED_COVERAGE`.

#### New P1: Audit Tools Need Hardening

- `scripts/check-feature-freshness.js` does not load `.env.local`; without `node -r dotenv/config` it reports DB auth failures instead of real feature health.
- The freshness script applies flat logic across dense state and sparse event features.
- `scripts/check-candle-coverage.js XAUUSD 90 1m,5m,15m,1h,4h,1d` breaks in PowerShell unless the timeframe list is quoted.

Root fix: all audit scripts should use the shared DB bootstrap, registry-driven thresholds, robust PowerShell-safe argv parsing, and distinct failure states for connection errors versus real feature failures.

#### Corrections To Keep The Report Honest

| Prior Claim | Current Classification |
|---|---|
| Plain `candles_1d` missing is itself a daily-data bug | Reclassified. The canonical source is `candles_1d_utc`; the real bug is any consumer that still expects plain `candles_1d`. |
| `market_levels` is a stale 3.3M-row table | Reclassified. Current DB has empty `market_levels`; `market_levels_view` is the intended direction. The pending work is enforcing consumers through the view and the DB contract map. |
| PIT compiler is validated | Reclassified. Compiler is the correct direction, but default/compiler parity is currently broken for ORB and must be treated as a promotion blocker. |

---

## Part 8: System Skeleton Architecture (moved)

The skeleton architecture — single time / market-data / event / lifecycle / direction truth, no-duplicate-truth, candidate snapshots, system-health gate, DB contract map, live↔backtest↔compiler parity, and promotion gates — has been promoted to its own living document:

→ **`reports/SYSTEM_SKELETON_ARCHITECTURE_2026-07-10.md`**

It consolidates the former Parts 8–10 of this report with a repo-wide audit pass (60 ledgered findings, `SK-01`…`SK-60`) and the current build state. **Strategy / gate-threshold tuning is frozen until its §7 acceptance bar holds.** This V3 report now retains only the investigation narrative (Parts 1–7).
