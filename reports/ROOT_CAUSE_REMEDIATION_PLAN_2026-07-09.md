# Root-Cause Remediation Plan — tradzfx-v2 Backtest/Live Pipeline

**Date:** 2026-07-09  
**Source report:** `reports/BACKTEST_FAILURES_AND_BUGS_2026-07-09.md`  
**Author:** Senior Quantitative Trading Systems Architect  
**Scope:** Feature generation → strategy compilation → backtesting → live signal evaluation → order execution

---

## 1. Root Cause Analysis

The 16 bugs are symptoms of five systemic architectural failures. Fixing the symptoms one-by-one will not make the system reliable; the following root causes must be addressed structurally.

### Category A — Higher-Timeframe Data Is a Second-Class Citizen
Higher-timeframe candles and features are stored in physical tables that are backfilled manually and can be partial without anyone knowing. The setup engine, the backtest preflight, and the live runner all assume these tables are complete once they contain any rows. There is no deterministic source-of-truth rollup from `candles_1m`, no coverage metadata, and no hard failure when a table is incomplete.

**Bugs:** #1 (HTF candle tables not backfilled), #9 (preflight false confidence).

### Category B — Feature Semantics Are Implicit and Hardcoded
The system treats every feature table as if it were the same kind of data: a row with a `ts` that should be "latest as of now." In reality the features have very different semantics:

- **State features** (`features_bias`, `features_pricing`, `features_atr`, `features_moving_average`): a current value that should be latest-as-of, but freshness depends on the timeframe.
- **Event features** (`features_structure`, `features_sweep`, `features_candle_pattern`, `features_zone_retest`, `features_displacement`): discrete occurrences that may be absent; joining them should search a bounded lookback and allow no match.
- **Level features** (`features_zone`, `features_ifvg`, `features_order_block`): geometric intervals that are valid over a lifecycle window (`created_at` → `invalidated_at`/`mitigated_at`).
- **Distribution features** (`features_correlation`, `features_spread`): sampled distributions over a window.

Because these semantics are hardcoded in SQL builders and duplicated across compiler/backtest/live, the joins are wrong by default. A `DISTINCT ON (symbol)` LATERAL picks the single latest pricing row even when a better-matching candidate exists inside the lookback; structure events are filtered by freshness windows that do not match their sparse cadence; zone lifecycle rules differ between compiler and backtest.

**Bugs:** #2 (pricing sparse/latest mismatch), #3 (structure timing misalignment), #4 (`features_sweep` empty), #5 (`features_zone_retest` empty), #10 (live freshness not timeframe-aware), #11 (incomplete event whitelist), #16 (warmup ignores feature requirements).

### Category C — Strategy SQL Is Forked Between Compiler and Backtest
`packages/strategies/src/compiler.ts` and `scripts/backtest-pit-v2.js` independently implement predicate translation, freshness predicates, PIT LATERAL joins, ATR bindings, and signal SELECTs. They have already diverged: the backtest is missing `mitigated_at` handling, missing the `biasAliases` parameter, uses `MAX(ts)` joins in signal SELECT instead of the compiler's LATERAL PIT pattern, and maintains its own whitelists (`ALLOWED_FEATURES`, `ALLOWED_GROUP_BY`). Any fix made to one will eventually drift in the other.

**Bugs:** #6 (freshness predicate mismatch), #7 (signal select drops rows with `MAX(ts)`), #8 (missing `biasAliases`), #13 (compiler/backtest SQL fork).

### Category D — Setup Engine Is a Strategy-Agnostic Hard Block
`evaluateSetup()` in the setup engine encodes assumptions that are only valid for supply/demand reversal strategies: there must be a nearby untapped zone, current price must be within 1.5 ATR of that zone, spread must be narrow, HTF bias must agree. These rules are applied universally, including to ORB, moving-average, indicator, and FVG-continuation strategies that have no reason to require a nearby zone. The result is that valid raw signals are blocked for reasons unrelated to their own logic.

**Bugs:** #14 (setup engine overreach).

