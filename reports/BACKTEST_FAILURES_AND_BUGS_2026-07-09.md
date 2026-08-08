# Backtest Failures & Bugs Report — July 9, 2026

## Executive Summary

Ran backtests on 6 active strategy specs against XAUUSD (and EURUSD for cross-check) over 90 days. **Zero trades were executed across all specs.** The pipeline is broken at multiple levels: data coverage, feature sparsity, and setup-engine integration.

---

## Backtest Results Summary

| Spec | Symbol | Bias Rows | Setup Rows | Entry Rows | Raw Signals | Executed |
|------|--------|-----------|------------|------------|-------------|----------|
| `keylevel_bounce_v1` | XAUUSD | 1,442 | 5 | 0 | 0 | 0 |
| `keylevel_bounce_v2` | XAUUSD | 1,442 | 5 | 0 | 0 | 0 |
| `doyle_sd` | XAUUSD | 2,923 | 5,697 | 91 | 3 | 0 (all blocked) |
| `doyle_sd` | EURUSD | 3,164 | 3,532 | 85 | 0 | 0 |
| `forex_strategy_orb` | XAUUSD | 125 | 60 | 9 | 9 | 0 (all blocked) |
| `smart_risk_ob_ifvg_1m` | XAUUSD | 123 | 40 | 0 | 0 | 0 |

---

## CRITICAL BUG #1: Higher-Timeframe Candle Tables Are Not Backfilled

**Severity: BLOCKER** — This single issue breaks the entire backtest pipeline.

### Evidence
```
candles_1m:  84,690 rows — Apr 10 → Jul 9  (full 90 days) ✓
candles_5m:     496 rows — Jul 6  → Jul 9  (only 3 days!) ✗
candles_15m:    457 rows — Jun 30 → Jul 9  (only 9 days)  ✗
candles_1h:     498 rows — Jun 7  → Jul 9  (only 32 days) ✗
candles_4h:     386 rows — Apr 10 → Jul 9  (full 90 days) ✓
candles_1d_utc:  77 rows — Apr 11 → Jul 8  (full 90 days) ✓
```

### Impact
- `resolvePrimaryTf()` uses `spec.entry[0].tf` as the primary timeframe
- `doyle_sd` entry tf = 5m → `fetchLatestCandle()` queries `candles_5m` → returns `NULL` for any date before July 6
- `runHardRules()` blocks with **"No candle data available for analysis"** when `latestCandle` is null
- This blocks ALL signals for `doyle_sd` (3 signals on XAUUSD, all blocked) and `forex_strategy_orb` (9 signals, all blocked)

### Fix
```bash
# Regenerate higher-timeframe candles from 1m data
node scripts/backfill-candles-from-mt5-csv.js <dir> --tz-offset-minutes=180 --broker=MT5
# Or use a materialized view / continuous aggregate approach
```

### Affected Files
- `packages/setupEngine/src/contextBuilder.ts:136` — `fetchLatestCandle()` uses `CANDLE_TABLE_BY_TF[tf]`
- `packages/setupEngine/src/rules/hardRules.ts:11` — blocks when `latestCandle` is null
- `scripts/backtest-pit-v2.js:1377` — `resolvePrimaryTf()` picks entry tf

---

## CRITICAL BUG #2: `features_pricing` at 15m Is Extremely Sparse

**Severity: BLOCKER** — This is why `keylevel_bounce_v1/v2` produce 0 signals.

### Evidence
- `features_pricing` at 15m: only **449 rows** in 90 days (vs 16,008 at 5m)
- 1,442 bias rows exist, but only **208** (14.4%) have ANY pricing data within 24h
- Only **99** have the correct position for the bias direction
- Combined with zone filter: only **5** pass setup

### Root Cause Analysis
The `directional_zone` setup condition requires:
```
(features_bias.direction = 'bullish' AND position IN ('discount', 'deep_discount', 'equilibrium'))
OR
(features_bias.direction = 'bearish' AND position IN ('premium', 'deep_premium', 'equilibrium'))
```

