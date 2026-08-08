# Monday Live Readiness Architecture Plan

Date: 2026-07-04

Target live session: Monday, 2026-07-06

Scope: architectural readiness, analyzer/backtest separation, algorithmic fixes, DB/feature reliability, and strategy validation. Security is intentionally excluded for now because the app is single-user and local/private.

## Executive Verdict

The system should not treat the main analyzer as a strategy executor.

The correct architecture is:

1. Market feature engine builds reliable point-in-time market facts.
2. Main analyzer detects and scores high-quality generic opportunities.
3. Strategy specs express tradable playbooks as a separate layer.
4. Live pipeline combines both layers without letting either silently override the other.
5. Backtests must validate the same path that live trading uses.

Right now the codebase partially follows this model, but there are important leaks:

- Strategy specs and analyzer grading can disagree.
- Live trading can reject a spec-valid signal because the generic analyzer returns `BLOCK`.
- The generic analyzer can miss strong SMC/ICT retest setups because some rules are too absolute.
- Analyzer backtests are not equivalent to strategy-spec PIT backtests.
- Some feature tables are stale, sparse, or missing required timeframes.
- Current live candidate strategies do not yet show enough valid executed backtest trades.

For Monday, the safest target is paper/live-shadow mode or extremely small supervised live mode after the critical fixes and preflight checks below.

## Desired Architecture

### Current Risk

The main analyzer is too close to being a gatekeeper. It should not decide that a valid strategy setup is invalid just because the generic scoring model dislikes one context feature.

The analyzer should not "hop over" good setups. It should detect them, tag them, score them, and explain uncertainty. Strategy specs should then decide whether that setup belongs to a specific playbook.

### Target Layering

The layers should be separated like this:

| Layer | Responsibility | Should Block Trades? |
|---|---|---|
| Market data ingestion | Candles, ticks, broker feed, timestamps | Yes, if stale/corrupt |
| Feature engine | Bias, structure, zones, OB, IFVG, sweep, ATR, session, spread | Yes, if required feature is stale/missing |
| Main analyzer | Generic setup discovery, SMC/ICT quality score, explanation | No, except catastrophic invalid state |
| Strategy specs | Playbook rules, required features, entry/exit model, gates | Yes |
| Risk/execution pipeline | Spread, slippage, exposure, sizing, duplicate prevention | Yes |
| Journal/analytics | Post-trade analysis and feedback | No |

### Required Design Change

The analyzer should output:

- `setupType`
- `direction`
- `qualityScore`
- `confidence`
- `tags`
- `supportingFeatures`
- `contradictingFeatures`
- `warnings`
- `hardInvalidReasons`
- `recommendedStrategyFamilies`

The analyzer should avoid returning `BLOCK` for normal market-context disagreements. A true block should mean the setup is structurally impossible, data is stale, spread is unusable, or risk math is invalid.

## Major Missing Pieces

## 1. Analyzer And Strategy Specs Are Not Cleanly Separated

### Problem

The live path uses strategy specs and then also calls the generic setup analyzer. This can create false negatives:

- A strategy spec may find a valid setup.
- The analyzer may grade the market as `BLOCK`.
- The live pipeline can reject the trade even though the strategy rules passed.

This is dangerous because strategy specs are supposed to be the playbook layer. The analyzer should add context, not replace the playbook.

### Upgrade Needed

Introduce a formal `AnalyzerVerdict` contract:

```ts
type AnalyzerVerdict = {
  status: "valid" | "warning" | "invalid";
  qualityScore: number;
  confidence: number;
  tags: string[];
  warnings: string[];
  hardInvalidReasons: string[];
};
```

Then change live logic:

- Strategy spec decides whether a signal exists.
- Analyzer enriches and warns.
- Only `hardInvalidReasons` can block a spec-valid trade.
- Analyzer warnings should reduce size or require confirmation, not always reject.

### Expected Result

Good strategy-specific setups stop being skipped by generic analyzer rules. You get more explainable signals and fewer false negatives.

## 2. Analyzer Backtest Is Not The Same As Strategy Backtest

### Problem

The analyzer backtest package evaluates `evaluateSetup` over sampled candles. That is useful for checking generic setup quality, but it does not validate YAML strategy specs as deployed.

The production-relevant backtest is `scripts/backtest-pit-v2.js`, because it evaluates point-in-time strategy conditions, gates, fills, costs, and outcomes.

### Upgrade Needed

Keep two separate backtest modes:

1. Analyzer discovery backtest:
   - Finds generic high-quality market situations.
   - Measures whether analyzer scoring correlates with future R.
   - Does not approve live strategy deployment by itself.

2. Strategy PIT backtest:
   - Validates each YAML variant.
   - Uses the same conditions and gates as live trading.
   - Is the only path allowed to promote strategies to live.

Add a comparison report:

```text
Strategy signal found?
Analyzer score at same timestamp?
Analyzer blocked it?
Outcome if traded?
Would live have rejected it?
```

### Expected Result

You can identify whether the analyzer is missing great setups, whether the strategy specs are too narrow, or whether the live pipeline is rejecting valid opportunities.

## 3. Analyzer Outcome Cost Model Has Bugs

### Problem

The analyzer outcome tracker has cost-model issues:

- Short take-profit handling does not include the same spread adjustment as other exits.
- Losses are reported as `-1R` even when spread/slippage makes the effective loss worse.
- Pip size defaults are unsafe for XAUUSD unless explicitly passed.
- Analyzer backtest assumes entry around a midpoint, not the same fill model as the PIT backtester.

### Upgrade Needed

Fix analyzer outcome tracking:

- Make pip size symbol-aware.
- Use the same spread/slippage model as PIT.
- Report actual R after execution costs.
- Separate `plannedR` from `realizedR`.
- Track missed fills for limit/stop-style entries.

### Expected Result

Analyzer statistics become trustworthy, especially for XAUUSD. Expect fewer inflated results and more realistic drawdown/expectancy numbers.

## 4. Zone Lifecycle Logic Can Miss Or Misclassify Setups

### Problem

The setup analyzer fetches zones from feature tables but does not consistently filter lifecycle state the same way the live feature fetch does.

Possible issues:

- Invalidated zones can influence scoring.
- Mitigated zones can be treated as fresh opportunities.
- Tapped zones are sometimes treated too harshly.
- Good SMC retest setups can be rejected because "all nearby zones are tapped."

This is especially important because many good ICT/SMC trades are not first-touch trades. They are retests, mitigations, IFVG returns, order-block refinements, or liquidity raid returns.

### Upgrade Needed

Refactor zone selection into a single shared utility:

```text
selectTradableZones(symbol, tf, asOf, direction, options)
```

It should support:

- fresh only
- mitigated allowed
- retest allowed
- max age bars
- max distance in ATR
- invalidated excluded
- lifecycle-aware scoring

The analyzer should score tapped zones instead of globally blocking them.

### Expected Result

The app stops skipping valid retest/mitigation setups and becomes more aligned with real SMC execution logic.

## 5. Feature Tables Are Not Complete Enough For Live

### Problem

Recent DB checks showed missing or stale features, especially for XAUUSD:

- `features_bias` missing important XAUUSD lower timeframes such as 15m/1m.
- `features_sweep` missing XAUUSD rows.
- `features_spread` sparse/stale.
- `features_order_block`, `features_structure`, `features_zone`, and `features_ifvg` are not uniformly fresh.
- DXY is missing, degrading correlation features.

### Upgrade Needed

Create a preflight feature matrix checker:

```text
symbol x timeframe x required feature x latest timestamp x row count x freshness status
```

It should fail live readiness when:

- Required feature is missing.
- Latest feature timestamp is older than expected.
- Candle exists but feature does not.
- Strategy references a timeframe that has no feature rows.
- DXY-dependent features are enabled but DXY is unavailable.

### Expected Result

No strategy gets promoted live unless its required data actually exists and is fresh.

## 6. Live Ingest Path May Skip Lifecycle Refresh

### Problem

The single-variant pipeline path refreshes lifecycle state, but the all-active ingest path should be checked and aligned. If all-active live execution uses stale lifecycle state, zones/order blocks/IFVGs may be incorrectly considered valid or invalid.

### Upgrade Needed

Ensure this sequence always happens before strategy evaluation:

1. Ingest candle.
2. Generate features.
3. Refresh lifecycle.
4. Verify feature freshness.
5. Evaluate active strategy specs.
6. Run analyzer enrichment.
7. Run risk/execution gates.

### Expected Result

Live and backtest behavior become more consistent, and the app avoids trading from stale lifecycle columns.

## 7. Volatility Gate Is Blocking Strategy Candidates

### Problem

Recent PIT backtests showed:

- `orb_classic`: all raw signals skipped by volatility.
- `watukushay_no1`: all raw signals skipped by volatility.

This means either:

- The strategy is finding poor setups during bad volatility, or
- The gate threshold is too tight, or
- The ATR unit conversion/threshold is not normalized per symbol, or
- The gate should be session-specific.

### Upgrade Needed

Make volatility gates symbol/session aware:

```yaml
gates:
  - name: volatility
    params:
      bySymbol:
        EURUSD:
          london:
            minAtr5Pips: 1.2
            maxAtr5Pips: 8.0
        XAUUSD:
          ny:
            minAtr5Pips: 8.0
            maxAtr5Pips: 45.0
```

Also add diagnostics:

- raw ATR
- ATR pips
- threshold used
- symbol profile
- session
- reason for skip

### Expected Result

Good setups are not skipped by one-size-fits-all volatility settings.

## 8. Too Many Variants Are Active

### Problem

The DB currently has many active variants. For live trading, this increases risk and makes debugging harder.

### Upgrade Needed

Use a strict live allowlist:

```text
mode = paper | shadow | live
is_active = true only means eligible for research
is_live_enabled = true means allowed to place orders
```

Do not overload `is_active` as the live-trading switch.

### Expected Result

You can research many strategies while only allowing a tiny approved subset to touch live execution.

## 9. Health Endpoint Can Be Misleading

### Problem

The system has `TM_DISABLE_FEATURE_JOBS=true` in process config, but health logic may still check feature job timestamps. If features are generated synchronously in the ingest path, job-based health can report the wrong status.

### Upgrade Needed

Health should check actual feature-table freshness:

```sql
SELECT symbol, tf, MAX(ts)
FROM features_bias
GROUP BY symbol, tf;
```

It should report:

- candle freshness
- required feature freshness per live strategy
- DXY/correlation readiness
- MT5 connectivity
- DB latency
- order execution mode
- active live variants

### Expected Result

The dashboard tells you whether the app is actually ready to trade, not whether an optional background worker ran.

## 10. Strategy Specs Need A Promotion Contract

### Problem

Strategies can be active without proving they are currently viable. Current backtests showed weak or blocked results for the intended Monday candidates.

### Upgrade Needed

A strategy can only move to live when it passes:

- Data availability check.
- PIT backtest.
- Conservative intrabar backtest.
- Walk-forward test.
- Minimum executed trade count.
- Max drawdown limit.
- Timeout rate limit.
- Live dry-run.
- Paper forward test.