### Category E — Live Pipeline Evaluates Signals Against a Different Feature Set Than the One That Generated Them
`liveRunner.ts` runs the compiled strategy SQL to find a signal, then calls `fetchLatestFeatures()` to re-fetch ATR, session, spread, pricing, bias, structure, zone, etc. using its own latest-row semantics. The gate evaluation therefore uses a different point-in-time snapshot than the signal SQL. There is no auditable record of which exact feature rows produced the signal, making live rejections impossible to reproduce. The freshness guard is also a single fixed 5-minute threshold and the event-feature whitelist is incomplete.

**Bugs:** #10 (live freshness too strict), #11 (event whitelist incomplete), #12 (live feature snapshot drift), #15 (dedup ignores active orders).

---

## 2. Architectural Changes (Priority-Ordered)

The changes below are ordered by what must ship first to unblock the pipeline. Each change fixes a root cause, not a symptom.

---

### Change 1 — Deterministic Higher-Timeframe Candle Source

**What:**
- Replace direct physical HTF table reads with a single abstraction `getCandles(symbol, tf, from, to)` that returns complete, gap-checked candles for any timeframe.
- Implement the abstraction as deterministic rollups from `candles_1m` using SQL `time_bucket` / date_trunc arithmetic. Physical HTF tables become optional write-ahead caches, not sources of truth.
- Add a `candle_rollup_runs` metadata table that records: `symbol`, `tf`, `source_min_ts`, `source_max_ts`, `output_rows`, `expected_rows`, `gap_count`, `code_hash`, `completed_at`.
- The abstraction checks the metadata first. If the cached table covers `[from, to]` with `coverage_ratio >= 0.98` and `gap_count == 0`, it reads the cache; otherwise it rolls up from `candles_1m` on the fly and refreshes the cache.

**Why it fixes the root cause:**
The root cause is not "someone forgot to backfill." It is that the system has no reliable way to produce a complete HTF series. A deterministic rollup from the 1m source of truth makes partial HTF tables impossible by construction.

**Eliminates:**
- Bug #1: `candles_5m`/`candles_15m`/`candles_1h` being empty or partial no longer blocks signals.
- Bug #9: Preflight can now validate against `expected_rows` computed from the rollup metadata, not just `COUNT(*) > 0`.

**Reliability Guarantee:**
Any query for HTF candles receives a complete, gap-free series over the requested interval, or receives an explicit `DATA_QUALITY_BLOCKED` error. There is no silent partial data.

**Implementation:**
- New module: `packages/shared/src/candles/candleSource.ts` with `getCandles(symbol, tf, from, to)` and `getLatestCandle(symbol, tf, asOf)`.
- Update: `packages/setupEngine/src/contextBuilder.ts` `fetchLatestCandle()` to use the new abstraction.
- Update: `packages/shared/src/CANDLE_TABLE_BY_TF` consumers (live runner, backtest, setup engine) to go through `candleSource`.
- New migration: `infra/migrations/081_candle_rollup_runs.sql`.
- New script: `scripts/refresh-candle-rollups.js [symbol] [tf,...]` to warm caches.
- Delete or deprecate: direct `SELECT ... FROM candles_5m` in backtest signal SELECT (Change 3).

---

### Change 2 — Shared Feature Registry and PIT SQL Builder

**What:**
- Introduce a single `FeatureRegistry` in `packages/strategies/src/featureRegistry.ts` that declares every `features_*` table's contract:
  - `semanticType`: `state` | `event` | `level` | `distribution`
  - `timeColumn`, `timeframeColumn`
  - `validityColumns`: `validFrom`, `validUntil`, `invalidatedAt`, `mitigatedAt`
  - `defaultFreshnessMinutesByTf`
  - `joinPolicy`: `latest_as_of` | `active_window` | `candidate_set` | `sample_distribution`
  - `requiredColumns`, `equalityGroupByDefaults`
- The registry drives the compiler, the backtest, the live runner, and the setup engine. Hardcoded lists (`EVENT_FEATURES`, `LIFECYCLE_FEATURES`, `ALLOWED_FEATURES`, `ALLOWED_GROUP_BY`) are deleted.
- Refactor `compiler.ts` so that `buildPitLateral`, `buildFreshnessPredicate`, `translatePredicate`, and signal SELECT generation use the registry. The compiler exposes:
  ```ts
  compileStrategy(spec, { mode: "live" | "pit", from?, to?, symbol? })
  ```