The `DISTINCT ON (symbol)` in the LATERAL subquery picks only the **single latest** pricing row. If the latest pricing position doesn't match the bias direction, the row is filtered out — even if a matching pricing row exists within the 24h lookback window.

### Breakdown
| Metric | Count |
|--------|-------|
| Bias rows (1h, non-neutral) | 1,442 |
| Bias rows with ANY pricing in 24h | 208 |
| Bias rows where LATEST pricing matches direction | 99 |
| Bias rows with valid zone (demand/supply, fill<0.95) | 17 |
| **Both pricing AND zone pass** | **5** |

### Fix Options
1. **Backfill `features_pricing` at 15m more frequently** — currently only 449 rows in 90 days (~5/day)
2. **Change the LATERAL to pick the best-matching row** instead of just the latest
3. **Use 5m pricing** instead of 15m for the keylevel_bounce family

### Affected Files
- `apps/engine/src/features/pricing.ts` — pricing feature generator
- `scripts/backtest-pit-v2.js:817-828` — setup PIT LATERAL with `DISTINCT ON (symbol)`

---

## CRITICAL BUG #3: Entry Phase Fails Due to Missing Structure Events

**Severity: BLOCKER** — The 5 setup rows that pass for `keylevel_bounce_v1` all fail entry.

### Evidence
The 5 setup rows for `keylevel_bounce_v1`:
```
ts=2026-07-01T08:00  bearish  struct_30m=NULL  struct_120m=NULL  zone_retest=demand fill=0.32
ts=2026-07-01T09:00  bearish  struct_30m=NULL  struct_120m=NULL  zone_retest=demand fill=0.32
ts=2026-07-01T16:00  bearish  struct_30m=NULL  struct_120m=NULL  zone_retest=supply fill=0.79
ts=2026-07-08T08:15  bullish  struct_30m=NULL  struct_120m=NULL  zone_retest=supply fill=0.11
ts=2026-07-09T02:45  bullish  struct_30m=NULL  struct_120m=NULL  zone_retest=supply fill=0.24
```

The entry condition requires:
```
event_type IN ('bos', 'mss') AND direction = features_bias.direction
```
Plus `structureFreshnessMinutes: 120` — structure must be within 120 minutes of the bias timestamp.

**None of the 5 setup rows have a matching structure event within 120 minutes.**

### Structure Data at 15m
| event_type | direction | count |
|------------|-----------|-------|
| bos | bearish | 149 |
| bos | bullish | 137 |
| bos_failed | bearish | 130 |
| bos_failed | bullish | 127 |
| mss | bearish | 1 |
| mss | bullish | 6 |

There are only **7 MSS events** in 90 days at 15m. The entry condition requires `bos` OR `mss`, but the timing alignment with bias + zone is extremely rare.

### Fix Options
1. **Reduce `structureFreshnessMinutes`** from 120 to 30 or lower
2. **Add `choch` to the allowed event types** (there are 2 choch events)
3. **Use 5m structure** instead of 15m for more granular entry timing

---

## BUG #4: `features_sweep` at 15m Has 0 Rows

**Severity: HIGH** — Breaks `smart_risk_ob_ifvg_1m`.

### Evidence
```
features_sweep at 15m: 0 rows
features_sweep at 5m:  2 rows
```

The `smart_risk_ob_ifvg_1m` spec requires `features_sweep` at 15m in its setup conditions. With 0 rows, the LATERAL join returns no matches, and setup_passed = 0.

### Fix
- Backfill `features_sweep` at 15m, or change the spec to use 5m sweep

---

## BUG #5: `features_zone_retest` at 1m Has 0 Rows

**Severity: HIGH** — Breaks `keylevel_bounce_v2`.

### Evidence
```
features_zone_retest at 1m: 0 rows
features_zone_retest at 5m: 374,887 rows
features_zone_retest at 15m: 340 rows
```

`keylevel_bounce_v2` requires `features_zone_retest` at 1m. The table has data at 5m, 15m, 1h, 4h, 1d — but NOT at 1m.

### Fix
- Change the spec to use 5m or 15m for zone_retest, or backfill at 1m