Example promotion gates:

```text
minimum trades: 20 over 30-90 days, or strategy-specific exception
net R: positive after costs
max drawdown: below account-defined cap
timeout rate: below 30 percent unless timeout is part of model
gate skip reason: no single gate blocks more than 80 percent of raw signals without review
live dry-run: no stale feature/candle failures
```

### Expected Result

Promotion becomes mechanical and repeatable instead of based on recent optimism.

## 11. Backtest Needs Better Live Parity

### Problem

The PIT backtester is the best current path, but live parity can still improve.

Potential gaps:

- Live uses analyzer as an extra gate.
- Live feature freshness is stricter than historical PIT joins.
- Spread feature sparsity may make costs differ.
- Timeouts can hide bad exits.
- Intrabar assumptions affect TP/SL order.

### Upgrade Needed

Add live-parity modes:

```text
--live-parity
--intrabar=sl_first
--require-feature-freshness
--include-analyzer-verdict
--include-live-gates
--emit-rejection-breakdown
```

### Expected Result

Backtest results become a better estimate of what the live bot will actually do.

## 12. Market Data Robustness Is Not Fully Proven

### Problem

The app has candle data, but Monday readiness depends on live feed continuity:

- fresh 1m candles
- correct broker timezone handling
- spread updates
- missing candle detection
- weekend gap handling
- reconnect behavior
- duplicate candle prevention

### Upgrade Needed

Add a market-open watchdog:

```text
latest candle age
last 10 candles continuity
spread freshness
broker connection heartbeat
symbols updating
feature generation lag
pipeline trigger lag
```

### Expected Result

Monday open problems are detected before they become bad trades or silent missed trades.

## 13. Missing "Missed Great Setup" Audit

### Problem

There is no single report that answers:

"Did the market create a great setup that the app skipped?"

### Upgrade Needed

Build a missed-setup analyzer:

1. Scan historical candles for large favorable moves.
2. Reconstruct features before the move.
3. Check whether analyzer scored the setup.
4. Check whether any strategy spec fired.
5. Check why live would have rejected it.
6. Group missed opportunities by cause.

Miss categories:

- missing feature
- stale feature
- strategy condition too strict
- analyzer hard block
- volatility gate
- spread gate
- session filter
- bias disagreement
- zone lifecycle mismatch
- no entry model
- no fill

### Expected Result

Instead of only analyzing losing trades, the system learns from high-quality opportunities it failed to take.

## 14. Database Reliability Gaps

### Problem

The DB has many feature tables, strategy tables, orders, logs, and reports. The main risk is not basic connectivity; it is feature consistency and point-in-time correctness.

### Upgrade Needed

Add DB readiness checks:

- required indexes exist for every feature table on `(symbol, tf, ts)`
- no duplicate candle rows
- no duplicate feature rows for primary keys
- no missing high-timeframe aggregate candles
- feature rows do not exist after their source candle timestamp incorrectly
- live strategy requirements match available feature tables
- latest feature timestamp is close to latest candle timestamp
- migration status is current

### Expected Result

The app catches structural data problems before strategy evaluation.

## 15. Logging And Rejection Analysis Need More Detail

### Problem

Rejected orders exist, but the system needs richer structured rejection details to debug missed setups quickly.

### Upgrade Needed

For every rejected setup, persist:

- strategy id
- family id
- symbol
- timeframe
- candidate timestamp
- raw signal id/fingerprint
- analyzer score
- analyzer hard invalid reasons
- strategy condition failures
- gate failures
- feature freshness state
- spread/ATR/session values
- lifecycle state of selected zone/OB/IFVG

### Expected Result

You can answer "why did it skip?" from the UI or DB without rerunning scripts.

## Monday Action Plan

## Phase 1: Critical Fixes Before Any Live Mode

1. Separate analyzer verdict from strategy gatekeeping.
2. Fix analyzer outcome cost model.
3. Make pip size symbol-aware for analyzer backtests.
4. Make zone selection lifecycle-aware.
5. Replace tapped-zone global block with scoring/retest logic.
6. Ensure lifecycle refresh runs before all-active strategy evaluation.
7. Add feature matrix preflight for live variants.
8. Deactivate broad active variants; use a strict live allowlist.

## Phase 2: Data Repair And Validation

1. Regenerate/backfill features for all live symbols and required timeframes.
2. Repair DXY generation or disable DXY-dependent strategy filters until fixed.
3. Verify `features_spread` is updating on 1m.
4. Verify XAUUSD has required `1m`, `5m`, `15m`, `1h`, `4h`, and `1d` features.
5. Run DB consistency checks.

## Phase 3: Strategy Validation

For each candidate variant:

1. Run 30-day PIT backtest.
2. Run 90-day PIT backtest.
3. Run conservative intrabar mode.
4. Run walk-forward.
5. Compare strategy signals with analyzer verdicts.
6. Generate rejection breakdown.
7. Keep only variants with real executed sample size and positive expectancy.

## Phase 4: Monday Market Open Protocol

Before London or New York session on Monday:

1. Confirm latest 1m candles are fresh.
2. Confirm features are fresh after new candles.
3. Confirm spread feature is current.
4. Confirm DXY/correlation state is either healthy or disabled.
5. Confirm active live allowlist.
6. Run live dry-run.
7. Start in paper or shadow mode.
8. Move to tiny supervised live only after the first clean pipeline cycle.

## Expected Improvements After These Changes

### Trading Quality

- Fewer missed high-quality SMC/ICT setups.
- Better handling of retests, mitigations, and liquidity-return entries.
- More realistic XAUUSD scoring and backtests.
- Less over-filtering by generic analyzer rules.
- Better per-symbol volatility behavior.

