# 🔴 Backtest & Live Engine Failure Report — Post-Root-Fix Re-Investigation
**Date:** 2026-07-09T21:20 UTC  
**Scope:** All active strategies, XAUUSD 90d backtest + 7d live engine audit  
**Status:** CRITICAL — Multiple features broken at data layer

---

## Executive Summary

After root-cause fixes were applied, re-investigation reveals **3 data-layer catastrophes** that block backtest signal generation and degrade live trading. The fixes addressed logic bugs but the underlying feature data is stale/corrupt.

---

## 1. 🔴 CRITICAL: `features_ifvg.is_fresh = false` for ALL 217,389 rows

### Symptom
`smart_risk_ob_ifvg_1m` produces **0 signals** on XAUUSD 90d backtest. Previously generated ~12/day.

### Root Cause Chain
1. `refresh_ifvg_lifecycle()` last ran `2026-07-08T13:23Z` — **31+ hours stale**
2. The function only processes rows where `invalidated_at IS NULL`
3. **All 217,389 rows already have `invalidated_at` set** — many with `invalidated_at` occurring BEFORE `ts` (prior bug scar where invalidation was incorrectly backfilled)
4. Running `SELECT refresh_ifvg_lifecycle('XAUUSD', NOW(), '90 days', 100000)` returns **0 rows updated**
5. `is_fresh` stays `false` forever → entry filter `is_fresh = true` blocks everything

### Evidence
```
ifvg@5m total:      217,389 rows
is_fresh=true:      0 (ZERO)
is_fresh=false:     217,389 (100%)
fill_pct avg:       0.98 (data quality fine!)
lifecycle last run: 2026-07-08T13:23 (31h stale)
```

### Impact
- **smart_risk_ob_ifvg_1m**: 0 signals (entry filter requires `is_fresh = true`)
- All 6 smart_risk family variants: **DEAD**
- Live: only 1 smart_risk signal in 7 days (Jul 6 — before data went fully stale)

### Fix Required
- **Reset `invalidated_at` to NULL** for all ifvg rows where `invalidated_at < ts` (prior bug scars)
- **Re-run `refresh_ifvg_lifecycle`** on all symbols with full range
- **Schedule lifecycle refresh** as cron alongside backfill (currently NOT scheduled)
- Consider: add backfill step that runs lifecycle refresh after feature generation

---

## 2. 🟠 HIGH: `features_sweep@15m` has only 1 row in 90 days

### Symptom
Sweep detection at 15m is effectively dead. Only 1 sweep detected in 90 days of XAUUSD 1m candles.

### Evidence
```sql
SELECT COUNT(*) FROM features_sweep 
WHERE symbol='XAUUSD' AND tf='15m' AND ts >= NOW() - INTERVAL '90 days'
-- Result: 1
```

### Impact
- `smart_risk_ob_ifvg_1m` setup filter `htf_sweep` (weight 3, required=false) — never matches
- `keylevel_bounce_v1` sweep filters — non-functional
- Any strategy using sweep@15m as confirmation: degraded

### Likely Cause
- The sweep backfill logic at 15m is either too strict or has a bug in the time window
- Or: sweep table has no `is_fresh` column (confirmed — only has `mitigated_at`) so lifecycle refresh doesn't apply, but detection criteria are too narrow

---

## 3. 🟠 HIGH: `features_zone@1m retest_count` = 0 for all rows

### Symptom
Zone retest detection at 1m produces no retests. `retest_count > 0` returns 0 rows.

### Evidence
```sql
SELECT retest_count, COUNT(*) FROM features_zone 
WHERE symbol='XAUUSD' AND tf='1m' AND retest_count > 0
GROUP BY retest_count
-- Result: (empty — zero rows)
```

### Impact
- Any strategy using `zone_retest` as entry/confirmation: **dead feature**

---

## 4. 🟡 MEDIUM: `features_zone@5m` staleness causes 400+ rejections/week

### Symptom
Live engine logs 400+ `stale_features: features_zone@5m(Xmin)` rejections in 7 days.

### Evidence
```
stale_features: features_zone@5m(16.8min) — 60 rejections
stale_features: features_zone@5m(16.9min) — 51 rejections
stale_features: features_zone@5m(16.5min) — 46 rejections
stale_features: features_zone@5m(6.1min)  — 37 rejections
... (400+ total)
```

### Root Cause
Live runner's `maxAgeMinutes = 5` for all features. Zone data at 5m arrives at irregular intervals (5-17 min), exceeding the 5-min staleness threshold.

### Impact
- **60-80% of potential signals rejected** by staleness gate
- Affected strategies: `pb_blake_2026_smc`, `waqar_v2`, `lewis_kelly_smc_ny_shorts`, `scarface_5m_orb`, `a_plus_orb_fvg_5m`

### Fix Options
- Increase `maxAgeMinutes` for zone features to 20 min
- Or: make staleness per-feature configurable
- Or: run zone backfill more frequently

---

## 5. 📊 Live Engine 7-Day Stats

| Metric | Value |
|--------|-------|
| Total signals generated | **4** |
| Total rejections | **8,379** |
| Top rejection: `no_signal` | 630 |
| Top rejection: `volatility_gate` | 390 |
| Top rejection: `stale_features` | ~450 |
| Top rejection: `setup_blocked` (spread) | ~180 |
| Smart_risk signals | 1 (Jul 6 only) |
| Non-smart_risk signals | 3 (pb_blake, waqar_v2, lewis_kelly) |

### Signal Detail
| Date | Strategy | Symbol | Side |
|------|----------|--------|------|
| Jul 9 09:03 | pb_blake_2026_smc | EURUSD | Buy |
| Jul 8 09:03 | waqar_v2 | AUDUSD | Sell |
| Jul 8 07:02 | lewis_kelly_smc_ny_shorts | EURUSD | Sell |
| Jul 6 04:45 | smart_risk_ob_ifvg_1m | XAUUSD | Sell |

---

## 6. Backtest Summary (XAUUSD, 90 days, fast mode)

| Strategy | Signals | Executed | Wins | Losses | Net R | WR |
|----------|---------|----------|------|--------|-------|-----|
| smart_risk_ob_ifvg_1m | **0** | 0 | 0 | 0 | 0 | — |
| keylevel_bounce_v1 | 1 | 0 | 0 | 0 | 0 | — |

- keylevel_bounce_v1: 1 signal, blocked by `session` gate (outside London/NY/Overlap window)

---

## 7. 🔧 Required Actions (Priority-Ordered)

### Immediate (blocking)
1. **Fix ifvg freshness:** Reset `invalidated_at` for bug-scarred rows, re-run lifecycle refresh
2. **Add lifecycle refresh to backfill pipeline:** After `backfill-historical-features.js`, run lifecycle refresh on all feature tables
3. **Schedule cron:** `refresh_ifvg_lifecycle`, `refresh_zone_lifecycle`, etc. every 5-15 minutes

### High Priority (degraded features)
4. **Debug sweep@15m:** Only 1 row in 90 days — detection criteria too strict or buggy
5. **Debug zone_retest@1m:** Zero retests detected — possibly same root cause as sweep
6. **Fix zone@5m staleness:** Increase `maxAgeMinutes` from 5 to 20 for zone features

### Medium Priority
7. **Clean up invalidated_at bug scars:** Any feature row with `invalidated_at < ts` is corrupted
8. **Add data integrity checks:** Assertion that `is_fresh = true` rows exist post-backfill
9. **Alert on lifecycle staleness:** If `last_processed_ts` > 30 min ago, trigger alert

---

## 8. Codex Re-Audit Addendum - July 9, 2026

This section was added after a fresh manual audit of the live runner, setup engine, PIT backtester, strategy compiler, and current database state. The V2 report is broadly correct on the feature-data failures, but several important nuances and additional bugs surfaced.

### 8.1 Current Status Corrections

#### HTF candle coverage has improved since the previous report