---

## BUG #6: `buildFreshnessPredicate` Discrepancy Between Compiler and Backtest

**Severity: MEDIUM** — Backtest is less restrictive than live, causing inconsistent results.

### Compiler (`compiler.ts:205-218`)
```js
case "features_zone":
case "features_ifvg":
case "features_order_block": {
  const isFvg = cond.feature === "features_zone" && isFvgZoneCondition(cond);
  const mitigated = isFvg
    ? ""
    : `AND (${tableRef}.mitigated_at IS NULL OR ${tableRef}.mitigated_at > ${asOfRef})`;
  return `${mitigated}
    AND (${tableRef}.invalidated_at IS NULL OR ${tableRef}.invalidated_at > ${asOfRef})`;
}
```

### Backtest (`backtest-pit-v2.js:740-755`)
```js
case "features_zone":
case "features_ifvg":
case "features_order_block":
  return `AND (${tableRef}.invalidated_at IS NULL OR ${tableRef}.invalidated_at > ${asOfRef})`;
```

The backtest is **missing the `mitigated_at` check** for non-FVG zones. This means the backtest may include zones that have been touched (mitigated) but not invalidated, while the live compiler would exclude them.

### Fix
- Sync `buildFreshnessPredicate` in `backtest-pit-v2.js` with `compiler.ts`

---

## BUG #7: `doyle_sd` EURUSD — 85 Entry Rows but 0 Signals

**Severity: HIGH** — The signal select SQL is silently dropping all entry rows.

### Evidence
- `doyle_sd` on EURUSD: 3,164 bias → 3,532 setup → 85 entry → **0 signals**
- The signal select for zone source joins `features_pricing` with `MAX(ts)` and applies the pricing filter
- The pricing filter from the spec is: `(features_bias.direction = 'bullish' AND position IN ('discount', 'deep_discount', 'equilibrium')) OR (features_bias.direction = 'bearish' AND position IN ('premium', 'deep_premium', 'equilibrium'))`
- This is translated to use `e.bias_direction` and `p.position`
- If the latest pricing row's position doesn't match the bias direction, the signal is dropped

### Fix
- The signal select should use the same PIT LATERAL approach as setup/entry, not `MAX(ts)`

---

## BUG #8: `translatePredicate` in Backtest Missing `biasAliases` Parameter

**Severity: MEDIUM** — Cross-feature references may not resolve correctly.

### Compiler (`compiler.ts:799`)
```js
function translatePredicate(predicate, tableRef, context, biasAliases = {})
```

### Backtest (`backtest-pit-v2.js:296`)
```js
function translatePredicate(predicate, tableRef, context)
// No biasAliases parameter!
```

The backtest's `translatePredicate` doesn't accept `biasAliases`, so multi-bias-timeframe specs (with both `features_bias` and `features_htf_bias`) won't resolve correctly.

### Fix
- Add `biasAliases` parameter to backtest's `translatePredicate`

---

## Remaining Issues from Previous Audit (Still Unfixed)

1. **`openingRange.ts` `serialize()` missing `tf` column** — relies on DB default
2. **`sessionHl.ts` `serialize()` missing `tf` column** — same issue
3. **`lifecycle.ts` `mitigatedAt` equals `firstTouchAt`** — should be close-beyond-zone
4. **Structure/sweep/candle_pattern have no dedicated signal builders** — only setup/entry filters
5. **Backtest script duplicates compiler SQL logic** — drift between the two is inevitable

---

## Codex Re-Audit Addendum - July 9, 2026

This section is based on a fresh audit of `packages/tradePipeline/src/liveRunner.ts`, `packages/setupEngine/src/contextBuilder.ts`, `packages/setupEngine/src/rules/hardRules.ts`, `packages/strategies/src/compiler.ts`, and `scripts/backtest-pit-v2.js`, plus live DB/preflight runs on July 9, 2026.

### Fresh Runtime Evidence

Current XAUUSD candle coverage still confirms the core data problem:

| Table | 90d Rows | First Row | Last Row | Assessment |
|---|---:|---|---|---|
| `candles_1m` | 84,690 | 2026-04-10 14:55 UTC | 2026-07-09 14:53 UTC | Good source coverage |
| `candles_5m` | 497 | 2026-07-06 04:40 UTC | 2026-07-09 14:50 UTC | Broken for 90d research |
| `candles_15m` | 457 | 2026-06-30 14:15 UTC | 2026-07-09 14:45 UTC | Broken for 90d research |
| `candles_1h` | 498 | 2026-06-07 22:00 UTC | 2026-07-09 14:00 UTC | Incomplete |
| `candles_4h` | 386 | 2026-04-10 16:00 UTC | 2026-07-09 12:00 UTC | Usable |
| `candles_1d_utc` | 77 | 2026-04-12 00:00 UTC | 2026-07-09 00:00 UTC | Usable |

Fresh debug runs reproduced the stage failures:

| Command | Bias | Setup | Entry | Raw Signals | Final Block |
|---|---:|---:|---:|---:|---|
| `node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v1 --json --debug` | 1,442 | 5 | 0 | 0 | Entry filter cannot align structure |
| `node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --debug` | 2,923 | 5,697 | 91 | 3 | Setup engine: no candle data |
| `node scripts/backtest-pit-v2.js XAUUSD 90 forex_strategy_orb --json --debug` | 125 | 60 | 9 | 9 | Setup engine: no candle data |

Bypassing setup evaluation with `PIT_SKIP_SETUP_ENGINE=1` showed that zero trades are not only a setup-engine problem:

| Spec | Raw Signals | Simulated | Gate Result |
|---|---:|---:|---|
| `doyle_sd` | 3 | 3 | 3 skipped by spread gate |
| `forex_strategy_orb` | 9 | 9 | 9 skipped by volatility gate |

Live pipeline evidence from `live_signal_rejection` over the last 24h shows the same pattern in production-style analysis:

| Pattern | Evidence |
|---|---|
| ORB is frequently rejected by volatility gates | `orb_classic` had 55 XAUUSD and 55 GBPUSD `gates_failed: volatility_gate` rejections |
| Spread data still pollutes setup evaluation | Rejections include `Spread 102.3p exceeds max allowed 5.6p` on USDCHF and `Spread 91.5p exceeds max allowed 6.0p` on USDCAD |
| Live signal throughput is effectively dead | Only one `live_signal` row was present in the last 24h |

### Additional Confirmed Bugs and Failures

#### BUG #9: Backtest Preflight Gives False Confidence

**Severity: HIGH**

`scripts/backtest-pit-v2.js` has a preflight check, but it only warns when a required table has exactly zero rows. This lets `candles_5m = 497 rows in 90 days` and `candles_15m = 457 rows in 90 days` pass as covered, even though both are unusable for historical simulation.

**Impact:** The runner reports a normal backtest path even when the requested timeframe has less than one week of data. This hides the root cause behind downstream setup-engine or gate failures.

**Fix:** Preflight must calculate expected candle density from `candles_1m` and the requested timeframe. For a 90-day 5m backtest, require a high coverage ratio, not merely `rows > 0`.

Recommended contract:

```text
required_coverage_ratio >= 0.98 for candle tables
required_feature_ratio >= semantic-type threshold
hard fail with BACKTEST_BLOCKED_DATA_QUALITY if below threshold
```

#### BUG #10: Live Feature Freshness Guard Is Too Strict and Not Timeframe-Aware

**Severity: HIGH**

`packages/tradePipeline/src/liveRunner.ts` uses a fixed `maxAgeMinutes = 5` for every required feature. That is not valid for 15m, 1h, 4h, or daily features. On the fresh audit, XAUUSD had:

```text
candles_1m:             1.8 minutes old
features_atr@15m:       9.8 minutes old
features_pricing@15m:   9.8 minutes old
features_session@1m:    9.8 minutes old
features_spread@1m:     9.8 minutes old
features_zone@15m:     99.8 minutes old
```

With the current guard, a valid 15m feature can be rejected halfway through its candle. Session and spread updates also appear to run on a 15-minute cadence despite being checked as `@1m`.