### Engineering Quality

- Cleaner separation between analyzer, strategy specs, gates, and execution.
- Backtests that better match live behavior.
- Easier debugging of rejected trades.
- Stronger DB and feature readiness checks.
- Safer strategy promotion process.

### Operational Readiness

- Clear go/no-go signal before live trading.
- Less chance of trading from stale data.
- Less chance of silently skipping valid setups.
- Easier Monday open monitoring.

## Recommended Final Architecture

```text
MT5 / Broker Feed
  -> Candle Store
  -> Feature Engine
  -> Lifecycle Refresh
  -> Feature Freshness Preflight
  -> Strategy Spec Engine
  -> Analyzer Enrichment
  -> Risk And Execution Gates
  -> Order Router
  -> Journal / Rejection Analytics
  -> Feedback Into Strategy Research
```

The key principle:

Strategy specs should be the tradable playbooks. The main analyzer should be the market-quality intelligence layer. It should illuminate good setups, not accidentally erase them.

## Agent Review & Additional Recommendations

The plan above is directionally correct. The most important insight — that the analyzer should enrich, not override, strategy specs — is the right architectural shift. Below are concrete opinions, alternative solutions, and a consolidated expected-results view.

### Opinions

1. **Do not try to fix the analyzer cost model in isolation.** The PIT backtester already has a battle-tested cost model (spread/2 + slippage, TP/SL adjustments, limit-fill logic). Diverging models are the real bug. The analyzer backtest should import and reuse the same simulation code rather than reimplementing it.
2. **"Analyzer invalid" must become a non-blocking tag by default.** Changing a verdict contract is not enough. The live pipeline needs a runtime switch: `analyzerBlocksLive = false` globally, plus per-strategy override. Every analyzer override should be persisted as a rejection log row so it can be audited later.
3. **The live allowlist should be the single source of truth.** `is_active` on strategy variants is overloaded. A cleaner model is one table/column set: `research_active`, `paper_active`, `live_active`. Promotion scripts should flip these flags automatically after checks pass.
4. **Zone lifecycle is already handled well in the PIT path.** The backtester uses LATERAL PIT lookups with `invalidated_at` / `mitigated_at` filters. The leak is in the analyzer path. Rather than building a second `selectTradableZones`, refactor the existing PIT helper into a shared module used by analyzer, live runner, and backtester.
5. **Volatility thresholds should be adaptive, not hardcoded per symbol/session.** A simpler first step is to normalize ATR to pips using `pairCharacteristics.pipSize` and compare against a symbol-specific percentile of recent ATR rather than static YAML maps. This avoids constant threshold tuning.
6. **A standalone `preflight` CLI is more valuable than more health checks in the UI.** The Monday open protocol should be one command (`node scripts/preflight-live.js`) that exits 0/1 and prints a JSON readiness report. The UI can call the same command.
7. **Do not wait for all data repair before paper trading.** Phase 1 fixes (analyzer separation, allowlist, lifecycle, rejection logging) can be validated in paper mode on EURUSD/GBPUSD while XAUUSD/DXY backfill runs in parallel. This reduces time-to-feedback.

### Better / Alternative Solutions

| Area | Plan's Proposal | Alternative / Addition | Why It Is Better |
|---|---|---|---|
| Analyzer vs strategy | `AnalyzerVerdict` with `status` + `hardInvalidReasons` | Make analyzer enrichment **opt-in per strategy** via `spec.analyzerMode: ignore \| warn \| block-on-hard-invalid`. Default to `warn`. | Keeps strategy specs in control; no silent analyzer veto. |
| Cost model | Fix analyzer outcome tracking | Move `simulateTrade` from `backtest-pit-v2.js` into `packages/tradePipeline` and call it from both PIT and analyzer backtests. | One model, no drift, fewer bugs. |
| Promotion contract | Manual phase checklist | Automate with `scripts/promote-strategy-to-live.js` that runs preflight + PIT + walk-forward and flips `live_active` only on pass. | Repeatable, auditable, prevents human optimism. |
| Feature readiness | Feature matrix checker | Implement as `scripts/preflight-live.js` that reads each `live_active` spec and checks required `(symbol, tf, feature)` rows exist with `MAX(ts)` within N candles. | Reusable for Monday open and CI. |
| Volatility gate | Per-symbol/session YAML thresholds | Use ATR percentile per symbol over last 20 sessions, or normalize to weekly ATR %. | Adapts to changing volatility without YAML edits. |
| Rejection analytics | Persist rejection details | Add a `rejection_log` table with `strategy_id`, `symbol`, `ts`, `reason_code`, `context_jsonb`, `session`. | SQL-queryable; powers dashboards and post-hoc analysis. |
| Missed setups | Missed-setup analyzer | First ship a simpler **signal-to-analyzer comparison report**: for every PIT signal, record analyzer score and whether live rejected it. | Faster to build and immediately shows false negatives. |
| DB checks | List of consistency checks | Wrap checks in a single `scripts/db-readiness.js` that returns JSON and fails on duplicates/stale indexes. | Can be run in CI and before market open. |

### Suggested Priority Tuning for Monday

If only a subset can be done before Monday, do these in order:

1. **Disable analyzer blocking by default** (one flag change + rejection logging).
2. **Create the live allowlist** (`live_active` flag) and deactivate all but one or two validated variants.
3. **Run `preflight-live.js`** for the allowed variants before market open.
4. **Start in paper mode** with live-shadow comparison logging.
5. **Fix the cost model drift** and zone lifecycle sharing in the background while paper runs.