- Delete the duplicated SQL builders in `scripts/backtest-pit-v2.js`. The backtest runner calls `compileStrategy(spec, { mode: "pit", from, to, symbol })` and only handles simulation, fill logic, and portfolio accounting.

**Why it fixes the root cause:**
The duplication between compiler and backtest is the root cause of the drift. A single registry and SQL builder means live and research use exactly the same PIT semantics, freshness rules, and predicate translation.

**Eliminates:**
- Bug #6 (`mitigated_at` mismatch): single `buildFreshnessPredicate` source.
- Bug #7 (`MAX(ts)` signal select): signal SELECT is generated by the compiler's registry-driven builder.
- Bug #8 (missing `biasAliases`): single `translatePredicate` implementation.
- Bug #13 (compiler/backtest fork): backtest no longer builds SQL.
- Bug #11 (event whitelist): registry semantic type replaces hardcoded whitelist.
- Bug #16 (warmup): registry `defaultLookbackBars` contributes to warmup calculation (Change 5).

**Reliability Guarantee:**
A strategy spec produces the same SQL shape in live and PIT modes. There is one place where feature semantics are defined, and all consumers read it.

**Implementation:**
- New file: `packages/strategies/src/featureRegistry.ts`.
- Refactor: `packages/strategies/src/compiler.ts` to delegate to registry-driven helpers.
- Refactor: `packages/strategies/src/signalBuilders/*.ts` (zone, orb, indicator, moving_average, fvg) to use registry helpers.
- Delete: SQL builder code in `scripts/backtest-pit-v2.js` (lines ~296–700).
- Add: `compileStrategy` PIT mode option.
- Update: `scripts/backtest-pit-v2.js` to call compiler and only simulate fills.
- Add: parity tests that compile every spec in `live` and `pit` mode and assert equivalent WHERE clauses.

---

### Change 3 — Strategy-Family-Aware Setup Evaluation and Explicit Backtest Modes

**What:**
- Make setup evaluation a **family-aware, opt-in quality layer**, not a universal hard block.
- Add a `setupProfile` field to strategy specs (or derive from `familyId`) with values such as:
  - `zone_reversal`: requires nearby untapped zone, OTE overlap, spread/volatility checks, HTF alignment
  - `orb_breakout`: requires opening-range geometry, displacement, session validity
  - `fvg_continuation`: requires FVG geometry, fill rules, directional alignment
  - `indicator` / `moving_average`: requires only the indicator/MA conditions and current price action; no zone requirement
- The setup engine loads the profile from the registry/spec and runs only the rules that are meaningful for that family.
- Introduce explicit backtest modes:
  - `research` — raw strategy edge; no setup engine, no live cost/gate assumptions
  - `execution_cost` — research + spread/slippage/fill model
  - `safety` — execution_cost + family-appropriate safety filters (spread, volatility, session)
  - `portfolio` — safety + account-level heat, daily loss/win, family limits
- Default backtest mode is `research` so the first question ("does the spec have an edge?") can be answered without generic blocking.

**Why it fixes the root cause:**
The setup engine was designed for one family and applied to all. That is an architectural overreach. Decoupling strategy logic from generic safety filters makes each layer correct for its own purpose.

**Eliminates:**
- Bug #14 (setup engine blocks ORB/MA/indicator/FVG strategies).
- Contributes to fixing Bug #1 impact: even with partial HTF tables, `research` mode can evaluate raw signals using deterministic candle rollups.

**Reliability Guarantee:**
A strategy is blocked only by rules that are semantically relevant to its family. Backtest results are annotated with the mode so "0 trades" is never ambiguous between "no edge" and "blocked by unrelated safety rule."