**Fix:** Freshness should be based on timeframe and feature semantic type:

| Feature Type | Freshness Rule |
|---|---|
| 1m candle | <= 2-3 minutes in live mode |
| 5m state feature | <= 7 minutes |
| 15m state feature | <= 20 minutes |
| 1h state feature | <= 70 minutes |
| Event feature | latest candle for tf is fresh; event row may be absent |
| Durable level/zone | active lifecycle interval, not max row age |
| Spread/session | source cadence must match declared tf |

#### BUG #11: Live Event Freshness Whitelist Is Incomplete

**Severity: MEDIUM**

`EVENT_FEATURES` in `liveRunner.ts` includes `features_structure`, `features_order_block`, `features_ifvg`, and `features_sweep`. It does not include `features_zone`, `features_zone_retest`, `features_fvg`, `features_candle_pattern`, or `features_displacement`, all of which can behave like sparse event/candidate features depending on the strategy.

**Impact:** Live analysis can block because an event table has not produced a new row recently, even when no new event should exist.

**Fix:** Replace the hardcoded set with a feature registry that marks each table as `state`, `event`, `level`, or `distribution`.

#### BUG #12: Live Fetches Feature Snapshots Differently Than Strategy SQL

**Severity: HIGH**

`fetchLatestSignal()` runs compiled strategy SQL, but `fetchLatestFeatures()` separately re-fetches latest ATR, session, spread, pricing, bias, structure, zone, iFVG, and OB rows for gates. These queries use their own latest-row semantics and do not reuse the exact feature rows that produced the signal.

**Impact:** A signal can be generated from one point-in-time feature set, then gated or graded using a different feature set. This creates audit drift and makes live rejections hard to reproduce.

**Fix:** The compiled signal SQL should return a `feature_snapshot_json` containing the exact feature row IDs/timestamps used. Live gates should consume that snapshot first and only fetch truly live execution data separately, such as current spread and current price.

#### BUG #13: Backtest and Compiler SQL Are Still Forked

**Severity: HIGH**

`packages/strategies/src/compiler.ts` now supports `biasAliases` and stronger lifecycle handling, but `scripts/backtest-pit-v2.js` still has its own `translatePredicate`, `buildFreshnessPredicate`, signal-source SQL, time-window translation, PIT joins, and risk joins.

Confirmed drift examples:

- Backtest `translatePredicate(predicate, tableRef, context)` still lacks the compiler's `biasAliases` parameter.
- Backtest zone freshness still checks only `invalidated_at` for `features_zone`, while compiler excludes mitigated non-FVG zones.
- Signal-source SQL in both files independently uses `MAX(ts)` for pricing and several state joins.
- Backtest preflight and compiler do not share a feature registry or semantic contract.

**Fix:** The PIT runner should call the strategy compiler in a PIT mode, or both should use a shared SQL builder package. Duplicated SQL builders should be deleted after parity tests are added.

#### BUG #14: Setup Engine Is Being Used as a Strategy-Agnostic Hard Block

**Severity: HIGH**

`evaluateSetup()` applies generic hard rules:

- no active zones
- no fresh untapped zones
- no entry zone within 1.5 ATR
- spread too wide
- high volatility plus wide spread
- HTF bias block

These rules make sense for some supply/demand workflows, but they are not universally valid for ORB, moving-average, indicator, or FVG-continuation strategies.

**Impact:** Valid raw strategy candidates are blocked for reasons unrelated to the actual strategy. In the fresh run, ORB and Doyle signals never reached trade simulation unless `PIT_SKIP_SETUP_ENGINE=1` was used.

**Fix:** Setup evaluation should be strategy-family aware:

```text
zone_reversal strategy -> require nearby zone
orb_breakout strategy -> require range breakout, displacement, session validity
fvg_continuation strategy -> require FVG geometry and fill rules
indicator strategy -> do not require zones unless spec says so
```

#### BUG #15: Live Deduplication Only Checks Rejected/Expired/Closed Orders