## Expected Results

After implementing the plan plus the additions above, the system should hit these measurable outcomes:

| Metric | Current State | Target |
|---|---|---|
| Analyzer false-negative rate on spec-valid signals | Unknown (likely high) | < 20% |
| PIT/live parity gap (same spec, same period) | Significant due to analyzer/cost drift | < 10% |
| Feature freshness lag for live variants | Hours/gaps in some symbols/TFs | < 2 candles behind latest candle |
| Timeout rate for validated strategies | Varies, sometimes > 50% | < 30% unless timeout is intentional |
| Number of live-enabled variants | Many | 1–3 per session type |
| Time to promote a strategy to live | Ad-hoc | < 10 minutes via promotion script |
| Monday open readiness check | Manual/fragmented | Single `preflight-live.js` exits 0/1 |
| Rejection explainability | Re-runs required | Query `rejection_log` directly |
| Backtest/live cost drift | Two models | One shared `simulateTrade` implementation |
| XAUUSD data readiness | Missing lower-TF features | 1m/5m/15m/1h/4h/1d features present and fresh |

## Immediate Go/No-Go Recommendation

For Monday, 2026-07-06:

- Do not run broad unattended live trading.
- Do run paper/live-shadow after feature repair.
- Only allow tiny supervised live execution if preflight is clean and a candidate strategy passes fresh PIT validation.
- Keep analyzer warnings visible, but do not let generic analyzer blocks override strategy specs unless the reason is truly invalid market data, invalid risk, stale features, or impossible execution.

---

## Copilot Review — Opinions, Corrections, And Better Solutions

Date added: 2026-07-04
Reviewer: GitHub Copilot (automated codebase audit)

This section is an independent review of the plan above. It cross-checks each claim against the actual implementation in `packages/`, `scripts/`, and `apps/engine/`, flags where the plan is accurate, where it is overstated, and where a better solution exists. A consolidated **Expected Results** heading follows at the end.

### Overall Assessment

The plan is directionally sound and the layered architecture it proposes is the right target. However, an audit of the actual codebase shows that several "missing pieces" are partially implemented already, a few claims are overstated, and some proposed solutions add complexity where a smaller change would suffice. The Monday timeline is realistic only if the scope is cut to the truly blocking items.

### Claim-By-Claim Audit

| # | Plan claim | Codebase reality | Verdict |
|---|---|---|---|
| 1 | Analyzer `BLOCK` overrides spec-valid signals | `liveRunner.ts` does run the generic analyzer after strategy signals, and `evaluateSetup.ts` can return a `BLOCK` grade. But there is no formal `AnalyzerVerdict` contract with `hardInvalidReasons` yet. | Partially confirmed |
| 2 | Analyzer backtest ≠ strategy backtest | `scripts/backtest-pit-v2.js` and `packages/analyzerBacktest/` are genuinely separate paths. | Confirmed |
| 3 | Analyzer outcome cost model has bugs | `outcomeTracker.ts` has a generic pip-size fallback and a short-side TP branch that does not match the long-side spread adjustment. | Confirmed |
| 4 | Zone lifecycle logic is scattered | Lifecycle concepts exist in `computeEntryZone.ts`, `hardRules.ts`, and `entryQuality.ts`, but there is no shared `selectTradableZones` utility. | Partially confirmed |
| 5 | Feature tables incomplete for live | Real and recent — XAUUSD lower timeframes and `features_spread` sparsity are genuine gaps. | Confirmed |
| 6 | All-active ingest may skip lifecycle refresh | `liveRunner.ts` does refresh lifecycle before evaluation on its main path; the risk is narrower than the plan implies. | Partially confirmed |
| 7 | Volatility gate is one-size-fits-all | `volatilityGate.ts` is already symbol-aware for pip sizing. It is **not** session-aware, which is the real gap. | Partially confirmed |
| 8 | Too many variants active; no live allowlist | `promote-top3-live.js` and `dbLoader.ts` use `is_active` only. No `is_live_enabled` field exists. | Confirmed |
| 9 | Health endpoint can be misleading | `TM_DISABLE_FEATURE_JOBS=true` is set, but health still references job timestamps in places. | Confirmed |
| 10 | No promotion contract | No mechanical promotion gates exist beyond manual script edits. | Confirmed |
| 11 | Backtest live parity gaps | Real, especially around analyzer-as-extra-gate and feature freshness strictness. | Confirmed |
| 12 | Market data robustness unproven | No market-open watchdog exists. | Confirmed |
| 13 | No "missed great setup" audit | Not present. | Confirmed |
| 14 | DB reliability gaps | No structural consistency checker exists. | Confirmed |
| 15 | Rejection logging thin | `logSignalRejection` already persists structured fields (symbol, strategy, side, reason, fingerprint). The plan understates what exists. | Partially confirmed |

### Opinions And Better Solutions

#### On item 1 — Analyzer verdict contract

The plan's `AnalyzerVerdict` type is good, but introducing it as a hard contract across both the analyzer and the live pipeline in one weekend is risky. A better, smaller first step:

- Add a single `hardInvalid: boolean` + `hardInvalidReasons: string[]` to the existing `evaluateSetup` return shape.
- In `liveRunner.ts`, only block on `hardInvalid === true`. Treat everything else as a warning that reduces size or logs a flag.
- Defer the full `AnalyzerVerdict` rename until after Monday.

This achieves the safety goal without a wide refactor.

#### On item 3 — Outcome cost model