**Implementation:**
- New file: `packages/setupEngine/src/profiles.ts` mapping family/profile → rule sets.
- Update: `packages/setupEngine/src/rules/hardRules.ts` to accept `profile` and skip irrelevant checks.
- Update: `packages/setupEngine/src/evaluateSetup.ts` to load profile from spec.
- Update: `packages/strategies/src/specs/*.yaml` to add `setupProfile` where missing.
- Update: `scripts/backtest-pit-v2.js` to accept `--mode research|execution_cost|safety|portfolio` and only call `evaluateSetup` in `safety`/`portfolio` modes.
- Update: `packages/tradePipeline/src/liveRunner.ts` to pass family/profile to `evaluateSetup`.

---

### Change 4 — PIT Feature Snapshots Returned with Every Signal

**What:**
- The compiled signal SELECT must return a `feature_snapshot_json` column that records, for every feature row used to produce the signal:
  - `table`, `tf`, `ts`, `id` (primary key if available), and the values that satisfied the predicate.
- The registry drives the snapshot: every `pit_*` LATERAL alias and every lifecycle-valid row contributes its identity to the JSON.
- In live mode, gates consume `feature_snapshot_json` first. They only fetch truly live execution data separately (current broker spread, current market price).
- In backtest mode, the snapshot is persisted to the candidate audit table (Change 6) so every rejection is reproducible.

**Why it fixes the root cause:**
The live runner currently evaluates a signal against a different feature set than the one that generated it. Returning the exact PIT snapshot closes that audit gap and makes "the signal passed SQL but failed gates" a debuggable statement.

**Eliminates:**
- Bug #12 (live feature snapshot drift).
- Reduces impact of Bug #10 and #11: freshness checks in live mode can now be validated against the snapshot's `ts` values using registry-driven rules.

**Reliability Guarantee:**
Every signal carries an auditable record of the exact feature rows that produced it. Live gate decisions can be replayed against that same snapshot.

**Implementation:**
- Update: `packages/strategies/src/compiler.ts` `buildSignalSelect` to emit `feature_snapshot_json`.
- Update: `packages/tradePipeline/src/liveRunner.ts` `fetchLatestSignal` to extract the snapshot.
- Refactor: `packages/tradePipeline/src/liveRunner.ts` `fetchLatestFeatures` to prefer snapshot values and only query current spread/price.
- Update: `live_signal.source_json` schema to store the snapshot explicitly.
- Add: migration to widen `source_json` or add `feature_snapshot_json` column if needed.

---

### Change 5 — Data-Quality Preflight as a Hard Gate

**What:**
- Build a shared `preflight` module (`packages/strategies/src/preflight.ts`) used by both the backtest runner and the live runner.
- For each required table/tf, compute `expected_rows` from the timeframe and date range (e.g., 90 days of 5m = ~25,920 candles; 90 days of 15m pricing at 15m cadence = ~8,640).
- Coverage rules:
  - Candle tables: `coverage_ratio >= 0.98`, `gap_count == 0`.
  - State features: `coverage_ratio >= 0.95`.
  - Event features: at least one row in the lookback window if the strategy requires the feature; absence is allowed only when semantics say so.
  - Level features: at least one active lifecycle interval overlapping the evaluation window.
- If preflight fails, the backtest returns `status: BLOCKED_DATA_QUALITY` with a structured reason list, not `0 trades`. The live runner rejects the run with `data_quality`.
- Preflight uses deterministic candle metadata (Change 1) and the feature registry (Change 2) so coverage expectations are derived, not guessed.

**Why it fixes the root cause:**
The current preflight only checks `COUNT(*) > 0`. That is a coverage model from a prototype, not a production research system. Making data quality a first-class gate prevents silent false negatives.

**Eliminates:**
- Bug #9 (preflight false confidence).
- Prevents Bug #1 from producing misleading "0 trades" output.
- Catches Bug #4 and #5 at preflight instead of at zero-signal debugging.

**Reliability Guarantee:**
No backtest or live run proceeds with silently incomplete data. The system either has verified coverage or reports exactly what is missing.

