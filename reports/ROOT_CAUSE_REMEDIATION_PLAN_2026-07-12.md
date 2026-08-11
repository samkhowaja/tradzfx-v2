# Root-Cause Remediation Plan: tradzfx-v2 Feature Pipeline & Backtest Architecture

**Date**: 2026-07-12
**Scope**: Architectural remediation for the 16 bugs cataloged in `BACKTEST_FAILURES_AND_BUGS_2026-07-10_V3.md`
**Constraint**: No bandaids. Permanent, structural fixes only. Correct by construction, not correct by careful manual alignment of duplicated code.

---

## 0. Overall Assessment (Independent Review — Kimi Code, 2026-07-11)

**Verdict: this is a high-quality root-cause analysis. The 7 root causes are real, correctly grouped, and the "correct by construction" framing is the right north star.** I independently verified every major claim against the current source tree and the live database. Four caveats the reader must apply:

1. **The report is partially stale at publication time.** P0-1…P0-5 of the V4 fix program shipped on 2026-07-11 (ORB session-scoped join in *both* SQL forks, spread-unit/pip-math fixes + data repair, zone PIT timeout fix with predicate pushdown + covering index 107, risk-ATR producer collection + `tz-refresh-lifecycle` pm2 cron, `spec.warmupBars` + dependency-graph `computeWarmupBars`). Separately, a parallel implementation session has already landed large parts of Change 3 (family-aware `setupEngine`: `hardRules.ts`, `evaluateSetup.ts`, `graders/entryQuality.ts`, `contextBuilder.ts` all modified) and Change 5 (migrations `108`–`113`, including `market_zone_objects` and `zone_touch_event_ledger`). Per-issue reviews below mark what is DONE / IN PROGRESS / OPEN.
2. **Two claims are measurably understated or wrong.** RC-5's duplication is ~55×, not ~5× (measured 273 zone rows per 5m bar vs a contract max of 5). Change 6's spread-cap proposal conflates the *sanity quarantine cap* (10×) with the *trading gate* (4×) — adopting it verbatim would loosen the live gate 2.5× beyond intent.
3. **The sequencing of Change 1 carries a hidden trap.** Measured parity: the compiler path strictly *under-emits* vs legacy (ORB 9 vs 12 signals XAU 30d; `doyle_sd` 0 vs 17; a_plus FVG 2 vs 24). Deleting the legacy fork before closing that gap would silently *lose* live signals. Parity harness first, then delete.
4. **Change 5's risk section dismisses a real PIT-correctness loss.** Collapsing to one row per zone preserves as-of *validity* (via `invalidated_at`/`mitigated_at` timestamps) but destroys as-of history of evolving metrics (`fill_pct`, `touch_count`). The tree already points at the better answer: immutable touch-event ledger (migration 112) + current-state object row (migration 113).

The single highest-leverage addition to this plan (Section 6 below): **unify the decision core, not just the SQL** — one `evaluateCandidate()` path with an injected clock, used by both live and backtest. That makes live/backtest parity a structural property instead of a test, and subsumes RC-1, RC-2 and bug #12 in one move.

---

## Table of Contents