The plan is correct, but the highest-leverage fix is narrower than listed. The short-side TP spread adjustment is the single bug most likely to inflate XAUUSD results. Fix that first; the `plannedR` vs `realizedR` split is valuable but can land after Monday. Pip-size symbol awareness should be centralized in one helper (e.g., `packages/shared/src/pipSize.ts`) and imported everywhere, rather than threaded through every call site.

#### On item 4 — Shared zone selection

A full `selectTradableZones(symbol, tf, asOf, direction, options)` utility is the right end state, but for Monday a smaller change is safer: extract the existing lifecycle filter from `hardRules.ts` into a pure function in `packages/levels/` and have both `hardRules.ts` and `entryQuality.ts` call it. This removes the duplication without changing behavior, which is exactly what you want before a live session.

#### On item 7 — Volatility gate

The plan proposes a rich per-symbol per-session YAML matrix. That is correct long-term but heavy for Monday. A better interim solution:

- Add a single `session` field to the existing gate params.
- Pull the session from the feature engine (it already computes it).
- Apply a per-symbol `maxAtrMultiplier` on top of the existing symbol-aware pip sizing.
- Emit the diagnostic fields (raw ATR, ATR pips, threshold, session, skip reason) into the rejection log.

This unblocks `orb_classic` and `watukushay_no1` without a schema migration.

#### On item 8 — Live allowlist

The plan's `is_live_enabled` column is the right design. For Monday, a faster equivalent that needs no migration:

- Add a `live_allowlist` table or a JSON config file (`conf/live-allowlist.json`) listing the approved variant IDs.
- Have `dbLoader.ts` intersect `is_active` with the allowlist when loading for live execution.
- Backtest/research paths continue to use `is_active` only.

This gives the safety of a strict allowlist immediately and can be promoted to a real column later.

#### On item 9 — Health checks

Agree fully. The single most useful change is to make health query `MAX(ts)` per feature table per symbol/tf and compare against `MAX(ts)` of `candles_1m`. That one query replaces most of the job-timestamp logic and is immune to `TM_DISABLE_FEATURE_JOBS`.

#### On item 13 — Missed setup audit

This is the highest-value item in the entire plan and is correctly prioritized as a research tool. One addition: persist the missed-setup results into the same rejection table (item 15) with a `source = "missed_audit"` discriminator, so the UI can show both live rejections and historical misses in one view.

#### On item 15 — Rejection logging

The plan understates the current state. `logSignalRejection` already persists structured fields. The gap is not "no rejection logging" but "rejection logging does not include analyzer score, gate failure detail, and lifecycle state of the selected zone." That is a smaller, additive change — extend the existing payload rather than build new infrastructure.

### Items the plan misses

1. **Idempotency of the ingest→feature→lifecycle chain.** The plan lists the sequence but does not require it to be idempotent. If a 1m candle arrives twice (broker resend), the feature engine must not double-write. Add a unique constraint on `(symbol, tf, ts)` for feature tables and an `ON CONFLICT DO NOTHING` on the ingest path.

2. **Clock skew between broker time and DB time.** All freshness checks should use broker timestamp, not `now()` on the DB host. The plan's preflight uses "latest timestamp" without specifying the clock domain. This is a silent source of false stale/positive-fresh readings.

3. **Kill switch.** There is no mention of a manual kill switch that halts live order routing without stopping the rest of the pipeline. For a first live session this is essential — a single env flag or DB row that `liveRunner.ts` checks before every order, and that the dashboard can flip.

4. **Position-level risk cap independent of strategy.** The plan separates risk/execution as a layer but does not call out a hard max-open-positions and max-account-risk-per-symbol cap that applies regardless of which strategy fired. For Monday, a single guard "max 1 open position per symbol, max 2 total" prevents a gate bug from opening a flood of orders.

5. **Feature backfill determinism.** The plan says "regenerate features" but does not require the backfill to be deterministic and replayable. Without that, a Monday re-run can produce slightly different feature rows than the backtest used, silently invalidating the validation. Pin the backfill to the same code path as live feature generation.

### Priority recommendation for Monday

Cut the Monday scope to these five items only. Everything else can follow in week 2.

1. Add `hardInvalid` to `evaluateSetup` and only block on it in `liveRunner.ts` (item 1, minimal version).
2. Fix the short-side TP spread adjustment in `outcomeTracker.ts` (item 3, minimal version).
3. Add a `conf/live-allowlist.json` and intersect it in `dbLoader.ts` (item 8, minimal version).
4. Add a kill switch + max-open-positions guard in `liveRunner.ts` (new item).
5. Add the feature freshness health query (item 9, minimal version).

Run paper/shadow mode only. Do not attempt the full promotion contract, missed-setup audit, or volatility session matrix before Monday.

## Competitor-Informed Upgrade Blueprint

This section maps the best patterns from mature trading platforms into concrete upgrades for this app.

Research references:

- QuantConnect LEAN separates algorithm work into Universe Selection, Alpha Creation, Portfolio Construction, Execution, and Risk Management modules.
- Freqtrade separates backtesting, hyperopt, dry-run, live, and AI modes; it explicitly recommends dry mode before risking capital.
- Backtrader treats broker simulation, slippage, observers, and analyzers as first-class concepts.
- MetaTrader 5 emphasizes real-tick testing and forward testing to reduce optimization/parameter-fitting risk.

### 1. Adopt A LEAN-Style Modular Trading Pipeline