**Implementation:**
- New file: `packages/strategies/src/preflight.ts`.
- Update: `scripts/backtest-pit-v2.js` to run preflight before compiling/simulating and return `BLOCKED_DATA_QUALITY`.
- Update: `packages/tradePipeline/src/liveRunner.ts` to run preflight after the stale-candle check.
- New migration: `infra/migrations/082_preflight_result_log.sql` to optionally log preflight outcomes.
- Add: unit tests for coverage ratio math and gap detection.

---

### Change 6 — Warmup Derived from Feature Requirements

**What:**
- Replace the fixed 200-candle entry-timeframe warmup with a computed warmup based on the maximum lookback required by the spec:
  - Indicator periods × indicator tf
  - Moving-average periods × MA tf
  - ATR period × ATR tf
  - HTF bias tree requirements (e.g., if the spec uses 1d/4h/1h bias, warmup must cover the longest)
  - Structure/pivot detection windows
  - Pricing dealing-range lookback
  - Explicit `lookbackBars` in conditions
- The registry (Change 2) contributes `defaultLookbackBars` per feature so new feature types automatically extend warmup correctly.

**Why it fixes the root cause:**
Warmup is currently a magic number tied to the entry timeframe. That is wrong for HTF-bias strategies (too short) and low-timeframe strategies (too long). Deriving it from requirements makes warmup correct by construction.

**Eliminates:**
- Bug #16 (warmup ignores feature requirements).

**Reliability Guarantee:**
Backtests never evaluate signals before all required features have had enough history to be valid, and never discard more data than necessary.

**Implementation:**
- New function: `packages/strategies/src/warmup.ts` `computeWarmupTs(spec, from, registry)`.
- Update: `scripts/backtest-pit-v2.js` `computeWarmupTs()` to use it.
- Update: `packages/strategies/src/featureRegistry.ts` to include `defaultLookbackBars`.
- Add: tests that verify warmup for HTF-bias specs is longer than entry-tf specs.

---

### Change 7 — Correct Event/State Join Policies

**What:**
- Use the registry's `joinPolicy` so each feature is joined correctly:
  - `state` → latest-as-of with timeframe-aware freshness.
  - `event` → bounded lookback, allow no match, ordered by strength/timestamp depending on feature.
  - `level` → active lifecycle window (`created_at <= asOf` AND (`invalidated_at IS NULL` OR `invalidated_at > asOf`)); for non-FVG zones also exclude rows where `mitigated_at <= asOf`.
  - `candidate_set` (e.g., pricing) → rank matching rows inside the lookback by how well they satisfy the predicate, not just by latest `ts`.
- Specifically for `features_pricing`: the LATERAL should return the **best valid candidate** for the bias direction inside the lookback window, not `DISTINCT ON (symbol)` of the latest row. For example, if the latest pricing position is `premium` but a `discount` row exists within the lookback during a bullish bias, the `discount` row should be selected.

**Why it fixes the root cause:**
Many of the zero-signal failures come from joining sparse or event-style features with state-style semantics. Correct join policies make the SQL match the actual meaning of the feature.

**Eliminates:**
- Bug #2 (pricing latest mismatch).
- Bug #3 (structure timing misalignment — event policy + correct freshness window).
- Bug #4 and #5 are caught at preflight (Change 5) but the event join policy ensures that when the data exists, it is used correctly.
- Bug #10 and #11 (freshness and whitelist) via registry-driven rules.

**Reliability Guarantee:**
Each feature is queried according to its semantic type. State features give current values; event features are searched but not required; level features respect their lifecycle interval; candidate-set features select the best match, not merely the latest.

**Implementation:**
- Update: `packages/strategies/src/compiler.ts` `buildPitLateral` to branch on `joinPolicy` from registry.
- Update: `packages/strategies/src/featureRegistry.ts` with correct `semanticType` and `joinPolicy` for every feature.
- Update: signal builders to use registry-driven candidate selection.
- Add: SQL-level tests that assert the correct join shape for each semantic type.

---

### Change 8 — Active Duplicate Detection and Order-Cooldown Policy