The older catastrophic HTF-candle issue is no longer the top blocker for XAUUSD. Physical candle rows now look materially better:

| Table | 90d Rows | First Row | Last Row | Current Read |
|---|---:|---|---|---|
| `candles_1m` | 84,691 | 2026-04-12 22:01 UTC | 2026-07-09 20:54 UTC | Source coverage is usable |
| `candles_5m` | 16,962 | 2026-04-12 22:00 UTC | 2026-07-09 20:50 UTC | Much improved |
| `candles_15m` | 5,673 | 2026-04-12 22:00 UTC | 2026-07-09 20:45 UTC | Much improved |
| `candles_1h` | 1,422 | 2026-04-12 22:00 UTC | 2026-07-09 20:00 UTC | Much improved |

This does not mean the candle architecture is solved. It means the present zero-signal issue is now more strongly concentrated in feature lifecycle, event scarcity, freshness gating, and runner wiring.

#### `features_ifvg` is still broken even after XAUUSD lifecycle state moved forward

The report says `refresh_ifvg_lifecycle()` last ran on July 8. Current `lifecycle_refresh_state` now shows XAUUSD at `2026-07-09T21:14:07.596Z`, but the table is still unusable:

| TF | Total | Fresh | Stale | Invalidated | `invalidated_at < ts` |
|---|---:|---:|---:|---:|---:|
| `5m` | 217,389 | 0 | 217,389 | 217,389 | 216,723 |
| `15m` | 36,414 | 0 | 36,414 | 36,414 | 36,239 |
| `1h` | 4,657 | 0 | 4,657 | 4,657 | 4,620 |
| `4h` | 772 | 0 | 772 | 772 | 762 |
| `1d` | 74 | 0 | 74 | 74 | 71 |

That means a refresh alone is insufficient. The invalidation scars must be corrected first, then lifecycle can be recomputed.

#### Sweep and retest failures are confirmed

Current XAUUSD 90-day counts:

| Feature | TF | Rows |
|---|---:|---:|
| `features_sweep` | `15m` | 1 |
| `features_sweep` | `5m` | 129 |
| `features_zone_retest` | `1m` | 0 |
| `features_zone_retest` | `5m` | 371,449 |
| `features_zone_retest` | `15m` | 3,225 |
| `features_zone.retest_count > 0` | `1m` | 0 |

The issue is not simply "zone retests do not exist"; they exist at 5m and 15m but not 1m. Specs that require 1m retests are misaligned with the feature generator.

### 8.2 Fresh Backtest Evidence

Fresh fast-mode runs confirm the V2 report's headline:

| Command | Bias | Setup | Entry | Raw Signals | Final Result |
|---|---:|---:|---:|---:|---|
| `node scripts/backtest-pit-v2.js XAUUSD 90 smart_risk_ob_ifvg_1m --json --debug --mode=fast` | 1,745 | 1,056 | 0 | 0 | Entry killed by iFVG/freshness path |
| `node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v1 --json --debug --mode=fast` | 1,508 | 289 | 1 | 1 | 1 skipped by session gate |

For `smart_risk_ob_ifvg_1m`, the entry collapse is consistent with `features_ifvg@5m` having 217,389 rows but zero fresh rows.

For `keylevel_bounce_v1`, the pipeline can now reach one raw signal, but the strategy remains too sparse and is finally blocked by session gating.

### 8.3 Additional Bugs Found

#### BUG #4A: The new feature registry exists but is not fully wired into live freshness

`packages/strategies/src/featureRegistry.ts` now defines semantic types, join policies, and timeframe-aware freshness windows. This is the correct architectural direction.

However, `packages/tradePipeline/src/liveRunner.ts` still uses:

```ts
const EVENT_FEATURES = new Set([
  "features_structure",
  "features_order_block",
  "features_ifvg",
  "features_sweep",
]);

const maxAgeMinutes = 5;
```

So the live runner is not yet consuming the registry's `defaultFreshnessMinutesByTf`, nor its `semanticType`.

**Impact:** The codebase now has a better contract, but live rejection behavior still follows the old hardcoded freshness model.

**Fix:** Replace `EVENT_FEATURES` and `maxAgeMinutes = 5` with `getFeatureContract(featureName)` and `getDefaultFreshnessMinutes(featureName, tf)`.

#### BUG #4B: Candle coverage infrastructure exists but migration is not applied

The repo now has `packages/shared/src/candles/candleSource.ts` and migration `infra/migrations/100_candle_coverage_and_cagg_refresh.sql`. This is the right design: use materialized HTF candles when coverage is good, otherwise roll up from `candles_1m`.

But running:

```bash
node scripts/check-candle-coverage.js XAUUSD 90 5m,15m,1h
```

failed with:

```text
relation "candle_coverage" does not exist
```

**Impact:** The coverage tooling cannot persist or report coverage metadata until migration 100 is applied. Backtest preflight still falls back to row-count checks and can miss low-ratio or gappy data.

**Fix:** Run migrations, then wire `checkCoverage()` in `scripts/backtest-pit-v2.js` to `checkCandleCoverage()` instead of raw row counts.

#### BUG #4C: Backtest modes exist, but there is no true `research` mode

The V2 report calls the current run "fast mode." The runner currently supports:

```text
fast, full, deterministic
```

It does not support `research`; attempting `--mode=research` fails.

**Impact:** We still do not have a clean mode that means "raw strategy edge only, no generic setup engine, no live gates." Fast mode skips setup evaluation, but it still applies strategy gates after simulation. That is useful, but it is not a pure research backtest.

**Fix:** Add explicit modes:

| Mode | Setup Engine | Live Gates | Execution Costs | Purpose |
|---|---|---|---|---|
| `research` | off | off | configurable | Measure raw strategy edge |
| `costed` | off | off | on | Measure spread/slippage sensitivity |
| `safety` | optional | on | on | Model live feasibility |
| `full` | strict | on | on | Current conservative path |

#### BUG #4D: Compiler/runner drift is partially improved but not eliminated

`scripts/backtest-pit-v2.js` now has a `USE_COMPILER_SQL` path that calls:

```js
compileStrategy(spec, { mode: "pit", from, to, symbol, debug })
```

That is a good step. But the legacy fork is still present, and the runner still carries its own `translatePredicate`, `buildFreshnessPredicate`, `pitLookbackInterval`, signal-source SQL builders, raw preflight logic, and coverage target collection.

**Impact:** Bugs can still reappear whenever the env/config falls back to the legacy path or when preflight/gates use semantics different from compiled SQL.

**Fix:** Delete the legacy SQL fork after parity tests pass. Keep only one strategy compiler path.

#### BUG #4E: Signal SQL still uses `MAX(ts)` joins for several state features

Both compiler and runner paths still contain `MAX(ts)` joins for pricing, ATR, opening range, indicators, and moving averages in final signal select branches.

`MAX(ts)` is acceptable for true state snapshots if the row is fresh and the predicate is not trying to select a candidate. It is risky for `features_pricing`, because pricing is used as a directional filter and candidate condition. The previous report's pricing issue remains partially relevant.

**Fix:** Treat pricing as `candidate_set`, not simple `latest_as_of`, wherever predicate direction matters. The registry already marks `features_pricing` as `candidate_set`; final signal branches should use that contract too.

#### BUG #4F: `is_fresh` predicates are unsafe for PIT backtests

The iFVG failure shows why static `is_fresh` flags are dangerous in PIT:

- `is_fresh` is current-state, not necessarily point-in-time state.
- historical lifecycle scars can make all rows false forever.
- a backtest should reason from `invalidated_at`, `mitigated_at`, `valid_from`, and `valid_until` as of the candidate timestamp.

**Fix:** Strategy predicates should avoid `is_fresh = true` for PIT unless the compiler translates it into PIT lifecycle semantics. Use as-of lifecycle windows instead.

#### BUG #4G: Live staleness can also be caused by market-data ingestion lag

Current live ages at audit time:

```text
candles_1m:           29.2 minutes old
features_atr@15m:     38.2 minutes old
features_pricing@15m: 38.2 minutes old
features_zone@5m:     48.2 minutes old
features_sweep@15m:   20,528 minutes old
```

This is not just a per-feature threshold problem. The raw 1m feed itself was stale by almost 30 minutes at audit time.

**Fix:** Add a top-level market-data heartbeat and distinguish `stale_market_data`, `stale_state_feature`, `missing_event_feature`, and `missing_lifecycle_refresh`.

### 8.4 Root Cause Clarification

The current failure stack is:

```text
No usable backtest/live throughput
|
+-- Data scars
|   +-- features_ifvg invalidated_at before ts
|   +-- is_fresh false for all iFVG rows
|
+-- Feature generator gaps
|   +-- sweep@15m nearly empty
|   +-- zone_retest@1m empty despite 5m/15m retests
|
+-- Lifecycle orchestration gaps
|   +-- refresh states stale for many symbols/tables
|   +-- refresh functions cannot repair bug-scarred rows
|
+-- Runtime gate semantics
|   +-- live freshness still hardcoded at 5 minutes
|   +-- event/level/state semantics not fully consumed by live runner
|   +-- setup engine still generic rather than strategy-family aware
|
+-- Tooling gaps
    +-- candle_coverage migration missing
    +-- preflight still row-count based
    +-- no pure research mode
```

### 8.5 Upgrade Plan

#### P0 - Repair data and restore signal flow

1. Quarantine iFVG rows where `invalidated_at < ts`.
2. Reset only provably corrupt `invalidated_at`, `mitigated_at`, and `is_fresh` values.
3. Re-run iFVG lifecycle for all symbols/timeframes from the original source candles.
4. Re-run `smart_risk_ob_ifvg_1m` in `fast` and `full` modes and compare stage counts.
5. Backfill or spec-shift away from `features_sweep@15m` and `features_zone_retest@1m` until those generators are fixed.

#### P1 - Wire existing architecture into runtime

1. Apply migration `100_candle_coverage_and_cagg_refresh.sql`.
2. Change backtest preflight to use `checkCandleCoverage()`.
3. Change setup engine candle reads to use `getLatestCandle()` from `candleSource.ts`.
4. Change live freshness checks to use `featureRegistry`.
5. Remove or disable static `is_fresh` predicates in PIT mode.

#### P2 - Improve strategy research quality

1. Add `--mode=research`.
2. Persist `strategy_signal_candidates` for accepted and rejected candidates.
3. Save feature snapshots with every live signal and every backtest candidate.
4. Report stage counts as `bias -> setup -> entry -> raw signal -> valid geometry -> filled -> costed -> gate-approved -> portfolio-approved`.

#### P3 - Algorithm improvements

1. Rebuild sweep detection with wick-through plus close-back-inside confirmation.
2. For 15m sweeps, derive from confirmed session/PDH/PDL/equal-high-low levels, not arbitrary micro pivots.
3. Rebuild zone retest as an event stream independent of `features_zone.retest_count`.
4. For iFVG, separate raw FVG, inversion event, retest state, and invalidation state into separate lifecycle transitions.
5. Add symbol-normalized thresholds using ATR and pip value. XAUUSD, USDJPY, and EURUSD should not share raw thresholds.

### 8.6 Validation Commands

After fixes, these commands should be required before promoting any strategy:

```bash
pnpm db:migrate
node scripts/check-candle-coverage.js XAUUSD 90 5m,15m,1h
node scripts/backfill-historical-features.js XAUUSD 1d,4h,1h,15m,5m
node scripts/refresh-lifecycle.js
node scripts/backtest-pit-v2.js XAUUSD 90 smart_risk_ob_ifvg_1m --json --debug --mode=fast
node scripts/backtest-pit-v2.js XAUUSD 90 smart_risk_ob_ifvg_1m --json --debug --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v1 --json --debug --mode=fast
```

Expected minimum health checks:

```text
features_ifvg@5m fresh > 0
features_ifvg invalidated_at < ts = 0
features_sweep@15m materially above 1 row / 90d
features_zone_retest@1m either populated or removed from specs
live_signal_rejection stale_features split into explicit root causes
backtest preflight reports coverage ratios and data-quality status
```

---

## 9. Long-Lasting Root Cause Fixes

The fixes above restore broken rows and unblock immediate backtests, but they are not sufficient. The durable solution is to make the engine impossible to run on undefined feature semantics, stale market data, corrupt lifecycle state, or divergent live/backtest SQL.

### 9.1 Establish Feature Contracts as Database-Enforced Truth

The repo now has `packages/strategies/src/featureRegistry.ts`, but this is still mostly an application-level contract. Long term, every feature table needs matching database constraints, generated checks, and audit queries.

**Root cause:** Feature tables evolved independently. Some are state snapshots, some are events, some are lifecycle levels, but the DB does not enforce those differences.

**Permanent fix:**

1. For every `features_*` table, define a formal contract:

```text
semantic_type: state | event | level | distribution
join_policy: latest_as_of | candidate_set | active_window | sample_distribution
required_columns
validity_columns
freshness_policy
expected_density
allowed_timeframes
producer_job
```

2. Generate both TypeScript registry entries and SQL assertions from the same source.
3. Add DB constraints for impossible lifecycle states:

```sql
CHECK (invalidated_at IS NULL OR invalidated_at >= ts)
CHECK (mitigated_at IS NULL OR mitigated_at >= ts)
CHECK (bottom <= top)
CHECK (tf IN ('1m','5m','15m','1h','4h','1d'))
```

4. Add a migration-time contract test that fails if a feature table is missing required columns.

This prevents another `features_ifvg.invalidated_at < ts` scar from silently poisoning all rows.

### 9.2 Replace Mutable `is_fresh` With Point-in-Time Lifecycle Windows

**Root cause:** `is_fresh` is a mutable current-state flag. Backtests need to know whether a feature was valid at a historical candidate timestamp, not whether it is fresh now.

**Permanent fix:**

Use lifecycle windows:

```text
formed_at
detected_at
valid_from
valid_until
first_touch_at
mitigated_at
invalidated_at
lifecycle_state
lifecycle_version
```

Backtests should query:

```sql
valid_from <= candidate_ts
AND (valid_until IS NULL OR valid_until > candidate_ts)
AND (invalidated_at IS NULL OR invalidated_at > candidate_ts)
```

Live analysis can still derive a convenient current `is_fresh` view, but specs should not depend on static `is_fresh = true` in PIT mode.

### 9.3 Make Lifecycle Refresh Idempotent, Rebuildable, and Auditable

**Root cause:** Lifecycle refresh functions update current rows, but they cannot reliably repair corrupted historical state. If bad invalidation data is written once, future refreshes skip or preserve the scar.

**Permanent fix:**

1. Split lifecycle into two jobs:

```text
detect_raw_events -> immutable event rows
derive_lifecycle -> reproducible state transitions
```

2. Store lifecycle transitions separately:

```text
feature_lifecycle_events(
  source_table,
  source_id,
  symbol,
  tf,
  event_type,
  event_ts,
  observed_candle_ts,
  price,
  reason,
  producer_version
)
```

3. Rebuild lifecycle state from raw events and candles, not from previously mutated lifecycle columns.
4. Store `producer_version` and `source_hash`; force rebuild when code changes.
5. Add a daily invariant check:

```text
invalidated_before_formed = 0
mitigated_before_formed = 0
fresh_and_invalidated_now = 0
open_level_without_validity = 0
```

This turns lifecycle from a fragile mutable flag system into a replayable ledger.

### 9.4 Use One Strategy Compiler for Live and Backtest

**Root cause:** Live and PIT paths have historically duplicated SQL generation. Even with recent `USE_COMPILER_SQL`, the old fork still exists and preflight/gates still use separate semantics.

**Permanent fix:**

Delete the legacy SQL compiler path after parity tests pass. The only supported interface should be:

```ts
compileStrategy(spec, {
  mode: "live" | "pit" | "research",
  symbol,
  from,
  to,
  asOf,
})
```

Compiler output should include:

```text
signal_sql
coverage_requirements
feature_contracts_used
candidate_stage_sql
feature_snapshot_select
```

The backtester should not know how to join feature tables. It should only execute compiler output, simulate fills, and report stages.

### 9.5 Promote Data Quality From Warning to Gate

**Root cause:** The backtest runner warns only on zero rows. Sparse data, stale features, and broken lifecycle can still produce a normal-looking zero-trade result.

**Permanent fix:**

Backtest preflight must return one of:

```text
READY
DEGRADED_ALLOWED
BLOCKED_DATA_QUALITY
BLOCKED_SCHEMA_CONTRACT
BLOCKED_LIFECYCLE_CORRUPTION
```

Hard blocks:

```text
candle coverage ratio < 0.98
required state feature coverage below threshold
required event feature impossible: 0 rows when spec requires it
lifecycle corruption detected
feature producer stale beyond SLA
missing migration/table/contract
```

Do not show `0 trades, 0% WR` when the real result is `BLOCKED_DATA_QUALITY`.

### 9.6 Build a Feature Producer SLA System

**Root cause:** There is no authoritative answer to “which job should have produced this feature, how often, and did it run?”

**Permanent fix:**

Create `feature_producer_runs`:

```text
run_id
feature_table
symbol
tf
producer_name
producer_version
source_min_ts
source_max_ts
rows_seen
rows_inserted
rows_updated
rows_invalidated
error_count
started_at
finished_at
status
quality_json
```

Every feature table should have a declared SLA:

```text
features_spread@1m: max_age 2m
features_session@1m: max_age 2m
features_pricing@15m: max_age 20m
features_zone@5m: max_age 20m or active-window based
features_sweep@15m: event sparse, producer must run every 15m
```

Live runner should reject with `producer_stale` when the producer is stale, and `no_recent_event` only when the producer is healthy but no event exists.

### 9.7 Separate Research, Safety, and Live Execution

**Root cause:** Current backtests mix strategy edge, generic setup grading, spread/volatility gates, session gates, and portfolio heat. This makes it unclear whether the strategy is bad or the execution layer blocked it.

**Permanent fix:**

Implement true modes:

| Mode | What It Answers |
|---|---|
| `research` | Does the raw strategy logic have edge? |
| `costed` | Does the edge survive spread/slippage/fill rules? |
| `safety` | Would live gates allow these trades? |
| `portfolio` | Does the strategy survive account-level risk limits? |
| `live` | Should an order be submitted now? |

Every report should show the full waterfall:

```text
raw candidates
setup candidates
entry candidates
raw signals
valid risk geometry
filled orders
cost-adjusted outcomes
safety-approved
portfolio-approved
```

### 9.8 Make Setup Engine Strategy-Family Aware

**Root cause:** The setup engine applies zone-centric hard rules to every strategy. ORB, FVG continuation, indicator, and moving-average strategies should not all require the same zone conditions.

**Permanent fix:**

Add `setupProfile` or `strategyArchetype`:

```yaml
strategyArchetype: orb_breakout | zone_reversal | fvg_continuation | trend_pullback | indicator_signal
```

Then map hard rules by archetype:

| Archetype | Required Context |
|---|---|
| `zone_reversal` | valid zone, pricing location, retest/confirmation |
| `orb_breakout` | session range, displacement, breakout side, range size |
| `fvg_continuation` | FVG geometry, displacement source, fill/retest rules |
| `trend_pullback` | trend regime, pullback depth, continuation trigger |
| `indicator_signal` | indicator state, volatility, risk geometry |

This prevents the setup engine from killing valid non-zone strategies.

### 9.9 Rebuild Weak Feature Algorithms Instead of Loosening Specs

Spec changes should not hide broken detectors. The generator must be fixed when feature behavior is implausible.

#### Sweep detector

A durable sweep detector should:

```text
identify target liquidity level
require wick penetration beyond level
require close back inside level
measure rejection strength
classify target_type: PDH, PDL, session high/low, equal highs/lows, swing high/low
score by penetration, close location, displacement after sweep
```

`features_sweep@15m = 1 row / 90d` is not a spec problem; it is an algorithm or source-window problem.

#### Zone retest detector

A durable retest detector should be event-based:

```text
zone_id
touch_ts
touch_type: wick | body | close_inside | rejection | engulf
touch_depth_pct
reaction_r
invalidated_after_touch
```

Do not rely only on `features_zone.retest_count`. Store retests as their own immutable events and derive counts from them.

#### iFVG detector

A durable iFVG model should separate:

```text
raw_fvg_formed
fvg_touched
fvg_invalidated
fvg_inverted
ifvg_retested
ifvg_invalidated
```

Each transition should have its own timestamp and source candle evidence. One mutable row cannot safely encode the whole lifecycle.

### 9.10 Add Promotion Gates Before Any Strategy Goes Live

No strategy should be promoted unless these checks pass:

```text
schema contracts pass
candle coverage pass
producer SLA pass
lifecycle invariants pass
feature density sanity pass
research backtest pass
costed backtest pass
walk-forward pass
live dry-run trace pass
```

Minimum promotion report:

```text
candidate count >= expected minimum
raw WR and costed WR separately reported
no-fill rate reported
gate rejection distribution reported
feature snapshot reproducibility confirmed
top 20 rejected candidates sampled and explained
```

This is the long-term guardrail that stops broken data from being mistaken for a broken strategy, and stops a weak strategy from being rescued by accidental filters.

---

## 10. Root Cause Map

```
No signals in backtest
├── ifvg@5m: is_fresh=false for ALL rows
│   ├── refresh_ifvg_lifecycle() never scheduled
│   └── invalidated_at bug scars block re-processing
├── sweep@15m: 1 row in 90 days
│   └── Detection threshold too strict / logic bug
└── zone_retest@1m: 0 retests
    └── Detection logic bug

Live signals strangled
├── stale_features: zone@5m (400+/week)
│   └── maxAgeMinutes=5 too strict for 5m zone refresh
├── volatility_gate (390/week)
│   └── Expected during news — but 5% of all ticks
└── no_signal (630/week)
    └── Signal query returns empty — same data issues as backtest
```

---

*Report generated by automated re-investigation after root-fix deployment.*

---

## 11. P0 Execution Log — 2026-07-09

This section records what was actually changed during the P0 pass and the measured
before/after, so the audit trail is reproducible.

### 11.1 iFVG lifecycle scar repair + invariants (DONE)

- Migration `infra/migrations/101_ifvg_scar_repair_and_lifecycle_invariants.sql` applied.
- Repaired backward-lifecycle scars: `invalidated_at < ts` (564,216 rows) and
  `mitigated_at < ts` (92,819 rows) → both 0 after repair (`is_fresh` reset to true
  only where the scar had falsely cleared it).
- Added CHECK constraints so the corruption cannot silently recur: `ifvg_geometry`,
  `ifvg_inv_after_ts`, `ifvg_mit_after_ts`, `ob_inv_after_ts`, `zone_inv_after_ts`.
- Result: `smart_risk_ob_ifvg_1m` went from **0 → 564 raw signals** (fast mode,
  XAUUSD 90d). `dataQuality: "READY"`, `lifecycleCorruption: []`.

### 11.2 🔴 Volatility-gate unit defect was the real remaining blocker (DONE)

After the data repair, **all 564 signals were still skipped by the volatility gate**.
Root cause is a **unit mismatch between the strategy specs and the gate**, not bad data:

- The gate (`packages/tradePipeline/src/gates/volatilityGate.ts`) is pip-aware: it
  converts raw ATR with `getRegistryPipSize(symbol)` and compares against
  `maxAtr5Pips` / `minAtr5Pips` (correct).
- The spec values were **authored in price units**, not pips. `smart_risk_ob_ifvg_1m`
  set `maxAtr5Pips: 3.0`. On XAUUSD (`pipSize = 0.1`), 3.0 price-units == **30 pips**,
  but the gate read it as **3 pips**.