| Area | Before | Best-Practice Pattern | After |
|---|---|---|---|
| Signal flow | Analyzer, strategy specs, gates, and live execution can overlap in responsibility. | QuantConnect-style separation of alpha, portfolio construction, execution, and risk. | Feature Engine -> Analyzer Intelligence -> Strategy Spec Engine -> Portfolio/Risk -> Execution. Each layer has one job. |
| Analyzer role | Can act like a trade blocker through `BLOCK`. | Alpha/research layer produces signals, scores, confidence, and context. | Analyzer returns `hardInvalid`, `warnings`, `score`, and `tags`; only `hardInvalid` blocks. |
| Strategy specs | Declarative playbooks, but live path can add generic analyzer rejection. | Strategies should be playbook-specific alpha modules. | Specs decide whether setup belongs to a playbook; analyzer enriches and sizes, not overrides. |
| Risk | Gates are attached after broad signal generation. | Portfolio/risk model receives targets and applies exposure rules. | One centralized portfolio-risk layer handles account risk, symbol risk, family risk, correlation, and duplicates. |

Expected improvement:

- Fewer valid strategy setups rejected by generic analyzer rules.
- Cleaner debugging because every rejection belongs to exactly one layer.
- Easier future expansion to multiple strategies and symbols without gate spaghetti.

### 2. Add Freqtrade-Style Research Modes And Promotion Stages

| Area | Before | Best-Practice Pattern | After |
|---|---|---|---|
| Modes | `is_active` and live eligibility can blur together. | Freqtrade has separate backtesting, hyperopt, dry-run, and live modes. | Add explicit `research`, `backtest`, `shadow`, `paper`, and `live` states. |
| Promotion | Variants can be active without current proof. | Dry-run/forward-test before live. | Strategy must pass feature matrix, PIT, walk-forward, shadow, paper, then live. |
| Protections | Gates exist, but backtest/live parity varies. | Protections must be enabled and measured in testing. | Every live gate must also run in PIT/live-parity backtest with rejection counts. |
| Optimization | Many hand variants exist. | Hyperopt/parameter tuning is separated from live deployment. | Add parameter search only inside research mode; freeze spec hash before promotion. |

Expected improvement:

- Research can stay creative without accidentally becoming live risk.
- Current-vs-seed mismatch becomes visible before deployment.
- Strategy activation becomes mechanical rather than emotional.

### 3. Make Backtrader-Style Analyzers And Observers First-Class

| Area | Before | Best-Practice Pattern | After |
|---|---|---|---|
| Backtest output | JSON files and summaries exist, but analysis is fragmented. | Backtrader analyzers/observers calculate drawdown, returns, exposure, broker value, trade stats. | Add reusable analyzers: drawdown, exposure, gate skips, duplicate clusters, session edge, symbol edge, analyzer-vs-spec disagreement. |
| Slippage | PIT has costs, analyzer backtest has known cost issues. | Broker simulator exposes configurable slippage. | One shared cost model for PIT, analyzer backtest, and live dry-run. |
| Observability | "Why skipped?" often requires rerunning scripts. | Observers record broker/strategy state per step. | Persist decision snapshots for accepted, rejected, and missed setups. |
| Statistics | Net R and WR dominate. | Full analyzer pack: drawdown, streaks, distribution, exposure, time-in-market. | Report expectancy by setup type, session, symbol, direction, feature quality, and gate. |

Expected improvement:

- Backtests become diagnostic tools, not just scoreboard files.
- The team can distinguish "strategy has no edge" from "gate killed edge" from "feature missing."

### 4. Add MT5-Style Real-Tick And Forward Validation Discipline

| Area | Before | Best-Practice Pattern | After |
|---|---|---|---|
| Data granularity | Many tests use 1m candles and intrabar assumptions. | MT5 distinguishes modeled ticks from real ticks and treats real ticks as closer to market behavior. | Add tick-backed validation for short-hold XAUUSD strategies before live. |
| Optimization | Good saved variants can look strong. | MT5 forward testing splits optimization and validation periods. | Require in-sample/out-of-sample split and walk-forward before promotion. |
| Intrabar order | TP/SL sequencing can materially change results. | Strategy tester modes make modeling assumptions explicit. | Run `tp_first`, `sl_first`, and realistic/tick-backed modes; promote only if edge survives conservative mode. |
| Live readiness | Dry run exists but is not a formal stage. | Forward test confirms optimized parameters. | Paper/shadow is mandatory after backtest and before live. |

Expected improvement:

- One-bar XAUUSD systems stop looking better than they will trade.
- Optimization bias is reduced before real capital is exposed.

### 5. Add A Professional Feature Store Contract

| Area | Before | Best-Practice Pattern | After |
|---|---|---|---|
| Feature freshness | Checked in places, but not as a formal strategy contract. | Mature quant stacks treat data availability as a prerequisite to alpha. | Every strategy declares `requiredFeatures`; preflight verifies symbol, timeframe, row count, and freshness. |
| Reproducibility | Reports do not always include feature/spec/code versions. | Production research records full run manifests. | Every backtest saves spec hash, feature engine version, migration version, data range, and feature matrix. |
| Feature gaps | Missing DXY/spread/lower-TF features can silently degrade results. | Data quality failures block research/live use. | Missing required features produce hard preflight failure, not zero-signal mystery. |
| Lifecycle | Zone/OB/IFVG lifecycle may drift between backtest and live. | Stateful features need deterministic replay. | Use one deterministic feature/lifecycle path for backfill and live updates. |

Expected improvement:

- Current-vs-seed performance divergence becomes explainable.
- Backtests become reproducible artifacts, not just historical screenshots.

### 6. Add A Missed-Setup Intelligence Layer