**What:**
- Split deduplication into three explicit policies:
  1. **Active exact duplicate:** same fingerprint with status `pending`, `sent`, or `filled` → block immediately.
  2. **Recently rejected duplicate:** same fingerprint with status `rejected` within `cooldownMinutes` → block.
  3. **Closed duplicate cooldown:** same fingerprint with status `closed` within `cooldownMinutes` and optionally losing → block.
- The live runner checks active duplicates inside the same transaction that holds `risk_state`, before inserting a new order.

**Why it fixes the root cause:**
The current dedup only looks at terminal states. A signal can be re-submitted while an identical order is still pending or filled, leading to double exposure.

**Eliminates:**
- Bug #15 (dedup ignores active duplicates).

**Reliability Guarantee:**
No two identical signals can produce concurrently active orders, and rejected/closed signals respect a configurable cooldown.

**Implementation:**
- Update: `packages/tradePipeline/src/liveRunner.ts` `findRecentDuplicate()` to query active statuses separately.
- Add: helper `findActiveDuplicate()`.
- Update: the transaction block in `runLivePipeline` to check active duplicate before `insertLiveSignal`/`createOrder`.
- Add: unit tests for each dedup policy.

---

### Change 9 — Candidate Audit Table for End-to-End Stage Visibility

**What:**
- Add a `strategy_signal_candidates` table that records every candidate at every stage:
  - `bias` → `setup` → `entry` → `signal` → `gate` → `trade`
- Columns include `run_id`, `mode`, `strategy_id`, `symbol`, `tf`, `candidate_ts`, `side`, `entry_price`, `stop_loss`, `take_profit`, `feature_snapshot_json`, `decision_stage`, `rejection_reason`, `simulated_outcome`.
- Both the backtest runner and the live runner write to this table. The backtest uses it to report stage counts (bias/setup/entry/signal/trade) instead of only final executed trades.

**Why it fixes the root cause:**
Currently the only observable outcome is "0 trades." Without stage-level audit data, it is impossible to distinguish "no bias" from "bias but no setup" from "setup but blocked by spread." The audit table makes the pipeline observable by design.

**Eliminates:**
- Indirectly all bugs: every rejection is recorded with a reason and snapshot.
- Specifically helps diagnose Bugs #2–#5, #10, #12, #14 by preserving the feature state at each stage.

**Reliability Guarantee:**
Every stage transition is observable and reproducible. A backtest cannot silently drop rows without leaving a trace.

**Implementation:**
- New migration: `infra/migrations/083_strategy_signal_candidates.sql`.
- New module: `packages/shared/src/audit/candidateAudit.ts` with `recordCandidate()`.
- Update: `scripts/backtest-pit-v2.js` to write stage rows.
- Update: `packages/tradePipeline/src/liveRunner.ts` to write stage rows.
- Add: views/summary queries for stage funnel analysis.

---

## 3. Implementation Roadmap

### Phase 1 — Unblock the Pipeline (Must Ship First)

| # | Change | Deliverable | Unblocks |
|---|---|---|---|
| 1.1 | Deterministic HTF candle source (Change 1) | `getCandles()` abstraction, `candle_rollup_runs` table, refresh script | Bug #1 impact; any backtest that needs 5m/15m/1h candles |
| 1.2 | Shared feature registry + compiler PIT mode (Change 2) | `featureRegistry.ts`, `compileStrategy(..., {mode:"pit"})`, delete duplicated SQL from backtest | Bugs #6, #7, #8, #13 |
| 1.3 | Family-aware setup + explicit backtest modes (Change 3) | `setupProfile`, `--mode research`, setup engine skips zone rules for non-zone families | Bug #14 |
| 1.4 | Data-quality preflight hard gate (Change 5) | `preflight.ts`, `BLOCKED_DATA_QUALITY` status | Bug #9, false "0 trades" |

**Exit criteria for Phase 1:**
- `node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v1 --mode research` runs without setup-engine blocking and reports stage counts.
- `node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --mode research` produces non-zero raw signals if the spec has an edge.
- If HTF data is missing, the run returns `BLOCKED_DATA_QUALITY` with a clear reason instead of silently returning 0 trades.

### Phase 2 — Make It Reliable