- XAUUSD 5m ATR5 over 90d: min **9.18**, median **46.8**, p90 **83**, p95 **100.7**
  pips (max 16,431 is a bad tick). A 3-pip ceiling is below the observed floor, so it
  blocked **100%** of bars.

**Fix (root, not bandaid):** preserve the authored numeric intent with correct units.
`3.0` price-units × (1 / pipSize 0.1) = **30 pips**.

```yaml
# packages/strategies/src/specs/smart_risk_ob_ifvg_1m.yaml
- id: volatility_gate
  name: volatility
  params:
    maxAtr5Pips: 30.0   # was 3.0 (price-units misread as pips)
```

Re-seeded with `node scripts/seed-strategy-specs.js` so YAML ↔ `strategy_families.
base_spec` ↔ live agree (the legacy `strategy_specs.spec_json` still held the even
older `maxAtr5: 3` key, which the gate ignored entirely — a latent live no-op).

**Measured result (XAUUSD 90d, fast mode):**

| Metric | Before | After |
|---|---|---|
| Raw signals | 564 | 564 |
| Volatility-gate skips | 564 (100%) | 536 |
| Executed trades | 0 | 20 |
| Heat dropped | 0 | 8 |
| Wins / Losses | — | 15 / 5 |
| Win rate | — | 75.0% |
| Net R | — | +16.87 |

The low-volatility filter now does what it was designed to do — trade only the calmest
in-session bars — instead of silently nullifying the strategy.

### 11.3 Correction to §10 Root Cause Map

`volatility_gate (390/week)` is **not** "expected during news". It is the live symptom
of the same unit defect (a sub-5-pip ceiling against a ~47-pip median ATR). After
re-seed, live volatility rejections for XAUUSD specs should drop to the small fraction
of genuinely high-volatility bars.

### 11.4 ✅ Systemic volatility-gate audit — RESOLVED (data-driven, not blanket-edited)

`scripts/audit-volatility-gates.js` (new, kept as the durable guardrail / §9.10 promotion
check) computes each active spec's `maxAtr5Pips` against its symbol's 90d ATR5
(pips, tf=5m) and classifies the ceiling as INSANE (≤ p05, blocks ≥95% of bars) /
TIGHT (p05–median) / OK (median–p95) / LOOSE (> p95). Result:

| Spec | Symbol | `maxAtr5Pips` | p05 / p50 / p95 | Class | Action |
|---|---|---:|---:|---|---|
| `pb_blake_2026_smc` | XAUUSD* | 5 → **50** | 23.9 / 46.8 / 100.7 | was INSANE → **OK** | fixed |
| `xauusd_v1` | XAUUSD | 3 → **30** | 23.9 / 46.8 / 100.7 | was INSANE → **TIGHT** | fixed |
| `smart_risk_ob_ifvg_1m` | XAUUSD | 3 → **30** | 23.9 / 46.8 / 100.7 | was INSANE → **TIGHT** | fixed (§11.2) |
| `watukushay` | EURUSD | 3 | 1.1 / 2.6 / 5.8 | OK | none (sane) |
| `forex_strategy_orb` | EURUSD | 2.5 | 1.1 / 2.6 / 5.8 | TIGHT | none (legit low-vol filter) |
| `orb_classic` | EURUSD | 2.5 | 1.1 / 2.6 / 5.8 | TIGHT | none |
| `scarface_5m_orb` | EURUSD | 1.5 | 1.1 / 2.6 / 5.8 | TIGHT | none (still > p05) |
| `doyle_sd` | EURUSD | 800 | 1.1 / 2.6 / 5.8 | LOOSE | none (deliberate no-op cap) |

\* `pb_blake_2026_smc` is multi-symbol (XAUUSD/EURUSD/GBPUSD); a single ceiling cannot
fit gold and fx. 50 pips is a sane high-vol cap for gold and a harmless no-op for fx
(their p95 ≈ 6). A per-symbol ceiling in the gate is the cleaner long-term fix.

**Key correction:** the small numbers (1.5–3) on the EURUSD specs were *not* unit bugs —
for fx (pipSize 0.0001, ATR5 ≈ 1–6 pips) they are sane. The defect manifests **only on
XAUUSD** (pipSize 0.1 → ATR5 ≈ 24–100 pips), where price-unit ceilings were misread as
pips. So the fix was precisely scoped to the three XAUUSD specs, each re-derived as
authored-price-units × 10 (= ÷pipSize 0.1) and re-seeded.

**Result:** `0` INSANE specs remain. Re-run `node scripts/audit-volatility-gates.js`
anytime as the guardrail; it should be added to the §9.10 promotion gate so a sub-p05
ceiling fails loudly instead of silently producing zero trades.

Note: `xauusd_v1` still reports "no signals" in fast mode — that is an *upstream*
(setup/detector) cause, not the volatility gate (the audit confirms the ceiling is now
non-blocking, so signals would not be vol-blocked if produced). Tracked under P2/P3.

### 11.5 Migration 100 (candle coverage) — TimescaleDB 2.27 API fix (DONE)

`infra/migrations/100_candle_coverage_and_cagg_refresh.sql` failed to apply on this
host with `function remove_continuous_aggregate_policy(text, integer) does not exist`.
The migration used the deprecated two-argument `(cagg_name text, job_id int)` form;
TimescaleDB 2.27.2 only exposes `remove_continuous_aggregate_policy(continuous_aggregate
regclass, if_exists boolean)`.

**Fix (root):** rewrote the cagg block to call the 2.x API directly —
`remove_continuous_aggregate_policy(cagg_name::regclass, if_exists => true)` then
`add_continuous_aggregate_policy(..., if_not_exists => true)` — dropping the
`timescaledb_information.jobs` lookup entirely. The table DDL was unchanged.

Applied cleanly:
- `candle_coverage(symbol, tf, source_min_ts, source_max_ts, expected_rows, actual_rows,
  coverage_ratio, has_gaps, refreshed_at)` created → `check-candle-coverage.js` no
  longer fails on a missing table.
- The six cagg refresh policies (`candles_5m/15m/1h/4h/1d_utc/1d_ny`) were recreated
  with a 1–3 year `start_offset` so research windows stay warm (real-time aggregation
  still fills any gaps on read, so this is a warmth/perf change, not correctness).

Coverage check (XAUUSD 90d) now reports ~65–66% via the fallback rollup with
`gaps=true`. This ratio is dominated by the XAUUSD trading calendar (~23h × 5d ≈ 68%
of a 24/7 grid), i.e. weekend/illiquid hours, not ingestion holes — the backtest's
context builder rolls up from dense `candles_1m` regardless, so this is not a P0
blocker.

### 11.6 Lifecycle checkpoint note

The XAUUSD full lifecycle re-derive (`refresh-lifecycle.js ... 120 1000`) was stopped
after ~32 min / 21 iterations: the script deletes `lifecycle_refresh_state` for the
symbol and re-scans the whole lookback (≈430k iFVG rows for 120d → ~30h projected).
That is a full-rebuild tool for producer-version changes, not routine maintenance, and
is **not required for P0 correctness**:

- migration 101 already repaired the only corrupted table (`features_ifvg`) and added
  invariants to all five;
- `features_zone` / `features_order_block` had **0** invalidation scars (verified
  during 101), so their lifecycle columns are already correct;
- the deleted per-table checkpoints are rebuilt automatically by the normal
  incremental refresh path (each `refresh_*_lifecycle` call inserts the state row and
  advances `last_processed_ts`).

A bounded 30-day refresh (`refresh-lifecycle.js XAUUSD 30 500`) is sufficient to
re-establish checkpoints for the recent window; older rows keep their already-correct
post-101 values. Full re-derives should be reserved for `producer_version` bumps.

### 11.7 P1 — featureRegistry wired into the live runner (DONE)