**Severity: MEDIUM**

`findRecentDuplicate()` checks `orders` with statuses `rejected`, `expired`, and `closed`. It does not include active `pending`, `sent`, or `filled` orders. There are other gates for active positions, but the fingerprint-level duplicate check should also protect against repeated submission of the same signal while an order is pending or filled.

**Fix:** Include active statuses or split the check into exact active duplicate, recently rejected duplicate, and closed duplicate cooldown policies.

#### BUG #16: Backtest Warmup Is Based on Entry Timeframe, Not Feature Requirements

**Severity: MEDIUM**

`computeWarmupTs()` uses `spec.entry[0].tf` and a fixed 200-candle warmup. That can be wrong for strategies requiring 1h/4h bias, ATR, moving averages, correlation, or structure context.

**Impact:** Signals can be evaluated before all required features are mature, or too much valid data can be skipped for lower-timeframe strategies.

**Fix:** Warmup should be derived from the maximum lookback required by indicators, moving averages, ATR, structure/pivot windows, pricing dealing range, explicit `lookbackBars`, and HTF bias tree requirements.

### Recommended Architecture Upgrades

#### 1. Add a Shared Feature Registry

Create a single registry used by compiler, PIT runner, live runner, setup engine, and audit scripts:

```ts
type FeatureSemanticType = "state" | "event" | "level" | "distribution";

interface FeatureContract {
  table: string;
  semanticType: FeatureSemanticType;
  timeColumn: "ts";
  timeframeColumn: "tf";
  requiredColumns: string[];
  validityColumns?: {
    validFrom?: string;
    validUntil?: string;
    invalidatedAt?: string;
    mitigatedAt?: string;
  };
  defaultFreshnessMinutesByTf?: Record<string, number>;
  defaultLookbackBars?: number;
  joinPolicy: "latest_as_of" | "active_window" | "candidate_set" | "sample_distribution";
}
```

This replaces hardcoded lists like `EVENT_FEATURES`, `LIFECYCLE_FEATURES`, `ALLOWED_GROUP_BY`, and feature-specific ad hoc joins.

#### 2. Replace `scripts/backtest-pit-v2.js` SQL Duplication

Move PIT SQL generation into `packages/strategies` and expose:

```ts
compileStrategy(spec, { mode: "live" | "pit", from, to, symbol })
```

Then the backtest runner should only load the spec, run the compiler, run preflight, simulate fills, apply selected gates, and persist stage counts/trades.

#### 3. Make Backtest Modes Explicit

Current behavior mixes research, setup grading, execution gates, and portfolio heat. Add explicit modes:

| Mode | Purpose | Gates |
|---|---|---|
| `research` | Test raw strategy edge | No generic setup engine; no live gates |
| `execution_cost` | Add spread/slippage/fill assumptions | Cost model only |
| `safety` | Model live safety filters | Spread, volatility, session, rate limits |
| `portfolio` | Model account-level constraints | Heat, daily loss/win, family limits |

Reports should show every stage, not only final executed trades.

#### 4. Build HTF Candles From 1m On Demand

Do not depend on partially backfilled physical HTF candle tables during research. Either use deterministic SQL rollups from `candles_1m`, or maintain materialized HTF tables with coverage metadata and strict freshness checks.

Recommended metadata:

```text
candle_rollup_runs(symbol, tf, source_min_ts, source_max_ts, output_rows, expected_rows, gap_count, code_hash, completed_at)
```

#### 5. Persist Strategy Candidate Snapshots

Add a table for rejected and accepted candidates:

```text
strategy_signal_candidates(
  run_id,
  mode,
  strategy_id,
  symbol,
  tf,
  candidate_ts,
  side,
  entry_price,
  stop_loss,
  take_profit,
  feature_snapshot_json,
  decision_stage,
  rejection_reason,
  simulated_outcome,
  created_at
)
```

This lets us audit why `bias -> setup -> entry -> signal -> trade` collapsed at each stage.

#### 6. Split Market Data Quality From Strategy Performance