1. [Root Cause Analysis](#1-root-cause-analysis)
2. [Architectural Changes (Priority-Ordered)](#2-architectural-changes-priority-ordered)
3. [Implementation Roadmap](#3-implementation-roadmap)
4. [Risks and Tradeoffs](#4-risks-and-tradeoffs)
5. [Verification Strategy](#5-verification-strategy)
6. [Higher-Leverage Alternative & Complementary Proposals (Kimi Code)](#6-higher-leverage-alternative--complementary-proposals-kimi-code-2026-07-11)

> **Review annotations**: Sections 0 and 6 plus per-issue "🔍 Independent Review (Kimi Code, 2026-07-11)" blocks were added after independent verification of every claim against the current source tree and live database.

---

## 1. Root Cause Analysis

After tracing through the actual source code (`compiler.ts`, `sqlBuilder.ts`, `backtest-pit-v2.js`, `hardRules.ts`, `contextBuilder.ts`, `liveRunner.ts`, `featureRegistry.ts`, `candleSource.ts`, `zone.ts`, `feature-capability.js`, `validate.ts`), the 16 bugs group into **7 systemic root causes**. Each is a structural flaw that produces multiple symptoms.

---

### RC-1: Two Independent SQL Generation Codepaths (Compiler vs Backtest Fork)

**Systemic flaw:** The strategy compiler (`packages/strategies/src/compiler.ts`) and the PIT backtest runner (`scripts/backtest-pit-v2.js`) maintain **independent** SQL generation logic. The backtest script has its own `translatePredicate()`, `buildFreshnessPredicate()`, `buildPITSignalSelect()`, `resolvePitTimeframes()`, and `buildAtrJoins()` — all hand-written copies of compiler logic that have diverged. The `PIT_USE_COMPILER_SQL=1` env flag exists to route through the compiler, but it is **off by default** and the compiler path has its own bugs (RC-2).

**Bugs caused:** #6 (missing `mitigated_at` check in freshness predicate), #7 (missing `biasAliases` parameter in backtest's `translatePredicate`), #8 (signal SELECT uses `MAX(ts)` instead of LATERAL PIT joins), #13 (compiler/backtest parity break for ORB).

**Evidence in code:**
- `backtest-pit-v2.js:366-426` — `translatePredicate()` is a 60-line copy of `compiler.ts:797-899` but lacks the `biasAliases` parameter, so multi-timeframe bias confluence breaks.
- `backtest-pit-v2.js:986-1008` — `buildFreshnessPredicate()` is a hand-written copy that has already diverged (the compiler version in `sqlBuilder.ts:126-167` is registry-driven).
- `backtest-pit-v2.js:117` — `USE_COMPILER_SQL = process.env.PIT_USE_COMPILER_SQL === "1"` — off by default.

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Confirmed, and it is the deepest structural wound in the repo — but the measured parity gap makes "delete the legacy fork" a *destination*, not a *first step*.** On 2026-07-11 both forks received the P0-1 (ORB session-scoped join) and P0-3 (zone predicate pushdown, registry-bounded lookback, LATERAL candles join) fixes, so they are currently closer than ever. Yet parity runs show the compiler strictly *under-emits*: ORB legacy 12 vs compiler 9 day-signals (XAU 30d), `doyle_sd` legacy 17 vs compiler **0**, a_plus FVG legacy 24 vs compiler 2. The compiler is not yet a safe sole path. Correct sequence: (1) golden-fixture parity harness (Section 6-C), (2) fix compiler under-emission until the compiler is a *superset* with explained diffs, (3) flip the default, (4) keep legacy behind the flag for one release, (5) delete. Skipping to deletion trades a visible fork bug for an invisible signal-loss bug.

---

### RC-2: Signal SELECT Bypasses the Feature Registry

**Systemic flaw:** The setup/entry condition LATERALs in both the compiler and backtest use `buildPitLateral()` (registry-driven, with proper join policies, lookback bounds, and freshness predicates). But the **final signal SELECT** — which joins `features_pricing`, `features_atr`, `features_indicator`, `features_moving_average`, and `features_opening_range` — uses **hand-written `MAX(ts)` subqueries** that bypass the registry entirely. A `MAX(ts)` join returns the single latest row regardless of whether it matches the strategy's predicate, so even when a matching row exists, it's ignored if a newer non-matching row exists.

**Bugs caused:** #2 (features_pricing LATERAL DISTINCT ON picks only the latest row, ignoring matching rows), #8 (signal SELECT uses MAX(ts)), #13 (ORB stale-range join — partially fixed with `buildOrbSessionScopedJoin` but the pattern is still MAX(ts) for other features).

**Evidence in code:**
- `compiler.ts:447-449` — `buildAtrJoins()` uses `AND ${alias}.ts = (SELECT MAX(ts) FROM features_atr WHERE ...)` — a correlated subquery, not a LATERAL.
- `compiler.ts:563-564` — `JOIN features_pricing p ON ... AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE ... ts <= e.ts)` — picks the latest row even if it doesn't match the pricing filter.
- `compiler.ts:630-631` — Same pattern for zone signal SELECT.
- `backtest-pit-v2.js:744-746` — Same `MAX(ts)` pattern in the backtest's ORB signal SELECT.

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Partially stale, and the bug class is narrower than stated.** Fixed 07-11: the ORB join is now date+session-scoped in both forks, and the FVG candles join is a point-lookup LATERAL (the 90d-timeout hotspot). Remaining `MAX(ts)` surfaces verified today: `features_pricing` (compiler.ts:563), `features_atr` (`buildAtrJoins`), indicator/MA joins. Important nuance the report misses: `MAX(ts)` is **semantically correct for pure state-value reads** — the ATR join's only predicate (`period = 5`) is *inside* the subquery, so "latest row regardless of predicate" cannot misfire there. The genuine bug class is joins whose row must satisfy a *filter predicate* — that is `features_pricing` today. Recommendation: convert the pricing join to a predicate-pushed LATERAL first (correctness), convert ATR/indicator joins for uniformity second (consistency, not correctness). Do not burn a rewrite cycle treating all `MAX(ts)` joins as equally broken.

---

### RC-3: Setup Engine Applies Zone-Reversal Hard Rules Universally

**Systemic flaw:** The setup engine's `hardRules.ts` gates zone-specific rules behind `requiresZoneEntry()`, but the **graders** (`trendAlignment`, `entryQuality`, `riskQuality`, `confirmation`) and the **context builder** always fetch zones, derive an entry zone, and compute zone-based quality scores regardless of strategy family. An ORB strategy gets graded on zone proximity, a moving-average strategy gets blocked because "all nearby zones have already been tapped," and an FVG strategy fails because "no entry zone within 1.5 ATR." The setup engine is not family-aware in its grading — only in its hard rules.

**Bugs caused:** #14 (setup engine blocks ORB, FVG, indicator, and MA strategies for zone-related reasons).

**Evidence in code:**
- `hardRules.ts:3-5` — `requiresZoneEntry()` checks `setupFamily === "zone_reversal" || signalSource === "zone"`, but the context builder always fetches zones and derives an entry zone.
- `contextBuilder.ts:84` — `deriveEntryZone()` always runs, even for non-zone strategies.
- `evaluateSetup.ts:145-148` — `gradeEntryQuality()` always scores based on zone overlap/quality, regardless of family.
- The V4 sweep confirmed: `orb_classic` 36 raw → 35 setup-blocked → 0 executed; `waqar_v2` 1,610 raw → 1,505 setup-blocked → 60 executed.

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Confirmed — this is the #1 functional blocker for full-mode backtests and live, and I agree with its P0 placement.** Two qualifications: (1) the default backtest mode is `fast` (setupProfile `skip`), so research-mode numbers were never distorted by this — the blast radius is `full` mode and the live runner; (2) **already IN PROGRESS in the working tree**: `hardRules.ts`, `evaluateSetup.ts`, `graders/entryQuality.ts`, `contextBuilder.ts`, `types.ts` are all modified with family-aware dispatch. The report should be read as the design doc for work that is mid-flight, not as a fresh proposal. Also note the 07-11 spread fixes (pipMath 4-digit, USDSEK registration, producer caps) removed a large share of the 14,670 live rejections' *spread* component — re-measure the block-reason distribution after market open before sizing the remaining family-aware work.

---

### RC-4: No Feature/Tf Capability Contract Enforcement at Seed Time

**Systemic flaw:** The capability matrix (`feature-capability.js`) exists and classifies feature/tf/symbol surfaces into verdicts (`MISSING_TABLE`, `EMPTY_DENSE`, `STALE_STATE`, etc.). But this matrix is only checked **at backtest preflight** — specs are seeded and promoted without validating that their required feature/tf surfaces actually exist and are populated. A spec requiring `features_zone_retest@1m` (0 rows) or `features_candle_pattern@1m` (0 rows) is seeded successfully, then produces zero trades in backtest with no explanation until a human runs preflight. Warmup is similarly disconnected: it uses a fixed 200-bar window on the entry timeframe, ignoring the actual feature dependency graph and their lookback requirements.

**Bugs caused:** #1 (preflight only warns on zero rows, not insufficient density), #9 (497 rows in 90 days passes as "covered"), #16 (warmup ignores indicator lookback, HTF bias, pricing dealing ranges).

**Evidence in code:**
- `validate.ts:36-89` — `validateSpec()` checks structural validity (session-scoped features, setupFamily, warmupBars ≥ 50) but **never checks feature/tf capability**.
- `backtest-pit-v2.js:532-553` — `checkCoverage()` counts rows but only blocks on `rows === 0`; 497 rows passes.
- `backtest-pit-v2.js:139-162` — `computeWarmupBars()` computes from spec conditions and registry lookback defaults, but doesn't account for HTF bias context windows or pricing dealing range stabilization.

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Half-done already.** Shipped 07-11: `validate.ts` exists and runs at seed time (session-scoped ORB rules, `signalSource` consistency); `spec.warmupBars` is wired end-to-end with a ≥50 floor; `computeWarmupBars()` now derives the window from condition lookbacks × tf-ratio, registry `defaultLookbackBars`, numeric periods in predicates, and MA fast/slow periods. Also shipped: the P0-4 producer-collection gap (risk-expression `atr(<tf>)` refs now collected by `pipelineTrigger` and enforced by the live freshness guardrail) — the "spec references a feature nobody produces" failure mode is closed for ATR. Still genuinely open: (1) capability-matrix verdicts (`EMPTY_DENSE`, `STALE_STATE`) enforced at seed/promote time — the `feature-capability.js` matrix exists but is not called by `seed-strategy-specs.js`; (2) `checkCoverage()` still passes 497-rows-in-90d as "covered" — needs a density floor (rows per expected bar), not a zero check. Both are small, high-value additions to the existing validation seam.

---

### RC-5: No Stable Zone Identity or Lifecycle Expiry

**Systemic flaw:** Zones are identified by floating-point geometry (`top`, `bottom`, `zone_kind`, `direction`, `ts`). There is no stable `zone_id` or `anchor_hash`, so the same zone is re-emitted as a new row on every bar it remains visible. With 5m candles producing ~25,920 bars in 90 days and up to 5 zones per bar (`ZONE_MAX_PER_BAR = 5`), a single symbol/tf can generate up to 129,600 zone rows — and the DB estimate shows 24.6M rows across all symbols/tfs. No lifecycle expiry means old zones accumulate indefinitely. This causes query timeouts (the A+ ORB/FVG strategy hits the 5-minute statement timeout) and makes PIT lookups scan massive row counts.

**Bugs caused:** #5 (structure events don't temporally align with bias+zone setup rows — exacerbated by zone table size), statement timeout on complex strategies (BUG-3.5), zone table explosion (24.6M rows).

**Evidence in code:**
- `zone.ts:514-537` — `serialize()` emits one row per zone per bar, with no deduplication by stable identity.
- `zone.ts:45-46` — `ZONE_MAX_PER_BAR = 5` — up to 5 zones per bar, every bar.
- No `zone_id` or `anchor_hash` column in the registry's `requiredColumns` for `features_zone`.
- V4 evidence: `features_zone` ~24.6M rows; XAUUSD 5m = 2.31M rows in 90d.

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Confirmed — and measured ~55× worse than the report's model.** The report assumes ≤5 rows/bar (`ZONE_MAX_PER_BAR`). Measured today: XAUUSD 5m, 90d = **2,305,251 rows over 8,437 distinct bars = 273 rows/bar** (worst single bar: 117 rows). The dominant pathology is not per-bar re-emission; it is **re-insertion by every backfill run because there is no natural key** — the table is ~55× duplicated history, not 5× over-emission. This reframes the fix: the 100× win is a *write-time natural-key dedupe* — unique index on `(symbol, tf, ts, zone_kind, direction, rounded geometry)` + `ON CONFLICT DO NOTHING` — which collapses the table ~50× with **zero semantic change** and is safe to run today. Do that first; the `zone_id` redesign (Change 5) then becomes a modest evolution instead of emergency surgery. Note the tree already anticipates the end state: migration 112 (`zone_touch_event_ledger`, immutable events) + 113 (`market_zone_objects`, current-state dedupe layer) — that two-table split (immutable events + mutable current row) is exactly the right shape and preserves PIT history that naive one-row-per-zone collapse would destroy.

---

### RC-6: Asset-Class-Blind Gates and Thresholds

**Systemic flaw:** The volatility gate has percentile-based policy support (`maxAtrPercentile` resolved against `market_volatility_profile`), making it asset-class-safe. But this is **opt-in** — specs must explicitly configure percentile policies. The default is absolute pip thresholds (`maxAtr5Pips`), which are calibrated for FX (2-5 pips) and block XAUUSD (ATR5 median = 49.9 pips) 100% of the time. There is no symbol contract layer that auto-configures gates based on asset class. Similarly, the setup engine's `maxAllowedSpreadPips` uses `Math.max(pair.baseSpreadPips * 4, 3)` — a formula that works for FX but produces unrealistic caps for metals.

**Bugs caused:** BUG-3.1 (volatility gate blocks 100% of XAUUSD trades), #10 (fixed 5-minute max age for all features — partially fixed in liveRunner but not in setup engine), #11 (event feature whitelist incomplete — `features_zone` not treated as event feature in backtest's `EVENT_FEATURE_TABLES`).

**Evidence in code:**
- `volatilityGate.ts:145` — `maxAtr5Pips = config.sessionMaxAtr5Pips?.[session] ?? config.maxAtr5Pips` — absolute pips by default.
- `contextBuilder.ts:81` — `maxAllowedSpreadPips = Math.max(pair.baseSpreadPips * 4, 3)` — universal formula.
- `backtest-pit-v2.js:567-573` — `EVENT_FEATURE_TABLES` is a hardcoded set that doesn't include `features_zone` (which has event-like sparsity for retest/touch events).

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Partially stale; the remaining core point (percentile-by-default) is right, but one proposed fix is wrong.** Already shipped: XAU volatility-gate calibration (V3 P6-1), the pip-math 4-digit fix + USDSEK registration + producer/ingest spread caps (07-11, P0-2), and `EVENT_FEATURE_TABLES` verified still hardcoded without `features_zone` — the registry already has `semanticType: "event"`, so deriving the set from the registry (as the report suggests) is a 5-line fix; do it. **Objection to Change 6's spread-cap proposal:** replacing `maxAllowedSpreadPips = max(base*4, 3)` with `base * SPREAD_SANITY_MULTIPLIER` (10) conflates two different layers — 4× is a *trading gate* ("is this spread acceptable to enter?"), 10× is a *data-quarantine cap* ("is this sample garbage?"). Adopting it verbatim loosens the live entry gate 2.5× beyond intent for every pair. The correct asset-class fix: an explicit per-class multiplier in `pair_characteristics` (e.g. metals 6×, FX 4×, exotics 8×) or an observed-spread percentile from `features_spread` — both preserve the gate's economic meaning. Percentile-default for the volatility gate (p95 from `market_volatility_profile` when unset) is endorsed without reservation.

---

### RC-7: No Candidate Audit Trail

**Systemic flaw:** There is no `strategy_signal_candidates` table that persists every accepted/rejected candidate with the exact feature/candle/direction/gate snapshot at the moment of evaluation. The live runner fetches features separately from the features that generated the signal (`fetchLatestFeatures` vs the compiled SQL's embedded joins), causing audit drift. The backtest runner persists only executed trades, not rejected candidates. "Why no trades?" requires manual SQL archaeology across `live_signal`, `live_signal_rejection`, `orders`, and feature tables.

**Bugs caused:** #12 (live signal evaluation fetches features separately from signal-generation features), #15 (deduplication doesn't check active pending/filled orders — `findRecentDuplicate` only checks `rejected`, `expired`, `closed` statuses).

**Evidence in code:**
- `liveRunner.ts:174-190` — `findRecentDuplicate()` checks `status IN ('rejected', 'expired', 'closed')` — missing `pending` and `filled`, so a duplicate signal can be re-submitted while the first order is still active.
- `liveRunner.ts:1050-1341` — `fetchLatestFeatures()` does 10+ separate queries, each with its own `ts <= signal.ts` filter, but these are **not** the same features that the compiled SQL used to generate the signal.
- No `strategy_signal_candidates` table exists in the schema.

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Confirmed, including the dedup hole — I verified `liveRunner.ts:183` today: `status IN ('rejected','expired','closed')` excludes `pending` and `filled`, so a duplicate signal can be re-submitted while its order is live. That is a real-money double-entry bug; fix it this week as a one-line change, independent of the audit table.** On the audit table itself: the design is right, but reject synchronous row-per-candidate writes in the live hot path (the report's own risk section underestimates this — a DB hiccup would then *block trading*). The repo already has the answer from the ingest-resilience work: append candidates to a JSONL spool, batch-insert on a tick, quarantine on failure. Same auditability, zero hot-path coupling. And the deeper fix for bug #12 (live fetches features separately from the signal SQL): don't mirror the snapshot — **share the evaluation** (Section 6-A): one decision core consumed by both live and backtest makes audit drift structurally impossible rather than merely recorded.

---

### Root Cause → Bug Mapping

| Root Cause | Bugs Eliminated |
|------------|----------------|
| RC-1: Two SQL codepaths | #6, #7, #8, #13 |
| RC-2: Signal SELECT bypasses registry | #2, #8, #13 |
| RC-3: Universal zone-reversal setup rules | #14 |
| RC-4: No capability contract at seed time | #1, #9, #16 |
| RC-5: No stable zone identity | #5, BUG-3.5 (timeout) |
| RC-6: Asset-class-blind gates | BUG-3.1, #10, #11 |
| RC-7: No candidate audit trail | #12, #15 |

---

## 2. Architectural Changes (Priority-Ordered)

### Change 1: Unify SQL Generation — One Compiler, One Path

**What:** Delete the backtest's independent SQL generation codepath. Make `compileStrategy()` the sole SQL generator for both live and PIT modes. The backtest runner calls `compileStrategy(spec, { mode: "pit", from, to, symbol, trustStoredLifecycle: false })` directly — no `PIT_USE_COMPILER_SQL` flag, no legacy fork. The compiler's `CompileOptions` already supports `mode: "pit"`, `from`, `to`, `symbol`, `debug`, and `trustStoredLifecycle`. The backtest runner retains only trade simulation, gate evaluation, and persistence — all SQL generation goes through the compiler.

**Why it fixes RC-1:** The root cause is two codepaths that must stay in sync but don't. By deleting the fork, there is nothing to sync. The compiler is the single source of truth for SQL generation.

**Eliminates:** Bugs #6, #7, #13 (compiler/backtest drift), and the maintenance burden of keeping `translatePredicate`, `buildFreshnessPredicate`, `buildPITSignalSelect`, `resolvePitTimeframes`, `buildAtrJoins` in sync across two files.

**Reliability guarantee:** Any SQL generated for a strategy spec is identical whether it runs in live mode, PIT backtest, or debug/stage-count mode. A signal that appears in backtest will use the same join logic as live.

**Implementation:**
- `scripts/backtest-pit-v2.js`: Remove `translatePredicate()`, `buildFreshnessPredicate()`, `buildPITSignalSelect()`, `resolvePitTimeframes()`, `buildAtrJoins()`, `buildAtrSelectColumns()`, `bindAtrReferences()`, `stripPitFreshness()`, `orderByTieBreaker()`, `pitLookbackInterval()`, `lateralLookbackInterval()`, `buildLegacyPushdown()`, `isFvgZoneCondition()`, `needsLifecycleCheck()`, `timeWindowsToSql()`. Replace `compilePITSQL()` with a direct call to `compileStrategy()`.
- `packages/strategies/src/compiler.ts`: Ensure `compileStrategy()` accepts all needed PIT options (it already does). Add a `signalSelectMode` option if the backtest needs the signal SELECT to be parameterized differently (e.g., for `--debug` stage counts).
- Add a parity test (`scripts/backtest-pit-v2.test.js` or `packages/strategies/src/compiler.test.ts`) that asserts the compiler's PIT SQL produces identical candidate IDs to the legacy fork for a known spec/symbol/window, then delete the legacy fork.

**Key files:**
- `scripts/backtest-pit-v2.js` (delete ~600 lines of duplicated SQL logic)
- `packages/strategies/src/compiler.ts` (ensure PIT mode is complete)
- `packages/strategies/src/sqlBuilder.ts` (ensure all helpers are exported)

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Right destination, wrong first move — and the plan under-scopes the parity work.** The implementation list says "add a parity test … then delete the legacy fork," but measured gaps (doyle_sd: compiler 0 vs legacy 17 signals) show the compiler path has *functional* under-emission bugs, not just drift. Budget the parity closure as the main effort (1–2 weeks of fixture-driven debugging), not a test afterthought. Also: the ~600-line deletion list includes helpers the legacy simulation still needs (e.g. `pitLookbackInterval` semantics now registry-aligned per P0-3) — audit each for non-SQL callers before deleting. **Stronger version of this change: unify one level higher** — a single `evaluateCandidate(spec, snapshot, clock)` decision core shared by live and backtest (Section 6-A). Unifying SQL alone still leaves the backtest's gate/setup/simulation pipeline as a second codepath that can drift from `liveRunner`.

---

### Change 2: Registry-Driven Signal SELECT — Kill All `MAX(ts)` Joins

**What:** Replace every hand-written `MAX(ts)` subquery in the signal SELECT (`buildZoneSignalSelect`, `buildOrbSignalSelect`, `buildIndicatorSignalSelect`, `buildMovingAverageSignalSelect`, `buildFvgSignalSelect`, `buildAtrJoins`) with registry-driven `buildPitLateral()` calls. The signal SELECT should join features using the same LATERAL pattern as setup/entry conditions, with the registry's join policy, lookback bounds, and freshness predicates. For `features_pricing` (joinPolicy: `candidate_set`), the LATERAL should apply the pricing predicate inside the subquery, not in the outer WHERE — this fixes the bug where `MAX(ts)` picks a non-matching row.

**Why it fixes RC-2:** The root cause is that the signal SELECT bypasses the registry and uses `MAX(ts)` which returns the latest row regardless of predicate match. By using `buildPitLateral()`, the signal SELECT gets the same registry-driven join semantics as setup/entry conditions: bounded lookback, freshness predicates, and predicate pushdowns.

**Eliminates:** Bug #2 (features_pricing LATERAL picks only latest row), #8 (MAX(ts) instead of LATERAL PIT joins), and prevents future drift between signal SELECT and setup/entry joins.

**Reliability guarantee:** Every feature join in the compiled SQL — whether setup, entry, or signal SELECT — uses the same registry-driven LATERAL pattern with the same join policy, lookback, and freshness rules. No feature is joined with a hand-written subquery.

**Implementation:**
- `packages/strategies/src/compiler.ts`:
  - `buildAtrJoins()` → replace with `buildPitLateral()` calls for each ATR tf. The ATR condition is constructed synthetically: `{ feature: "features_atr", tf, predicate: "period = 5", required: true, id: "atr_<tf>" }`.
  - `buildZoneSignalSelect()` → replace `JOIN features_pricing p ON ... MAX(ts)` with `JOIN ${buildPitLateral(pricingCond, "p", "e")}` where `pricingCond` includes the spec's pricing predicate.
  - `buildOrbSignalSelect()` → same for pricing; ORB already uses `buildOrbSessionScopedJoin` for opening_range.
  - `buildIndicatorSignalSelect()`, `buildMovingAverageSignalSelect()`, `buildFvgSignalSelect()` → same pattern.
- `packages/strategies/src/sqlBuilder.ts`: Add a `buildSignalLateral()` variant if the signal SELECT needs slightly different aliasing (e.g., `e` instead of `b`/`s` as the anchor ref). Or generalize `buildPitLateral()` to accept an arbitrary anchor alias.

**Key files:**
- `packages/strategies/src/compiler.ts` (rewrite all `build*SignalSelect` functions)
- `packages/strategies/src/sqlBuilder.ts` (generalize `buildPitLateral` for arbitrary anchor)

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Endorsed with reprioritization.** Only the `features_pricing` join is a live *correctness* bug (predicate must match the joined row); ATR/indicator/MA `MAX(ts)` joins are state-value reads whose predicates are already inside the subquery — convert them for uniformity, but don't represent this as fixing widespread signal loss. Implementation note: generalizing `buildPitLateral()` to accept an arbitrary anchor alias is the right mechanical step (the session_scoped and equality-pushdown machinery added 07-11 already rides on it). Watch the pricing LATERAL's lookback: pricing rows are dense, so set a tight registry `defaultLookbackBars` or the LATERAL will scan more than the correlated subquery it replaces.

---

### Change 3: Family-Aware Setup Engine — Rules and Graders Per Family

**What:** Restructure the setup engine so that both hard rules AND graders are family-aware. Each `SetupFamily` gets its own set of hard rules and graders:

| Family | Hard Rules | Graders |
|--------|-----------|---------|
| `zone_reversal` | Zone proximity, tapped zones, entry zone distance | Zone quality, OTE overlap, HTF alignment |
| `orb_breakout` | Opening range exists, breakout direction, session window, displacement confirmation | ORB breakout quality, session timing, displacement grade |
| `fvg_continuation` | FVG exists and is unmitigated, price approaching FVG, direction alignment | FVG quality, HTF alignment, displacement confirmation |
| `trend_pullback` | Fast/slow MA alignment, price pullback to MA, direction alignment | MA alignment quality, trend strength, pullback depth |
| `indicator` | Indicator value threshold, direction alignment | Indicator signal quality, confirmation |
| `liquidity_sweep` | Recent sweep event, liquidity pool proximity, direction reversal | Sweep quality, reversal confirmation, liquidity profile |

The context builder only fetches features relevant to the family. The graders only score on factors relevant to the family.

**Why it fixes RC-3:** The root cause is that the setup engine applies zone-reversal logic universally. By making both rules and graders family-aware, each strategy family is evaluated against its own market-structure model, not a supply/demand zone model.

**Eliminates:** Bug #14 (setup engine blocks ORB, FVG, indicator, MA strategies), and the V4 finding that setup blocks 85-99% of candidates with zone-proximity reasons.

**Reliability guarantee:** A strategy's setup evaluation only checks conditions relevant to its market-structure model. An ORB strategy is never blocked because "all nearby zones have already been tapped."

**Implementation:**
- `packages/setupEngine/src/rules/hardRules.ts`: Replace the single `runHardRules()` with a family-dispatched function. Each family gets its own rule set. Common rules (direction, spread, candle availability, active position count) remain universal.
- `packages/setupEngine/src/graders/`: Add family-specific graders or make existing graders family-aware. `gradeEntryQuality()` should score zone overlap for `zone_reversal`, ORB breakout quality for `orb_breakout`, MA alignment for `trend_pullback`, etc.
- `packages/setupEngine/src/contextBuilder.ts`: Only fetch features relevant to the family. `fetchZones()` and `deriveEntryZone()` are only called for `zone_reversal` and `fvg_continuation`. `fetchStructure()` is called for `zone_reversal`, `fvg_continuation`, and `liquidity_sweep`. ORB strategies fetch `features_opening_range` and `features_displacement` instead.
- `packages/setupEngine/src/evaluateSetup.ts`: Dispatch to family-specific grading pipeline.
- `packages/setupEngine/src/types.ts`: Add `SetupFamily` to the family list (already exists) and ensure `EvaluationInput.setupFamily` is always populated from the spec.

**Key files:**
- `packages/setupEngine/src/rules/hardRules.ts` (family-dispatched rules)
- `packages/setupEngine/src/contextBuilder.ts` (family-specific feature fetching)
- `packages/setupEngine/src/evaluateSetup.ts` (family-specific grading)
- `packages/setupEngine/src/graders/entryQuality.ts` (family-specific entry quality)
- `packages/setupEngine/src/types.ts` (ensure setupFamily is required)

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Correct design, correct P0 priority — and already mid-implementation in the working tree** (family dispatch in `hardRules.ts`/`evaluateSetup.ts`, family-specific `graders/entryQuality.ts`, family-scoped fetching in `contextBuilder.ts`). Two additions: (1) keep the universal rules (spread, candle availability, duplicate/dedup, active-position caps) in a shared base layer so families can't accidentally drop a safety rule — family dispatch should *add* rules, not *replace* the safety floor; (2) ship with a per-family block-reason telemetry diff (the existing `stageCounts.setupBlockReasons`) as the acceptance artifact — if a family's top block reason still mentions zones, the dispatch leaked. The V4 evidence (orb_classic 97% blocked) makes this the single change that most improves the *meaningfulness* of full-mode results.

---

### Change 4: Feature/Tf Capability Contract at Seed Time

**What:** Add a capability contract check to `validateSpec()` that runs at seed time. Before a spec is seeded into the DB, validate that every required feature/tf surface exists in the capability matrix and is not `EMPTY_DENSE` or `MISSING_TABLE`. The capability matrix (`feature-capability.js`) already classifies surfaces — wire it into the seed pipeline. Additionally, compute warmup from the spec's actual feature dependency graph (including HTF bias context windows and pricing dealing range stabilization) rather than a fixed 200-bar window.

**Why it fixes RC-4:** The root cause is that specs are seeded without validating that their required feature/tf surfaces exist and are populated. By checking at seed time, impossible specs never reach the DB, the compiler, or the backtest. Warmup is fixed by computing from the actual dependency graph.

**Eliminates:** Bugs #1 (preflight only warns on zero rows), #9 (497 rows passes as covered), #16 (warmup ignores indicator lookback, HTF bias, pricing dealing ranges).

**Reliability guarantee:** No spec is seeded or promoted that requires a feature/tf surface which is `EMPTY_DENSE`, `MISSING_TABLE`, or `STALE_STATE`. Warmup is always sufficient for all feature dependencies to stabilize.

**Implementation:**
- `packages/strategies/src/validate.ts`: Add a `validateCapability()` function that takes a spec and a capability matrix and returns errors for any required feature/tf that is `EMPTY_DENSE`, `MISSING_TABLE`, or `CONTRACT_MISMATCH`. Call it from `validateSpec()` when a DB pool is available, or from `scripts/seed-strategy-specs.js` after `validateSpec()`.
- `scripts/seed-strategy-specs.js`: After `validateSpec()`, run `collectCapabilityMatrix()` for the spec's symbols/tfs and check all required surfaces. Fail fast on any blocking verdict.
- `scripts/promote-top3-live.js`: Same check before promotion.
- `scripts/backtest-pit-v2.js:computeWarmupBars()`: Already computes from spec conditions and registry lookback defaults. Extend to account for HTF bias context (the HTF bias feature's `defaultLookbackBars` × the ratio of HTF tf to signal tf) and pricing dealing range (the pricing feature's `defaultLookbackBars` × tf ratio). The infrastructure is already there — just ensure the HTF bias and pricing conditions are included in the loop.

**Key files:**
- `packages/strategies/src/validate.ts` (add `validateCapability()`)
- `scripts/seed-strategy-specs.js` (call `validateCapability()` after `validateSpec()`)
- `scripts/promote-top3-live.js` (same check before promotion)
- `scripts/backtest-pit-v2.js` (extend `computeWarmupBars()` for HTF/pricing context)

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Half of this already shipped (see RC-4 review): `validate.ts` at seed time, `warmupBars` + dependency-graph `computeWarmupBars()`.** The remaining core — capability verdicts enforced at seed/promote — is the right call and small: `feature-capability.js` already produces verdicts; wire it into `seed-strategy-specs.js` and `promote-top3-live.js` behind the `experimental: true` escape hatch the report proposes (good design — keep it). One extension worth adding: the same capability check should drive the **producer schedule** (Section 6-E) — the set of seeded specs defines exactly which feature/tf surfaces must be produced, closing the P0-4 failure class (XAU ATR@1m silently dead for 8 days) permanently. A capability matrix that gates seeds but doesn't drive production is half a contract.

---

### Change 5: Stable Zone Identity + Lifecycle Expiry

**What:** Add a stable `zone_id` (deterministic hash of `symbol + tf + zone_kind + direction + formation_ts + rounded_geometry`) to `features_zone`. The zone producer upserts by `zone_id` instead of inserting a new row per bar. Old zones that are invalidated and past a retention window (e.g., 30 days) are expired by the lifecycle refresh. This collapses the 24.6M row table to a manageable size (one row per unique zone, not one row per bar per zone). Add a `market_levels_view` that exposes canonical levels (zones, OBs, iFVGs, pivots, liquidity pools) with common geometry and provenance, and migrate strategy SQL to query the view instead of raw feature tables.

**Why it fixes RC-5:** The root cause is that zones have no stable identity, so the same zone is re-emitted every bar. A stable `zone_id` means the zone is upserted once and updated (lifecycle, fill_pct, touch_count) rather than re-inserted. Lifecycle expiry prevents unbounded growth.

**Eliminates:** Zone table explosion (24.6M → ~100K rows), statement timeouts on zone-heavy strategies (BUG-3.5), and the query performance issues that make A+ ORB/FVG backtests impossible.

**Reliability guarantee:** `features_zone` has one row per unique zone, not one row per bar per zone. Query times are bounded by the number of active zones, not the number of bars × zones. Old zones are expired by lifecycle, not accumulated indefinitely.

**Implementation:**
- Migration: `ALTER TABLE features_zone ADD COLUMN zone_id TEXT; CREATE UNIQUE INDEX ON features_zone (symbol, tf, zone_id);`
- `apps/engine/src/features/zone.ts`: Compute `zone_id = sha256(symbol + tf + zone_kind + direction + formation_ts + Math.round(top * 1e5) + Math.round(bottom * 1e5))` in `serialize()`. Change the DAG runner's persist to `INSERT ... ON CONFLICT (symbol, tf, zone_id) DO UPDATE SET fill_pct = EXCLUDED.fill_pct, tapped = EXCLUDED.tapped, mitigated_at = EXCLUDED.mitigated_at, invalidated_at = EXCLUDED.invalidated_at, touch_count = EXCLUDED.touch_count, retest_count = EXCLUDED.retest_count, quality_score = EXCLUDED.quality_score, strength_score = EXCLUDED.strength_score, rank_score = EXCLUDED.rank_score`.
- `packages/shared/src/lifecycle.ts`: Add zone expiry — zones with `invalidated_at < NOW() - INTERVAL '30 days'` are marked expired and can be archived.
- `packages/strategies/src/sqlBuilder.ts`: Update `buildPitLateral()` for `features_zone` to filter by `zone_id` (the DISTINCT ON becomes `DISTINCT ON (symbol, zone_id)` instead of `DISTINCT ON (symbol, zone_kind, direction)`).
- Create `market_levels_view` as a UNION of zones, OBs, iFVGs, pivots, liquidity pools with common columns (`symbol, tf, level_type, kind, top, bottom, price, direction, strength, invalidated_at, tapped_at, touch_count, source_json, ts`).

**Key files:**
- `infra/migrations/` (new migration for `zone_id` column + unique index)
- `apps/engine/src/features/zone.ts` (compute `zone_id`, upsert semantics)
- `apps/engine/src/dag/runner.ts` (upsert persist for zones)
- `packages/shared/src/lifecycle.ts` (zone expiry)
- `packages/strategies/src/sqlBuilder.ts` (DISTINCT ON by `zone_id`)
- `packages/strategies/src/featureRegistry.ts` (add `zone_id` to required columns)

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Direction endorsed; sequencing and one correctness claim objected to.** First, do the cheap 55× win *now*: natural-key unique index + `ON CONFLICT DO NOTHING` at write time (measured duplication is 273 rows/bar from re-backfills, not the 5× per-bar emission the report models). That alone likely hits the "< 1M rows / < 500ms" acceptance without touching semantics. Second, the report's risk-mitigation claim ("the snapshot semantics were never needed — the lifecycle columns encode the state") is only half true: `invalidated_at`/`mitigated_at` reconstruct as-of *validity*, but evolving metrics (`fill_pct`, `touch_count`, `retest_count`) lose their history in a one-row-per-zone world, and graders consume those. The tree already contains the correct shape: immutable `zone_touch_event_ledger` (112) for history + `market_zone_objects` (113) for current state. Recommend: formalize that two-table split as *the* design rather than the report's single upserted row, and update `buildPitLateral` to read current-state from the object table with event-ledger fallback for as-of metrics. Finally: this is the destructive change — `TM_ALLOW_DESTRUCTIVE=1` + fresh backup before any rebuild, per repo rules.

---

### Change 6: Symbol Contract Layer — Asset-Class-Safe Gates by Default

**What:** Make the volatility gate's percentile-based policy the **default** when no explicit `maxAtr5Pips` is configured. The `market_volatility_profile` table already exists and is populated. When a spec doesn't specify a volatility gate config, the gate auto-resolves to `maxAtrPercentile: 0.95` (p95) from the profile, which is asset-class-safe. Similarly, the setup engine's `maxAllowedSpreadPips` should use `pair.baseSpreadPips * SPREAD_SANITY_MULTIPLIER` (already the cap) as the default, not `Math.max(pair.baseSpreadPips * 4, 3)`. Add a `pair_characteristics`-driven default for every gate that depends on asset class (volatility, spread, slippage).

**Why it fixes RC-6:** The root cause is that gates use absolute thresholds calibrated for FX. By making percentile-based policies the default, a single spec works across asset classes without manual per-symbol tuning.

**Eliminates:** BUG-3.1 (volatility gate blocks 100% of XAUUSD trades), #10 (fixed freshness max age — partially fixed, but the setup engine's spread cap formula is still wrong for metals), #11 (event feature whitelist — `features_zone` should be in the event whitelist for retest/touch events).

**Reliability guarantee:** A strategy spec with no explicit gate thresholds works correctly across FX, metals, and indices. The gate auto-configures based on the symbol's `pair_characteristics` and `market_volatility_profile`.

**Implementation:**
- `packages/tradePipeline/src/gates/volatilityGate.ts`: When `config.maxAtr5Pips === undefined && config.maxAtrPercentile === undefined`, default to `maxAtrPercentile: 0.95`. The profile lookup already exists.
- `packages/setupEngine/src/contextBuilder.ts:81`: Change `maxAllowedSpreadPips = Math.max(pair.baseSpreadPips * 4, 3)` to `maxAllowedSpreadPips = pair.baseSpreadPips * SPREAD_SANITY_MULTIPLIER` (which is 10, the existing sanity cap).
- `scripts/backtest-pit-v2.js:567-573`: Add `features_zone` to `EVENT_FEATURE_TABLES` when the spec requires `features_zone_retest` (retest/touch events are sparse). Or better: derive the event/sparse classification from the feature registry's `semanticType` instead of a hardcoded set.

**Key files:**
- `packages/tradePipeline/src/gates/volatilityGate.ts` (percentile default)
- `packages/setupEngine/src/contextBuilder.ts` (spread cap from pair characteristics)
- `scripts/backtest-pit-v2.js` (registry-driven event classification)

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Two of three proposals endorsed; the spread-cap change must not ship as written.** (1) Percentile-default volatility gate (p95 when unset): yes — asset-class-safe by construction, spec override preserved. (2) Registry-derived `EVENT_FEATURE_TABLES`: yes — the registry's `semanticType` is the SSOT; the hardcoded set is exactly the kind of duplication this plan exists to eliminate. (3) `maxAllowedSpreadPips = base * 10`: **no** — that constant is the *data-quarantine* cap from P0-2, not a trading threshold; using it as the entry gate silently 2.5× loosens live entries on every pair. Replace with an explicit `gateMultiplier` per asset class in `pair_characteristics` (FX 4×, metals ~6×, exotics ~8×) or an observed-spread percentile — calibrated from the repaired `features_spread` data (now clean at ~3.0p avg for XAU). One more gap the report misses: the "symbol contract" should also carry **session/quoting metadata** (4-digit vs 5-digit pip size — the actual root of BUG-3.1-class miscalibrations, fixed ad hoc in pipMath 07-11) so no consumer ever re-derives pip size from `digits` locally again.

---

### Change 7: Candidate Audit Table

**What:** Add a `strategy_signal_candidates` table that persists every candidate — accepted and rejected — with the exact feature/candle/direction/gate/setup snapshot at the moment of evaluation. Both the backtest runner and the live runner write to this table. Each row includes:

```
candidate_id, strategy_id, symbol, tf, ts, side, entry_price, stop_loss, take_profit,
bias_direction, feature_snapshot_json, setup_grade, setup_block_reasons,
gate_results_json, decision_stage, decision_reason, source (live|backtest)
```

**Why it fixes RC-7:** The root cause is that rejected candidates are not persisted, making "why no trades?" a manual archaeology exercise. By persisting every candidate with its full snapshot, the question becomes a SQL query.

**Eliminates:** Bug #12 (live signal evaluation fetches features separately from signal-generation features — the snapshot captures both), #15 (deduplication doesn't check active pending/filled orders — the snapshot records the duplicate check result).

**Reliability guarantee:** Every signal candidate — whether it becomes a trade or is rejected at any stage — is persisted with its full evaluation context. "Why no trades?" is a `SELECT * FROM strategy_signal_candidates WHERE strategy_id = '...' AND decision_stage != 'executed'` query.

**Implementation:**
- Migration: `CREATE TABLE strategy_signal_candidates (...)`.
- `scripts/backtest-pit-v2.js`: After each eligible signal, before and after setup evaluation, gate evaluation, and trade simulation, write a candidate row with the current stage and decision.
- `packages/tradePipeline/src/liveRunner.ts`: After signal fetch, before and after each gate, setup evaluation, and quality check, write a candidate row. Fix `findRecentDuplicate()` to include `pending` and `filled` statuses: `status IN ('pending', 'filled', 'rejected', 'expired', 'closed')`.

**Key files:**
- `infra/migrations/` (new migration for `strategy_signal_candidates` table)
- `scripts/backtest-pit-v2.js` (write candidate rows at each stage)
- `packages/tradePipeline/src/liveRunner.ts` (write candidate rows + fix `findRecentDuplicate`)

#### 🔍 Independent Review (Kimi Code, 2026-07-11)

**Table design endorsed; write path and one fix reprioritized.** The `findRecentDuplicate` hole (verified: `pending`/`filled` missing) is a live double-entry risk — ship that one-line fix immediately, don't wait for the table. For the table itself: write through a **JSONL spool + batch inserter** (the pattern already proven by the ingest-resilience work) so audit persistence can never block or fail a trade decision; partition by month from day one (append-only forensic tables always outgrow expectations). Schema addition: include `fingerprint` and `dedup_check_result` so the dedup behavior itself is auditable, and `engine_version`/`spec_hash` so results are attributable to the exact code+spec that produced them — "why no trades?" questions often turn out to be "which build was running?" questions.

---

## 3. Implementation Roadmap

> **🔍 Review note (Kimi Code, 2026-07-11):** Roadmap endorsed with three insertions: (0) ship the `findRecentDuplicate` `pending`/`filled` fix this week (live double-entry risk, one line); (1) precede Change 5 with 6-B (natural-key zone dedupe, ~55× collapse, non-destructive); (2) precede Change 1's fork deletion with 6-C (golden-fixture parity harness) and treat compiler under-emission closure (doyle_sd: 0 vs 17 signals) as the gating milestone, not the deletion itself. Change 3 is already mid-flight in the working tree — re-baseline its acceptance metrics against the post-P0-2 block-reason distribution before sizing remaining work.

### Phase 1: Unblock the pipeline (must ship first)

| Priority | Change | Why First |
|----------|--------|-----------|
| P0 | **Change 3: Family-Aware Setup Engine** | This is the #1 blocker — 85-99% of candidates are setup-blocked by zone rules that don't apply to non-zone strategies. Without this, no amount of SQL fixing will produce trades. |
| P0 | **Change 6: Symbol Contract Layer** | The volatility gate blocks 100% of XAUUSD trades for 2/3 live strategies. This is a config default change, not a structural rewrite — fast to ship. |
| P0 | **Change 1: Unify SQL Generation** | The compiler/backtest drift means backtest results don't match live behavior. Delete the fork, route through the compiler. |

### Phase 2: Make it reliable (makes results trustworthy)

| Priority | Change | Why Second |
|----------|--------|------------|
| P1 | **Change 2: Registry-Driven Signal SELECT** | Kill all `MAX(ts)` joins. Without this, pricing/ATR/indicator joins pick wrong rows even after the setup engine is fixed. |
| P1 | **Change 4: Capability Contract at Seed Time** | Prevents impossible specs from being seeded. Without this, every new spec requires manual preflight. |
| P1 | **Change 5: Stable Zone Identity** | The 24.6M row zone table causes statement timeouts and makes zone-heavy strategies impossible. This is a schema + producer change. |

### Phase 3: Make it maintainable (prevents future drift)

| Priority | Change | Why Third |
|----------|--------|-----------|
| P2 | **Change 7: Candidate Audit Table** | Makes debugging "why no trades?" a SQL query instead of an investigation. Not a blocker, but a force multiplier for all future work. |

---

## 4. Risks and Tradeoffs

### Change 1: Unify SQL Generation

| Aspect | Detail |
|--------|--------|
| **Risk** | The compiler's PIT SQL may have bugs that the legacy fork accidentally avoided (e.g., the ORB parity break). Deleting the fork removes the fallback. |
| **Mitigation** | Run parity tests before deletion. The `PIT_USE_COMPILER_SQL=1` path already exists — test it first, fix any bugs, then delete the fork. |
| **Tradeoff** | Loss of the legacy fork as a debugging tool. Acceptable because the fork is the source of drift. |

### Change 2: Registry-Driven Signal SELECT

| Aspect | Detail |
|--------|--------|
| **Risk** | LATERAL joins are more expensive than `MAX(ts)` subqueries for dense features (ATR, pricing). Query times may increase. |
| **Mitigation** | The registry's `defaultLookbackBars` bounds the LATERAL scan. For ATR (14 bars), the LATERAL scans 14 rows, not the full table. This is faster than a correlated `MAX(ts)` subquery. |
| **Tradeoff** | Slightly more complex SQL. Acceptable because correctness > simplicity. |

### Change 3: Family-Aware Setup Engine

| Aspect | Detail |
|--------|--------|
| **Risk** | New family-specific rules may have bugs. The current universal rules are wrong but well-understood. |
| **Mitigation** | Start with the simplest correct rules per family (e.g., ORB: opening range exists + breakout direction + session window). Add complexity only when backtests prove the simple rules are insufficient. |
| **Tradeoff** | More code paths. Acceptable because the alternative (universal zone rules) is provably wrong for 5/6 strategy families. |

### Change 4: Capability Contract at Seed Time

| Aspect | Detail |
|--------|--------|
| **Risk** | Specs that are intentionally experimental (e.g., testing a new feature with sparse data) will be blocked at seed time. |
| **Mitigation** | Add an `experimental: true` flag to specs that bypasses the capability check but marks the spec as non-promotable. |
| **Tradeoff** | Slower iteration for experimental specs. Acceptable because experimental specs should be explicitly marked. |

### Change 5: Stable Zone Identity

| Aspect | Detail |
|--------|--------|
| **Risk** | The upsert changes the zone table's semantics from "snapshot per bar" to "current state per zone." Historical PIT backtests that rely on the snapshot semantics will break. |
| **Mitigation** | The PIT LATERAL already filters by `ts <= asOf` and checks `invalidated_at`/`mitigated_at`. With a stable `zone_id`, the LATERAL returns the zone's state as-of the anchor, which is correct. The snapshot semantics were never needed — the lifecycle columns encode the state. |
| **Tradeoff** | Requires a migration + backfill of `zone_id` for existing rows. Acceptable because the current 24.6M row table is unsustainable. |

### Change 6: Symbol Contract Layer

| Aspect | Detail |
|--------|--------|
| **Risk** | Percentile-based volatility gates may be too permissive for some symbols (e.g., a p95 cap that's too high for a low-volatility FX pair). |
| **Mitigation** | The spec can still override with explicit `maxAtr5Pips`. The percentile is a default, not a mandate. |
| **Tradeoff** | Less explicit control per spec. Acceptable because the current default (absolute pips) is provably wrong for metals. |

### Change 7: Candidate Audit Table

| Aspect | Detail |
|--------|--------|
| **Risk** | Writing a candidate row per signal increases DB write load. |
| **Mitigation** | Batch inserts. The table is append-only and can be partitioned by date. |
| **Tradeoff** | Additional storage. Acceptable because the debugging value is enormous. |

---

## 5. Verification Strategy

### Post-Change-1 (Unify SQL Generation)

```bash
# Parity test: compiler PIT must produce identical candidate IDs to legacy fork
node scripts/parity-compiler-legacy.js XAUUSD 90 orb_classic
node scripts/parity-compiler-legacy.js XAUUSD 90 doyle_sd
node scripts/parity-compiler-legacy.js XAUUSD 90 smart_risk_ob_ifvg_1m

# Then: backtest with compiler SQL (no legacy fork)
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
```

**Acceptance:** Parity test passes (identical candidate IDs). Backtest results match pre-change for `doyle_sd` (the healthy strategy).

### Post-Change-3 (Family-Aware Setup Engine)

```bash
# ORB strategy should no longer be setup-blocked by zone rules
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full

# Setup-block reasons should be ORB-specific, not zone-proximity
# Check: stageCounts.setupBlockReasons should NOT contain "All nearby zones have already been tapped"
```

**Acceptance:** `orb_classic` full-mode setup-block rate < 50% (was 97%). Setup-block reasons are family-specific.

### Post-Change-6 (Symbol Contract Layer)

```bash
# XAUUSD strategies should no longer be 100% blocked by volatility gate
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 watukushay_no1 --json --mode=full

# Check: gateSkips should NOT show volatility_gate=100%
```

**Acceptance:** `orb_classic` and `watukushay_no1` produce > 0 executed trades on XAUUSD.

### Post-Change-2 (Registry-Driven Signal SELECT)

```bash
# Pricing joins should return matching rows, not just latest rows
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=research

# Compare raw signal count to pre-change — should be >= pre-change (no signals lost to MAX(ts) picking wrong row)
```

**Acceptance:** No strategy loses signals due to pricing/ATR/indicator join picking a non-matching row.

### Post-Change-5 (Stable Zone Identity)

```sql
-- Zone table should be < 1M rows (was 24.6M)
SELECT COUNT(*) FROM features_zone;

-- XAUUSD 5m should be < 50K rows (was 2.31M)
SELECT COUNT(*) FROM features_zone WHERE symbol = 'XAUUSD' AND tf = '5m';
```

**Acceptance:** Zone table is < 1M rows. Zone-heavy strategy query time < 500ms.

### Full System Verification (All Changes)

```bash
pnpm -r build
pnpm test
node scripts/audit-feature-contracts.js
node scripts/check-candle-coverage.js XAUUSD 90 '1m,5m,15m,1h,4h,1d'
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 smart_risk_ob_ifvg_1m --json --mode=full
node scripts/backtest-pit-v2.js ALL 90 waqar_v2 --json --mode=research
```

**Acceptance conditions:**

1. No core strategy returns `BLOCKED_SYSTEM_QUALITY` unless the missing data is real and documented.
2. Full-mode setup-block rate is explained by family-specific rules, not generic zone proximity.
3. Zone-heavy strategy query time < 500ms.
4. Feature/tf capability matrix marks all strategy-required features `READY`.
5. ATR raw outliers are quarantined and all consumers use `effective_value`.
6. `orb_classic` and `watukushay_no1` produce > 0 executed trades on XAUUSD.
7. `doyle_sd` win rate is within ±2% of pre-change baseline.
8. `strategy_signal_candidates` table has rows for every evaluated candidate, including rejects.

---

## 6. Higher-Leverage Alternative & Complementary Proposals (Kimi Code, 2026-07-11)

The 7 changes above are the right *corrective* program. The following five are the *leverage* program — each removes an entire class of future failure rather than fixing today's instances. Ordered by leverage-per-effort.

### 6-A. One decision core, two clocks (subsumes RC-1, RC-2, bug #12)

Unify one level higher than SQL. Extract a single `evaluateCandidate(spec, featureSnapshot, clock)` decision core — setup grading, gates, dedup, risk geometry — consumed by *both* `liveRunner` (wall clock, live snapshot) and the backtester (virtual clock, as-of snapshot). Backtesting becomes *replay* of the live path, not a parallel implementation of it. Live/backtest parity stops being a test you maintain and becomes a property of the architecture; bug #12 (live re-fetches features differently from the signal SQL) becomes impossible because there is only one fetch+evaluate path. The SQL unification (Change 1) then shrinks to making the compiler the snapshot provider for both modes. This is the single change with the largest permanent bug-class elimination in the system.

### 6-B. Write-time natural-key dedupe on `features_zone` (the real 100×, ~1 day)

Measured 07-11: XAUUSD 5m holds 273 zone rows per bar against a contract max of 5 — ~55× duplication from backfill re-inserts. A unique index on the natural key `(symbol, tf, ts, zone_kind, direction, round(top,5), round(bottom,5))` + `ON CONFLICT DO NOTHING` in the producer collapses the 24.6M-row table by ~50× with **zero semantic change**, non-destructively (build index CONCURRENTLY, then dedupe). Do this *before* Change 5's redesign: it likely satisfies the performance acceptance criteria on its own, and shrinks the later migration's blast radius from 24.6M rows to ~500K.

### 6-C. Golden-fixture parity harness (makes every drift RC un-regressable)

Snapshot small DB slices (one symbol × 7–30 days of candles + features) into committed fixtures, and run in CI without a live DB: (1) compiler-vs-legacy signal parity (until Change 1 lands), (2) golden backtest numbers per flagship spec (doyle_sd baseline ±0), (3) EXPLAIN-shape assertions for the PIT query plans (the 90d-timeout class never returns silently). Every RC in this report is a drift that a fixture harness would have caught at the commit that introduced it. Cost: a few days; payoff: permanent.

### 6-D. Spool-backed decision ledger (auditability without hot-path coupling)

For Change 7, reuse the ingest-resilience spool pattern: candidates append to daily JSONL, a tick batch-inserts into `strategy_signal_candidates`, failures quarantine instead of blocking trading. Append-only forensic writes must never be able to fail the decision they record. Same audit power, no new live-path dependency on DB health.

### 6-E. Capability matrix as the producer scheduler's single input (closes the P0-4 class forever)

Today, "which features get produced" is an emergent property of a pm2 config, a disabled worker flag, and `pipelineTrigger`'s best-effort collection — which is exactly how XAU ATR@1m died silently for 8 days. Make it a function: `requiredSurfaces = ∪ collectRequiredFeatureRuns(spec) for all seeded active specs` → the producer DAG schedules precisely those surfaces, and the freshness guardrail (already registry-driven, now including risk-ATR TFs) alerts on any required surface breaching SLA. Seeding a spec then *causes* its data to exist; deleting all consumers of a surface *retires* its producer. One source of truth, no orphan producers, no blind gates.

### Leverage summary

| Proposal | Bug class eliminated | Effort | Note |
|---|---|---|---|
| 6-B zone natural-key dedupe | Zone table explosion (55× measured) | ~1 day | Do before Change 5 |
| 6-A one decision core | SQL fork drift, live/backtest divergence, audit drift | 1–2 wks | Superset of Change 1 |
| 6-C golden fixtures | All future drift RCs | ~3 days | Prerequisite for safe Change 1 deletion |
| 6-E capability-driven scheduling | Silent producer death (P0-4 class) | ~2 days | Completes Change 4's contract |
| 6-D spool decision ledger | Audit-write coupling | ~1 day | Implementation detail of Change 7 |

---

## Summary

This plan addresses the systemic patterns, not individual bugs. The 7 architectural changes fix all 16 bugs by eliminating the structural flaws that produce them. The system becomes **correct by construction** — not correct by careful manual alignment of duplicated code.

| Change | Root Cause | Bugs Fixed | Phase | Priority |
|--------|-----------|------------|-------|----------|
| 1. Unify SQL Generation | RC-1 | #6, #7, #8, #13 | 1 | P0 |
| 2. Registry-Driven Signal SELECT | RC-2 | #2, #8, #13 | 2 | P1 |
| 3. Family-Aware Setup Engine | RC-3 | #14 | 1 | P0 |
| 4. Capability Contract at Seed Time | RC-4 | #1, #9, #16 | 2 | P1 |
| 5. Stable Zone Identity | RC-5 | #5, BUG-3.5 | 2 | P1 |
| 6. Symbol Contract Layer | RC-6 | BUG-3.1, #10, #11 | 1 | P0 |
| 7. Candidate Audit Table | RC-7 | #12, #15 | 3 | P2 |