| # | Change | Deliverable | Fixes |
|---|---|---|---|
| 2.1 | Correct event/state/level join policies (Change 7) | Registry `semanticType`/`joinPolicy`, candidate-set pricing selection | Bugs #2, #3, #10, #11 |
| 2.2 | PIT feature snapshots in signal SQL (Change 4) | `feature_snapshot_json` column, live gate consumption | Bug #12 |
| 2.3 | Derived warmup (Change 6) | `computeWarmupTs(spec, registry)` | Bug #16 |
| 2.4 | Active duplicate detection (Change 8) | `findActiveDuplicate()`, transaction ordering | Bug #15 |
| 2.5 | Candidate audit table (Change 9) | `strategy_signal_candidates` table + writes from backtest/live | Observability for all bugs |

**Exit criteria for Phase 2:**
- Backtest and live produce identical signal SQL for the same spec (parity tests pass).
- Live runner can replay a rejection using the persisted feature snapshot.
- Every rejected candidate has a recorded stage and reason.

### Phase 3 — Make It Maintainable

| # | Work | Purpose |
|---|---|---|
| 3.1 | Delete dead SQL from `scripts/backtest-pit-v2.js` | Remove the duplicated compiler logic permanently |
| 3.2 | Add compiler/backtest parity test suite | Compile every spec in both modes; assert WHERE clause equivalence |
| 3.3 | Add feature-registry contract tests | Every `features_*` table has a registry entry with valid semantic type |
| 3.4 | Add data-quality regression tests | Mock partial HTF tables; assert `BLOCKED_DATA_QUALITY` |
| 3.5 | Add live pipeline replay tests | Inject a signal with snapshot; assert gate evaluation uses snapshot values |
| 3.6 | Document the new spec fields (`setupProfile`, `joinPolicy`, etc.) in `AGENTS.md` | Keep agent/human docs in sync |

---

## 4. Risks and Tradeoffs

### Change 1 — Deterministic HTF Rollups
- **Risk:** Rolling up 90 days of 1m → 5m/15m/1h on demand is CPU/memory intensive if done naively in the backtest process.
- **Mitigation:** Cache rollups in physical tables with metadata. The abstraction reads the cache when valid and only recomputes when stale. Warm caches with a scheduled job.
- **Tradeoff:** Slightly higher storage for metadata and cached tables, but eliminates the operational risk of partial backfills.

### Change 2 — Shared SQL Builder
- **Risk:** Refactoring the compiler while the backtest still depends on its current output can introduce short-term instability.
- **Mitigation:** Keep the old backtest SQL builder behind a feature flag initially. Run parity tests on every spec before deleting it.
- **Tradeoff:** Temporary duplication during the migration window, but the end state is a single source of truth.

### Change 3 — Family-Aware Setup + Backtest Modes
- **Risk:** Existing specs do not have `setupProfile`; defaulting incorrectly could change behavior.
- **Mitigation:** Default to `zone_reversal` for existing S/D specs (preserves current behavior) and require `setupProfile` for new non-zone specs. Backtest default mode becomes `research`, which is the safest starting point for debugging.
- **Tradeoff:** `research` mode results will differ from current live behavior, but that is intentional: live behavior was over-blocking.

### Change 4 — Feature Snapshots
- **Risk:** Large `feature_snapshot_json` payloads increase row size and network overhead.
- **Mitigation:** Snapshot stores only row identifiers and key predicate-satisfying values, not full rows. Live runner can still fetch full rows for gates if needed, but preferentially uses the snapshot.
- **Tradeoff:** Slightly larger `live_signal` rows, but auditability is worth the cost.

### Change 5 — Data-Quality Preflight
- **Risk:** Strict coverage ratios can block backtests during normal market holidays or broker downtime.
- **Mitigation:** Allow a configurable `minCoverageRatio` per run and per table type. Report gaps explicitly so the operator can override if the gap is expected.
- **Tradeoff:** More upfront runs fail with `BLOCKED_DATA_QUALITY`, but failures are now honest instead of misleading.