If a backtest has missing candles, stale features, polluted spread, or zero required event rows, the output should be `status: BLOCKED_DATA_QUALITY`, not `0 trades, 0% win rate`.

### Better Algorithm Recommendations

#### ORB Strategies

- Use explicit session calendars, not generic UTC time windows.
- Store the exact opening-range session key, high, low, midpoint, and range size.
- Require displacement through the range, not just a wick break.
- Reject breakouts where the range is too wide relative to ATR.
- Apply volatility gates as regime filters before signal generation, not only as post-simulation trade blockers.
- Track first break, retest, and continuation as separate setup types.

#### Supply/Demand and Key-Level Strategies

- Stop requiring a single latest pricing row to match bias. Select the best valid pricing candidate inside the lookback window.
- Rank zones by proximity, freshness, lifecycle state, HTF alignment, departure strength, and number of retests.
- Treat first touch, mitigation, invalidation, and retest as separate states. A touched zone is not always dead; a fully mitigated one usually is.
- Use volatility-normalized zone width by symbol.

#### Structure and Sweep Strategies

- Use lower timeframe structure for entry timing and higher timeframe structure for bias.
- Require displacement after BOS/MSS/CHoCH, not only the event label.
- For sweeps, require wick penetration plus close back inside the level.
- Store `target_type` for the swept liquidity: prior high/low, session high/low, equal highs/lows, PDH/PDL, or pool.

#### Spread and Volatility

- Historical spread should be a cost model, not a raw hard block.
- Live spread should use current broker feed values with sanity caps.
- Volatility gates should be calibrated per symbol/session. XAUUSD, USDJPY, and EURUSD should not share one generic threshold.

---

## Recommended Priority Fixes

| Priority | Bug | Action |
|----------|-----|--------|
| **P0** | #1: HTF candles not backfilled | Regenerate `candles_5m`, `candles_15m`, `candles_1h` from `candles_1m` |
| **P0** | #2: `features_pricing` at 15m too sparse | Increase pricing generation frequency at 15m, or use 5m pricing |
| **P0** | #3: Structure events don't align with bias timing | Reduce `structureFreshnessMinutes` or use 5m structure |
| **P1** | #4: `features_sweep` at 15m = 0 | Backfill sweep at 15m |
| **P1** | #5: `features_zone_retest` at 1m = 0 | Fix spec to use 5m or backfill at 1m |
| **P1** | #7: Signal select drops entry rows | Use PIT LATERAL instead of MAX(ts) in signal select |
| **P1** | #9: Preflight false confidence | Add expected-row/coverage-ratio checks and block bad-data backtests |
| **P1** | #10: Live freshness too strict | Make freshness timeframe-aware and semantic-type-aware |
| **P1** | #12: Live feature snapshot drift | Return and reuse `feature_snapshot_json` from compiled signal SQL |
| **P1** | #13: Compiler/backtest SQL fork | Move PIT SQL generation into shared strategy compiler |
| **P1** | #14: Generic setup engine hard block | Make setup evaluation strategy-family aware and optional by backtest mode |
| **P2** | #6: Freshness predicate mismatch | Sync backtest with compiler |
| **P2** | #8: Missing biasAliases in translatePredicate | Add parameter |
| **P2** | #11: Incomplete event freshness whitelist | Replace hardcoded event list with shared feature registry |
| **P2** | #15: Dedup ignores active duplicates | Include pending/sent/filled fingerprints in duplicate policy |
| **P2** | #16: Warmup ignores feature requirements | Derive warmup from max required feature lookback |

---

## How to Verify Fixes

```bash
# 1. Regenerate HTF candles
node scripts/backfill-candles-from-mt5-csv.js <dir> --tz-offset-minutes=180 --broker=MT5

# 2. Backfill missing features
node scripts/backfill-historical-features.js XAUUSD 1d,4h,1h,15m,5m

# 3. Re-run backtests
node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v1 --json
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json
node scripts/backtest-pit-v2.js XAUUSD 90 forex_strategy_orb --json
node scripts/backtest-pit-v2.js XAUUSD 90 smart_risk_ob_ifvg_1m --json
```