| Area | Before | Best-Practice Pattern | After |
|---|---|---|---|
| Research question | Mostly asks "what happened when strategy fired?" | Strong research platforms analyze opportunity cost and false negatives. | Add missed-setup scanner that finds large moves and asks why no trade was taken. |
| Analyzer value | Analyzer grades current context but does not prove missed edge. | Alpha research compares signals with future returns. | Analyzer score is measured against future R distribution. |
| Strategy tuning | Variants are manually compared. | Systematic research labels why setups were skipped. | Missed setups classified by feature gap, spec strictness, gate, analyzer block, or no entry model. |
| UI/debug | Rejection and missed opportunities are separate concepts. | Unified event ledger. | Store live rejections and historical misses in one decision-event table. |

Expected improvement:

- The system can tell whether it is too strict, too loose, or missing entire setup classes.
- SMC/ICT logic can improve from missed winners, not just losing trades.

### 7. Use A Portfolio-First Risk Model

| Area | Before | Best-Practice Pattern | After |
|---|---|---|---|
| Risk budget | Strategy-level and gate-level controls exist, but duplicates can cluster. | Portfolio construction/risk layer owns total exposure. | Add one-risk-budget-per-idea, per-symbol cap, per-family cap, total heat, and currency-leg exposure. |
| Duplicate signals | Rate limits/portfolio heat clean up duplicates after the fact. | Portfolio layer merges/chooses targets. | Cluster same idea by symbol, direction, zone/OB/IFVG, timestamp window, and strategy family. |
| Multi-strategy overlap | Portfolio overlap report exists but is not live control. | Risk model controls overlap before execution. | Live portfolio model rejects/merges redundant setups before order creation. |
| Daily controls | Daily win/loss gates can distort strategy stats. | Risk controls should be measured separately from alpha quality. | Report raw alpha performance and risk-filtered performance separately. |

Expected improvement:

- Fewer duplicate XAUUSD entries.
- Cleaner measurement of actual strategy edge.
- Lower chance of Monday overexposure from clustered signals.

### 8. Best Possible Target Architecture

| Component | Current State | Target State |
|---|---|---|
| Ingest | Web request can trigger compute and trading. | Ingest writes candles and enqueues deterministic work. |
| Feature Engine | Strong DAG foundation, but feature gaps exist. | Deterministic feature store with freshness contract and replay manifest. |
| Analyzer | Generic setup grader can block. | Market intelligence layer that scores/tags/enriches. |
| Strategy Specs | Good declarative direction. | Strict playbook layer with schema validation, spec hashes, and promotion states. |
| Backtester | PIT runner is useful; analyzer backtest differs. | Live-parity simulator with shared cost/fill/risk/analyzer path. |
| Risk | Multiple gates. | Portfolio-first risk construction and execution guardrails. |
| Execution | EA bridge and order state machine exist. | Kill switch, shadow mode, tick/slippage-aware dry-run, and execution-quality reports. |
| Research | Many reports and variants. | Unified research warehouse with analyzers, missed-setup events, and variant scoreboard. |

## Expected Results

### After the minimal Monday scope

- No spec-valid trade is blocked by a generic analyzer warning; only `hardInvalid` reasons block.
- XAUUSD analyzer backtest results drop to realistic levels (expect 10–25% lower reported R as the short-side spread bug is corrected).
- At most the allowlisted variants can place orders, regardless of how many `is_active` variants exist.
- A single dashboard toggle can halt all live order routing within one evaluation cycle.
- The health endpoint reports true feature freshness per symbol/timeframe, eliminating false "healthy" readings when feature jobs are disabled.

### After the full plan (weeks 2–4)

- **Trading quality:** measurably fewer missed high-quality SMC/ICT retest and mitigation setups; expect a 15–40% reduction in "missed great setup" incidents based on the missed-setup audit.
- **Backtest fidelity:** PIT backtest net R within 10% of live forward-test net R for the same variant and window, because the analyzer gate, feature freshness, and cost model are aligned.
- **XAUUSD realism:** analyzer and PIT backtests converge on the same cost model, removing the current XAUUSD over-optimism.
- **Volatility gate:** `orb_classic` and `watukushay_no1` stop losing 100% of raw signals to a single gate; expect at least 30–50% of previously skipped signals to become eligible after per-symbol/session thresholds.
- **Promotion discipline:** zero strategies reach live without passing the mechanical promotion contract; this removes "recent optimism" bias as a deployment path.
- **Debugging speed:** "why did it skip?" answerable from the UI/DB in under 30 seconds without rerunning scripts, because rejection payloads include analyzer score, gate detail, and zone lifecycle state.
- **Operational readiness:** a clean go/no-go signal before each session, with market-open watchdog catching stale candles, spread gaps, and feature lag before the first trade.
- **DB integrity:** structural consistency checks catch duplicate candles, duplicate feature rows, and stale aggregates before strategy evaluation, preventing silent point-in-time corruption.

### Quantitative targets to verify post-implementation

| Metric | Current | Target |
|---|---|---|
| Spec-valid trades blocked by analyzer | unknown (likely >0) | 0 |
| XAUUSD analyzer R vs PIT R gap | large | < 10% |
| `orb_classic` signals skipped by volatility gate | 100% | < 50% |
| Time to answer "why skipped?" | rerun scripts | < 30s via UI |
| Live variants active | many | ≤ 3 (allowlist) |
| Feature freshness false positives | present | 0 |
| Missed great-setup audit coverage | none | full 90-day window |

### Risk if the minimal scope is not done

- A spec-valid setup is silently blocked by a generic analyzer `BLOCK` → missed trade on Monday open.
- XAUUSD backtest optimism leads to oversized live sizing → larger than expected drawdown.
- A gate bug opens multiple orders on the same symbol → overexposure on the first live session.
- Health reports "healthy" while features are stale → trades placed on stale context.