BUG #4A (registry not wired into live freshness) + BUG #4G (market-data lag vs feature
staleness) closed.

**Root cause:** `packages/tradePipeline/src/liveRunner.ts::checkFeatureFreshness` used a flat
`maxAgeMinutes = 5` against `MAX(ts)` for every required feature. Levels (zones/OBs/iFVGs)
persist for hours after they form, so a 15m zone older than 5 min was always flagged
`stale_features` — the category error behind the 400+/week live rejections (§4, §11.3).

**Fix (root, not bandaid):** the freshness guard is now semantic-aware, driven by the feature
registry (single source of truth):

- `state`/`distribution` (`latest_as_of`/`sample_distribution`) — bias/atr/session/spread/
  pricing: `MAX(ts)` must be within the per-tf window (`getDefaultFreshnessMinutes`); else
  `stale_state_feature`.
- `event` (`candidate_set`) — structure/sweep/displacement: sparse by design; the guard never
  blocks on the last-event row (eligibility tracks market data via the 0a heartbeat).
- `level` (`active_window`) — zone/ifvg/order_block/pivot/liquidity: data-fresh if the level
  engine wrote within a lookback-scaled window (`defaultLookbackBars × tfMinutes`, e.g. 15m
  zone → 96×15 = 1440 min). A 2-hour-old zone is no longer "stale". Absence of an *active*
  level stays a setup condition (`setup_blocked`/`no_signal`), not a staleness rejection.

The rule lives in a pure, exported `evaluateFeatureFreshness()` helper; `checkFeatureFreshness`
is a thin orchestration loop.

**Heartbeat (0a) is now tf-aware:** checks `candles_1m` plus the strategy's entry tf against a
per-tf threshold (`1m:10, 5m:15, 15m:25, 1h:75, 4h:300, 1d:1500`), emitting `stale_data`
(market-data lag) distinctly from `stale_state_feature` (dead feature engine).

**Packaging fixes (so the registry is actually importable):**
- `@tm/strategies` root now exports `FEATURE_REGISTRY`, `getFeatureContract`,
  `isEventFeature`/`isLevelFeature`/`isStateFeature`, `getDefaultFreshnessMinutes`,
  `getDefaultLookbackBars`, and the contract types (previously only compiler/loader were
  re-exported, so tradePipeline could not consume the registry).