### Change 7 — Candidate-Set Pricing Selection
- **Risk:** Selecting a non-latest pricing row could produce signals at historical prices that no longer match current market conditions.
- **Mitigation:** Candidate selection is bounded by the lookback interval from the spec. The live runner still validates current execution quality (price distance) before sending the order.
- **Tradeoff:** More signals in research mode, but live execution quality gate remains the final guard.

---

## 5. Verification Strategy

### Unit / Integration Tests

| Test | What it proves |
|---|---|
| `compiler.parity.test.ts` | For every spec in `packages/strategies/src/specs/`, `compileStrategy(spec, {mode:"live"})` and `compileStrategy(spec, {mode:"pit"})` generate equivalent WHERE/freshness/join logic. |
| `featureRegistry.contract.test.ts` | Every `features_*` table referenced by a spec has a registry entry with a valid `semanticType` and `joinPolicy`. |
| `candleSource.coverage.test.ts` | `getCandles()` returns complete, gap-free HTF series from `candles_1m` when the cache is invalid. |
| `preflight.block.test.ts` | A backtest with 497 rows in 90 days of `candles_5m` returns `BLOCKED_DATA_QUALITY` with reason `coverage_ratio < 0.98`. |
| `live.snapshot.test.ts` | A mock signal with `feature_snapshot_json` is gated using the snapshot values, not a separate re-fetch. |
| `setup.family.test.ts` | An ORB spec with `setupProfile: orb_breakout` is not blocked by "no active zones." |
| `dedup.active.test.ts` | A signal whose fingerprint matches a `filled` order is blocked as an active duplicate. |
| `warmup.htf.test.ts` | A spec using 1d bias has a warmup longer than 200 × entry-tf candles. |

### Backtest Comparisons

After Phase 1 + Phase 2, run the same commands from the source report and expect different outcomes:

```bash
# Before fix: 0 trades, blocked by setup engine / missing candles
# After fix: stage counts visible, raw signals produced in research mode
node scripts/backtest-pit-v2.js XAUUSD 90 keylevel_bounce_v1 --mode research --json
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd       --mode research --json
node scripts/backtest-pit-v2.js XAUUSD 90 forex_strategy_orb --mode research --json
node scripts/backtest-pit-v2.js XAUUSD 90 smart_risk_ob_ifvg_1m --mode research --json
```

**Acceptance criteria:**
1. No run returns `executed: 0` without also reporting `stage_counts` and a clear `final_stage` (`data_quality`, `no_setup`, `no_entry`, `blocked_setup`, `blocked_gate`, `executed`).
2. `research` mode for `doyle_sd` and `forex_strategy_orb` produces non-zero raw signals (the strategy edge is no longer hidden by generic setup rules).
3. If HTF rollups have not been refreshed, the run returns `BLOCKED_DATA_QUALITY` rather than `0 trades`.

### Live Shadow Verification

Before enabling live order creation:
1. Run the live pipeline in **paper/dry-run mode** for 24–48 hours.
2. Compare every generated signal's `feature_snapshot_json` against the separately fetched gate features.
3. Assert zero drift: for every field used by gates, the snapshot value and the gate value must be identical except for current spread/price.
4. Count rejections by stage and reason; confirm no ORB/MA/indicator signals are rejected by "no active zones."

### Observability Dashboards

Use the `strategy_signal_candidates` table to build:
- Funnel: `bias_count → setup_count → entry_count → signal_count → gate_passed → executed_count` per spec.
- Rejection reason breakdown per spec/family.
- Data quality block rate over time.
- Live-vs-backtest signal count parity (same spec, same window).

---

## Summary

The system is not broken by 16 independent bugs. It is broken because:

1. HTF data has no reliable source of truth.
2. Feature semantics are implicit and hardcoded in duplicated SQL.
3. The compiler and backtest are two forked SQL generators.
4. The setup engine assumes every strategy is a supply/demand reversal.
5. Live evaluation uses a different feature snapshot than signal generation.

The fixes above make the pipeline **correct by construction**: deterministic data, a single feature registry, a single SQL builder, family-aware safety layers, and auditable PIT snapshots. The result is a system where "0 trades" means the strategy genuinely had no edge in the tested window, not that the plumbing silently failed.