- Added the missing `features_spread` contract and `validityColumns` for
  `features_sweep`/`features_structure` (matched sqlBuilder's hardcoding).
- `@tm/trade-pipeline` now depends on `@tm/strategies` (`workspace:*`).

**Validation:**
- New `packages/tradePipeline/src/checkFeatureFreshness.test.ts` (9 cases) — state per-tf
  boundary, event-never-blocks, level lookback window (a 2h-old zone passes; the 5-min bug is
  gone), `features_spread` registered, unknown-feature pass-through.
- `pnpm test` (workspace) green: engine 79, setupEngine 6, analyzerBacktest 21, tradePipeline
  66 (incl. the 9 new + the 5 pre-existing liveRunner tests, still passing), web 5.
- `pnpm -F @tm/strategies build` and `pnpm -F @tm/trade-pipeline build` clean (TS strict).

Reason taxonomy now emitted (all via `logSignalRejection` → `live_signal_rejection`):
`stale_data:` (market data, tf-aware), `stale_state_feature: feature@tf (…)`,
`no_recent_event`/`no_active_level` (informational / setup-routed). The legacy
`stale_features:` catch-all is gone; the dashboard groups by reason string, so the new
reasons surface as their own groups (eyeball `api/dashboard/rejections` on next deploy).

**Out of scope (P2):** unifying the hand-rolled `fetchLatestFeatures` SQL with the compiler's
PIT LATERAL path (BUG #4D).

### 11.8 P2 — Truthful PIT compiler SQL + `--mode=research` (DONE; P2c deferred)

**P2a — banned raw `is_fresh` in PIT (BUG #4F).** The compiler already emitted the correct
as-of lifecycle window for level features (`buildFreshnessPredicate`,
`packages/strategies/src/sqlBuilder.ts`), but `translatePredicate` *also* qualified
`is_fresh = true` verbatim, so PIT SQL was `pit_x.is_fresh = true AND <as-of window>` — a
mutable current-state flag AND-ed into a historical query (look-ahead / survivorship).
Fix (mode-aware):

- `compiler.ts`: added `stripIsFresh()`; applied to setup/entry WHERE **only when
  `mode === "pit"`**. Live mode keeps `is_fresh` (current-state freshness is correct live).
- `sqlBuilder.ts`: `extractEqualityPushdowns` now never pushes `is_fresh` into the LATERAL
  WHERE; `buildFreshnessPredicate` honors `cond.ignoreLifecycle` (closes a parity gap with
  the legacy fork, e.g. `waqar_v2`).
- `packages/shared/src/types/strategy.ts`: added optional `ignoreLifecycle` to
  `StrategyCondition` (the field already existed in specs).

Verified: compiled PIT SQL for `smart_risk_ob_ifvg_1m` now has **0** `is_fresh`
occurrences while keeping `(invalidated_at IS NULL OR invalidated_at > b.ts/s.ts)`. New
`compiler.test.ts` cases (20 total, all green): PIT strips (setup + entry), live keeps,
`ignoreLifecycle` omits the window. This also fixes PIT correctness for the **web variant
backtest route**, which runs through `compileStrategy`.

**P2b — backtest `--mode=research` (BUG #4C).** New mode in `scripts/backtest-pit-v2.js`:
setup-engine skipped, all execution costs zeroed (`spread/slippage/commission = 0`), gates
evaluated for visibility but **not** applied (would-be rejections tallied in
`gateSkipReasons`), portfolio heat disabled, persist skipped. Candidate SQL is unchanged
(reuses `mode:"pit"`); research is purely a runner axis.

Validated (XAUUSD 90d, smart_risk): research → **485** executed candidates (vs 20 in fast),
`Skipped: 0`, `Heat dropped: 0`, `Gate skips: volatility=529` (informational), clean
`Avg Win 2.00R / Avg Loss -1.00R` (exact 2:1, proving zero cost drag), raw WR 62.9%. Fast
mode unchanged (20 trades / +16.87R) — no regression.

**Discovered during the P2c parity sanity check (pre-existing, NOT introduced by P2a):**
the `PIT_USE_COMPILER_SQL=1` path still fails end-to-end with `column "zone_kind" does not
exist` — a `z.zone_kind` reference in the compiler's final signal SELECT where alias `z`
is not bound. P2a's SQL output shows the setup/entry WHERE is correctly qualified and
is_fresh-free, so this is a separate compiler-correctness bug in the signal-source join.
It is exactly the kind of behavioral diff the (not-yet-written) legacy-vs-compiler parity
harness must catch, so it is folded into **P2c** (delete the legacy fork), not fixed here.

**P2c (deferred, its own plan):** write the legacy-vs-compiler parity harness, fix the
`z.zone_kind` binding and the latent `persistTrades(..., biasTf)` `ReferenceError`, flip
`PIT_USE_COMPILER_SQL` default to 1, then delete the ~600-line legacy fork.

### 11.9 P2c — Compiler/legacy fork: bugs fixed, fork NOT closed (BLOCKED on metrics parity)

P2c ran against the user-selected acceptance gate of **metrics-equivalence** (compiler-only
must reproduce the locked baselines, not byte-identical SQL). The fork could **not** be closed:
the compiler is not yet a drop-in for legacy.

**Root cause of the `column "zone_kind" does not exist` crash (different from the §11.8
hypothesis).** It was not an unbound `z` alias. `features_zone.zone_kind` exists and the
final signal LATERAL resolves `z.zone_kind` fine. The failing reference was in a **setup/entry
LATERAL**: the `features_ifvg` registry contract advertised
`equalityGroupByDefaults: ["zone_kind", "direction"]`, so a cond with no explicit `groupBy`
emitted `DISTINCT ON (symbol, zone_kind, direction)` over `features_ifvg` — which has **no**
`zone_kind` column (iFVG rows are inherently FVGs). A second latent defect of the same class:
the `features_ifvg` and `features_order_block` `tieBreaker`s referenced `quality_score`, which
neither table has (copy-paste from `features_zone`).

**Fixes (column-correctness, low blast radius — compiler + web variant backtest path only;
legacy/default backtest untouched):**

- `featureRegistry.ts`: `features_ifvg.equalityGroupByDefaults` → `[]` (group by symbol unless
  a cond sets its own `groupBy`, matching the legacy `cond.groupBy ?? []`); `features_ifvg` and
  `features_order_block` `tieBreaker` → `strength_score DESC NULLS LAST, ts DESC` (drop the
  non-existent `quality_score`).
- `compiler.test.ts`: +2 regression cases asserting the ifvg LATERAL never references
  `zone_kind`/`quality_score` and the OB LATERAL never references `quality_score` (scoped to
  the LATERAL window; the final `features_zone` signal pick still uses its own columns).
  strategies suite now **22/22**.
- `scripts/backtest-pit-v2.js`: added an `opts.forceCompiler` seam to `compilePITSQL` (for the
  harness) and fixed the latent `persistTrades(..., biasTf)` `ReferenceError` by deriving
  `biasTf` from the spec at run scope (`resolveBiasTf`).
- New `scripts/parity-compiler-legacy.js`: read-only signal-set diff (compiler vs legacy) —
  informational guardrail that localizes divergence (missing/extra signals, numeric deltas).

**Why the fork stays open (metrics-equivalence gate FAILED, XAUUSD 90d smart_risk fast):**

| path | raw | executed | WR | Net R | signal query |
|---|---|---|---|---|---|
| legacy (default) | 557 | **20** | **75.0%** | **+16.87R** | 233 ms |
| compiler (`PIT_USE_COMPILER_SQL=1`) | 1342 (564 deduped) | 40 | 7.5% | **−37.06R** | 8789 ms |

Parity harness @90d: 1342 vs 557 signals, 279 matched, 501 only-compiler, 278 only-legacy,
worst `entry_price` delta **61.4** (the two generators pick different zones/entries). The
compiler produces ~2.4× more candidates with wrong zone/entry selection and is ~37× slower.
This is a deep SQL-semantics divergence in candidate generation (setup/entry LATERAL
multiplicity, bias-anchor/time-window handling, final zone pick), not a localizable fix.
Closing it means porting legacy's exact query plan into the compiler — **P3-class work**, not
a P2c tweak.

**Decision (no regression):** `PIT_USE_COMPILER_SQL` default **stays 0**; the legacy branch
and helpers are **retained** as the validated default. The compiler remains available behind
the flag (and powers the web variant backtest route) for future maturation. Verified after all
edits: legacy fast 90d still **20 / +16.87R / 75%** (baseline intact); `pnpm -r build` ✅;
`pnpm test` ✅ (engine 79, setupEngine 6, analyzerBacktest 21, tradePipeline 66, strategies 22,
shared 22, levels 1, web 5). Stale `pit-sql-debug.sql` artifact removed.

**Path forward:** fork closure is gated on a dedicated compiler-alignment effort (fold into
P3 alongside the sweep/zone-retest/iFVG detector rebuilds). The parity harness is now the
convergence tracker: drive `onlyCompiler`/`onlyLegacy` to 0 and Net R within tolerance of
legacy before flipping the default.

### 11.10 P3.0 — Feature-contract vs schema audit (DONE; guardrail + 8 contract fixes)

The P2c `features_ifvg`/`features_order_block` drift turned out to be **systemic**: registry
contracts advertised columns their tables lack, so any cond without an explicit `groupBy`
could emit `DISTINCT ON` / `ORDER BY` SQL that 42703s at runtime (and `buildFreshnessPredicate`
could reference missing lifecycle columns).

**Guardrail:** new `scripts/audit-feature-contracts.js` (read-only). For every `FEATURE_REGISTRY`
entry it checks `equalityGroupByDefaults`, `tieBreaker` (tokenized), `requiredColumns`,
`timeColumn/timeframeColumn`, and `validityColumns.*` against `information_schema`. Exit 1 on
any FAIL. First run: **8 FAIL** (+1 orphan).

**Contract fixes (`packages/strategies/src/featureRegistry.ts`, column-correctness only; the
validated smart_risk feature set — bias/zone/pricing/ifvg/structure/atr/ma — is untouched):**

| contract | fix |
|---|---|
| `features_order_block` | drop `direction` (no col; `ob_kind` encodes it) from groupBy/required |
| `features_sweep` | `event_type` → `sweep_type` (groupBy/required) |
| `features_displacement` | drop `event_type` from required |
| `features_candle_pattern` | drop `strength_score` from tieBreaker |
| `features_time_of_day_edge` | `value/direction/strength_score` → `edge`/`score`/`session` |
| `features_pivot` | `period/value` → `kind/price/confidence`; drop `invalidatedAt` (no lifecycle cols) |
| `features_liquidity_pools` | drop `direction`; drop `invalidatedAt` (no lifecycle cols) |
| `features_correlation` | drop `period` from groupBy/required |

(`features_time_of_day` — no `_edge` — is an orphan contract whose table does not exist; left
in place, reported as skipped by the audit, harmless until a spec references it.)

**Verified:** audit → **0 FAIL** (21 contracts, 1 skipped). `pnpm -r build` ✅; every workspace
suite green individually (engine 79, setupEngine 6, analyzerBacktest 21, tradePipeline 66,
strategies 22, shared 22, levels 1, web 5). `smart_risk` fast 90d still **20 / +16.87R / 75%**
(baseline intact). Side effect for P3d: `xauusd_v1` fast 90d no longer SQL-errors on the
`features_time_of_day_edge`/`features_liquidity_pools` LATERALs — it now runs clean and
returns `no signals`, confirming the remaining cause is genuine upstream feature starvation
(sweep → `recent_sweep_matched`), to be addressed by P3a (sweep rebuild) + P3d, not the SQL
layer.

---

## §11.11 — P3a: sweep detector rebuild (level-based, ATR-normalized, PIT-correct) ✅

**Goal.** Replace the over-strict, structure-gated sweep detector (`engine_ver 1.3.0`) that
starved `features_sweep` (≈1 row / 90d at 15m, 169 at 5m) and therefore starved
`features_liquidity_pools.recent_sweep_matched` (the upstream choke behind `xauusd_v1`,
P3d). Rebuild as a **level-based, ATR-normalized, point-in-time-correct** detector
(`engine_ver 1.4.0`) where structure confluence is a **score, not a gate**, and the
forward-looking inducement gate is removed.

**Root cause of the v1.3.0 starvation.** The old detector required a structure event
(CHoCH/BOS) in the same direction within a tight lookback *and* only admitted sweeps whose
"inducement" could be confirmed by later price action — i.e. it (a) hard-gated on structure
and (b) peeked forward. On quiet XAUUSD stretches almost nothing survived both filters, so
`features_sweep` was effectively empty and `recent_sweep_matched` collapsed with it.

**New model (`apps/engine/src/features/sweep.ts`, `engine_ver 1.4.0`).**
- **Level sources (no cycle):** `swing` (every `features_pivot` high/low), `pdh`/`pdl`
  (prior UTC-day high/low, computed from the candle window by date-grouping), and
  `equal_high`/`equal_low` clusters (≥2 pivots within `EQ_TOL_ATR × ATR`). `features_liquidity_pools`
  is intentionally *not* an input (it depends on sweep → would create a DAG cycle); session
  H/L is deferred (would add a `features_session` dependency).
- **Sweep rule (strictly PIT):** for a `low` level, emit on the first candle whose
  `low < level − pen` **and** price closes back above the level within `CLOSE_BACK_BARS = 2`,
  with `pen ≥ MIN_PEN_ATR = 0.10 × ATR`. Mirror for `high` levels. The emitted `ts` is the
  **close-back candle's** timestamp — always ≤ available data, never a future bar.
- **Structure as score:** `structureScore` is computed from `features_structure` events with
  `ts ≤ sweepTs` (last 10 bars, direction match). `sweep_type` is `"post_structure"` when
  score > 0 else `"inducement"` — both are emitted; structure only changes the label/score,
  never whether the sweep fires. This is the fix that un-starves the feature.
- **Evidence:** `{ targetType, penetrationAtr, closeBackBars, displacementAtr, structureScore,
  wickSizeAtrPct }`. `serialize`/`deserialize` carry the new `target_type` column.

**Schema/types.**
- Migration `102_sweep_target_type.sql` (applied): `ALTER TABLE features_sweep ADD COLUMN
  target_type TEXT` + index `(symbol, tf, target_type, ts DESC)`.
- `packages/shared/src/types/feature.ts`: sweep `FeatureEventRow` extended with
  `target_type: SweepTargetType`.

**Tests/build.** `sweep.test.ts` rewritten around level-based cases (PDH sweep+close-back
emits; equal-highs cluster sweep; ATR-penetration boundary rejects `< MIN_PEN_ATR`;
no-close-back-within-window rejects; **PIT no-look-ahead** — a future CHoCH must not change
emission; **structure-absent still emits** — the removed gate). Engine suite **83/83**
(sweep 8/8); `@tm/shared` + `@tm/engine` builds green.

**Backfill (XAUUSD, 5m + 15m, 90d = 2026-04-11 → 2026-07-10).** Two ordered passes of
`scripts/backfill-historical-features.js` (`skipLifecycle`, batch inserts, deps resolved by
the runner): sweep (+atr/pivot/structure) first, then `features_liquidity_pools` (which reads
the persisted sweeps). 34 stale `engine_ver 1.3.0` 5m rows (null `target_type`, emitted by the
old gate at keys the new algorithm no longer produces) were deleted and the pools pass
re-run so `recent_sweep_matched` reflects a pure v1.4.0 sweep set.

**Results.**

| metric | before (v1.3.0) | after (v1.4.0) |
|---|---|---|
| `features_sweep` rows @15m | 1 | **846** (846×) |
| `features_sweep` rows @5m | 169 | **2418** (14.3×) |
| `target_type` @15m | — | pdh 324 / pdl 305 / swing 212 / eqL 3 / eqH 2 |
| `target_type` @5m | — | swing 1575 / pdh 409 / pdl 378 / eqL 33 / eqH 23 |
| `sweep_type` @15m | — | inducement 641 / post_structure 205 |
| `sweep_type` @5m | — | inducement 1742 / post_structure 709 |
| avg penetration @15m / @5m | — | 1.85 ATR / 1.02 ATR |
| `recent_sweep_matched` @15m | 153 | **15553** (27.5% of pool rows) |
| `recent_sweep_matched` @5m | 16593 | **24016** (16.7%) |
| `recent_sweep_matched` @1h/4h/1d | 0 | 0 (sweep not computed at those TFs — P3d scope) |

The inducement:post_structure split (≈76%:24% at 15m) is direct evidence the gate is gone:
the majority of sweeps now fire **without** structure confluence and are merely *scored* by it.

**Regression check.** `smart_risk_ob_ifvg_1m` fast 90d XAUUSD = **20 executed / +16.87R /
75.0% WR** — identical to the pre-P3a baseline (sweep is not on smart_risk's feature path;
the recomputed `features_atr`/`features_pivot` are byte-for-byte the unchanged algorithms, so
idempotent). Full/research baselines untouched.

**Acceptance — MET.** `features_sweep` populated at 5m/15m (≫1/169), `target_type` populated,
`recent_sweep_matched > 0` at both TFs, tests/build green, no baseline regression. This is the
upstream unblock for `xauusd_v1` (P3d): the `features_liquidity_pools.recent_sweep_matched = true`
entry condition now has a non-empty sweep set to match against at 5m/15m. Remaining P3d work
(worker/CLI wiring of `features_liquidity_pools` + `features_time_of_day_edge`, the
`features_pricing@4h` 20-bar lookback, the mean-reversion→momentum premium/discount flip, and
computing sweep at 1h/4h/1d if `xauusd_v1` needs pools on those TFs) is unchanged by this rung.

---

## §11.12 — P3d: xauusd_v1 unblocked (premium/discount flip + pool-as-score) ✅

**Starting point (post-P3a).** With the sweep feed rebuilt (§11.11), `xauusd_v1` fast 90d
moved from `no signals` (P3.0 SQL error → detector starvation) to **1 raw signal / 0
executed**. The hypothesized lever was the stale mean-reversion premium/discount mapping in
the `directional_zone` setup — the same thing waqar_v2 flipped in commit `1d51e02`.

**Step 1 — premium/discount momentum flip (v1.0.0 → v1.1.0, user-approved).** Mirrored
`1d51e02`: `directional_zone` now reads bullish→`position IN ('premium','deep_premium')` /
bearish→`position IN ('discount','deep_discount')` (momentum continuation). Seeded to DB
(`strategy_families.base_spec`, version `1.1.0` confirmed live). **Result: still 1 signal** —
the pricing mapping was *not* the binding constraint.

**Diagnosis (atomic frequencies + joint coincidence, 90d XAUUSD).**

| feature @tf | predicate | passing |
|---|---|---|
| `features_pricing@4h` | premium+deep_prem (post-flip bullish) / discount+deep_disc (bearish) | 285 / 149 (4h-bars) |
| `features_time_of_day_edge@15m` | edge ∈ STRONG/GOOD/NEUTRAL | 4622 / 5616 (82%) |
| `features_bias@15m` | direction ≠ neutral | 5610 / 5616 (99.9%) |
| `features_zone@1h` | demand/supply | 145,646 rows |
| `features_structure@5m` | bos/mss | 1036 bars |
| `features_zone@5m` | demand/supply, fill<0.8, untapped | 1848 bars |
| `features_liquidity_pools@5m` | recent_sweep_matched | 2993 bars |

Joint (same 5m bar, *before* direction-alignment with bias): structure∩zone = 273,
structure∩pool = 167, zone∩pool = 341, **all three = 44 bars**. After requiring
`structure.direction = bias.direction` (and, in full mode, the 4h/15m setup block), 44
collapses to **1**. **The choke is the required triple-coincidence, not any single input.**

**Step 2 — demote `liquidity_pool_sweep` required → optional (v1.1.0 → v1.2.0, user-approved).**
Pool now scores (weight 9) rather than hard-gates; `structure_break` + `zone_retest` remain the
required core. **Result:** 1 → **8 raw signals / 3 executed / WR 66.7% / Net R +3.69R**
(2 wins / 1 loss; 5 vol-gate skips). xauusd_v1 now trades with positive expectancy. Frequency
is still modest (8/90d) because `structure_break` (bos/mss only) ∩ `zone_retest` (untapped,
fill<0.8) is itself a tight AND; further loosening (fill_pct≤1.0 / choch / tapped) was
offered and deferred by the user.

**No regression to baselines** (xauusd_v1 change is isolated to that spec; smart_risk fast 90d
still 20 / +16.87R / 75%, unchanged by P3d).

**Live worker/CLI wiring (done, logic-neutral).** Added `features_liquidity_pools` and
`features_time_of_day_edge` to `apps/engine/src/worker/featureWorker.ts
DEFAULT_REQUESTED_FEATURES` and to the `apps/engine/src/index.ts` CLI feature list, so the
live path now computes both (the backtest already reads historically-persisted rows).
`features_correlation` was intentionally left out (optional `dxy_alignment` scorer; DXY is
sparse historically and would risk live failures). Validated via a DAGRunner probe for XAUUSD
15m: closure `[pivot, atr, htf_bias, structure, sweep, liquidity_pools, time_of_day_edge]`
resolves and both features compute to objects with no error (`@tm/engine` build green).
