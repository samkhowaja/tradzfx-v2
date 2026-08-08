# Unified Live Readiness And Backtest Pipeline Plan

Date: 2026-07-04

Source reports:

- `reports/MONDAY_LIVE_READINESS_ARCHITECTURE_PLAN.md`
- `reports/BACKTEST_SETUP_DEEP_DIVE_GAPS_OVERDONE.md`

Security is intentionally out of scope except where a control directly affects live-trading safety, such as kill switch, live allowlist, and order-routing guardrails.

## Executive Verdict

The app should move to a strict layered trading architecture:

```text
Ingest -> Feature Store -> Analyzer -> Strategy Specs -> Portfolio Risk -> Execution -> Journal/Research
```

The main analyzer should be an intelligence layer, not the final strategy gate. It should detect, score, tag, and explain market opportunities. Strategy specs should be the tradable playbooks. Portfolio risk should decide whether a valid playbook signal can be executed under current account, exposure, spread, volatility, and duplication constraints.

The current system has strong foundations: declarative strategy specs, a PIT backtester, feature tables, live gates, and useful XAUUSD research artifacts. The main weaknesses are inconsistent feature readiness, analyzer/spec overlap, overactive gates, duplicated idea risk, weak current-vs-seed reproducibility, and no systematic missed-setup audit.

## Unified Before/After Pipeline

| Pipeline stage | Current state | Weakness | Best-practice architecture | Expected result |
|---|---|---|---|---|
| Market data ingest | Ingest writes candles and may trigger downstream work. | Ingest, feature compute, and strategy evaluation can be too tightly coupled. | Ingest validates/writes candles and enqueues deterministic work. | Lower latency, fewer duplicate side effects, easier replay. |
| Candle aggregation | Higher-timeframe candles exist and are mostly consistent. | Freshness and missing-candle continuity are not proven before every live run. | Add market-open watchdog for latest candle age, continuity, gaps, and broker clock skew. | No live strategy runs on stale or discontinuous candles. |
| Feature engine | DAG-based feature engine is a strong base. | Feature tables can be missing, sparse, stale, or inconsistent by symbol/timeframe. | Treat features as a feature store with explicit per-strategy contracts. | Backtests and live runs fail loudly when required context is missing. |
| Lifecycle refresh | Zone/OB/IFVG lifecycle exists. | Backfill/live lifecycle sequencing can drift; all-active path may miss refresh. | Always run feature generation -> lifecycle refresh -> feature matrix before strategy evaluation. | Backtest and live select the same valid market structures. |
| Feature readiness | Some live freshness checks exist. | Health can be misleading when feature jobs are disabled; current-vs-seed mismatch is hard to explain. | `FeatureReadinessMatrix` checks actual table freshness against latest candles. | Clear go/no-go before each live session and before trusting a backtest. |
| Analyzer | Generic setup engine scores context and can return `BLOCK`. | Generic analyzer can reject strategy-valid SMC/ICT setups. | Analyzer emits verdict, score, confidence, tags, warnings, and hard-invalid reasons. | Fewer false negatives; analyzer becomes explainable intelligence. |
| Strategy spec engine | YAML specs encode playbooks. | Too many active variants; current candidates no longer reproduce older seed strength. | Specs are playbooks with schema validation, spec hashes, promotion state, and live allowlist. | Only proven current candidates reach live execution. |
| Backtest/live parity | PIT backtester is useful; analyzer backtest differs. | Live path can include analyzer/gates not fully represented in backtest. | Add live-parity mode using same analyzer, cost model, gates, portfolio risk, and feature freshness. | PIT results become closer to paper/live behavior. |
| Portfolio risk | Multiple gates exist. | Rate limit, portfolio heat, and daily gates clean up broad signal generation after the fact. | Portfolio-first risk model with one-risk-budget-per-idea, family budgets, exposure caps, and correlated risk. | Fewer duplicate entries and cleaner alpha measurement. |
| Execution | EA/order routing and order state exist. | Fast XAUUSD setups may be optimistic without tick/slippage validation; kill switch should be explicit. | Execution router supports kill switch, paper/shadow/live modes, shared cost model, and conservative fill validation. | Lower live blast radius and more realistic short-hold strategy testing. |
| Journal/rejections | Rejection logging exists but lacks full context. | "Why skipped?" can require rerunning scripts. | `DecisionEvent` ledger records accepted, rejected, and missed opportunities with analyzer, gates, feature, and lifecycle context. | Skip reasons answerable quickly from DB/UI. |
| Missed-setup research | Saved reports mostly analyze trades taken. | No systematic false-negative research. | Missed-setup scanner finds large moves and reconstructs why no trade fired. | The system learns from missed winners, not only losing trades. |
| Strategy promotion | Many research variants exist. | `is_active` can blur research and live eligibility. | Promotion states: research -> candidate -> shadow -> paper -> live -> retired. | Research remains flexible while live deployment is controlled. |

## Point-By-Point Consolidated Upgrade Matrix

| Source issue | Pipeline layer | Lacking / overdone | Recommended fix | Before | After | Expected measurable result | Priority |
|---|---|---|---|---|---|---|---|
| Analyzer/spec separation | Analyzer, Strategy Specs | Generic analyzer can block playbook-valid trades. | Add `AnalyzerVerdict`; only `hardInvalidReasons` block. | `BLOCK` can erase valid SMC setups. | Analyzer enriches; strategy specs decide playbook validity. | Spec-valid trades blocked by analyzer warnings: `0`. | Monday |
| Analyzer backtest mismatch | Backtest/live parity | Analyzer backtest does not validate YAML specs. | Keep analyzer discovery backtest separate from PIT/live-parity backtest. | Analyzer results can be mistaken for live strategy proof. | PIT/live-parity is promotion source of truth. | Promotion reports clearly separate discovery vs deployable edge. | Week 2 |
| Analyzer outcome cost bugs | Backtest/live parity, Execution | Cost model and pip-size handling can overstate results, especially XAUUSD. | Use shared symbol-aware cost/fill model across analyzer, PIT, dry-run, live. | Analyzer R can diverge from PIT R. | Analyzer/PIT use same spread, slippage, pip size, realized R. | Analyzer vs PIT R gap below `10-15%`. | Monday |
| Zone lifecycle/retest logic | Feature Store, Analyzer | Tapped/mitigated zones can be blocked too broadly or stale zones can influence scoring. | Shared lifecycle-aware zone selector with retest/mitigation scoring. | Good retests can be missed; stale zones can pollute context. | Zones are selected by lifecycle, quality, age, distance, and setup type. | Fewer missed retest/mitigation setups; lifecycle mismatch incidents trend to `0`. | Week 2 |
| Feature gaps | Feature Store | Required feature rows can be missing/stale by symbol/timeframe. | Add `FeatureReadinessMatrix` and block invalid backtests/live runs. | Zero-signal mysteries and stale-feature risk. | Missing required context fails loudly. | Required feature matrix rows: `100% present/fresh` for live variants. | Monday |
| DXY/spread gaps | Feature Store, Execution | DXY missing; spread features sparse/stale. | Make DXY/correlation and spread explicit strategy dependencies. | Correlation/SMT degraded silently; short-hold costs unreliable. | Strategies requiring DXY/spread cannot run without fresh reference data. | DXY and spread readiness reported before promotion/live. | Monday |
| Lifecycle refresh sequencing | Feature Store, Live Pipeline | All-active live path can evaluate before lifecycle is refreshed. | Enforce ingest -> features -> lifecycle -> readiness -> strategy. | Live may use stale lifecycle columns. | Every live evaluation uses refreshed lifecycle state. | Lifecycle refresh lag visible and blocking when stale. | Monday |
| Volatility gate overblocking | Portfolio Risk, Gates | Current July ORB/Watukushay raw signals are 100% blocked by volatility. | Symbol/session/regime-specific thresholds with diagnostics. | One blunt threshold can kill a family. | Gate reports threshold used, ATR, symbol profile, session, and reason. | Volatility skip rate below `50%` unless intentionally disabled. | Week 2 |
| Active variant sprawl | Strategy Specs, Promotion | Too many active variants; active can imply too much. | Separate research active from live allowlist/promotion state. | Many variants can reach evaluation. | Only allowlisted `live`/`paper` variants can route orders. | Live eligible variants <= approved list, target <= `3`. | Monday |
| Misleading health checks | Feature Readiness, Ops | Job timestamps can misrepresent actual feature freshness. | Health queries actual `MAX(ts)` per required feature vs latest candle. | Health can say healthy while features are stale. | Health reflects candle, feature, spread, DXY, and active live variant state. | Feature false-positive health readings: `0`. | Monday |
| Strategy promotion contract | Promotion | Old aggregate reports can be over-trusted. | Require feature matrix, PIT, conservative intrabar, walk-forward, shadow, paper. | Strong report can be treated as live proof. | Mechanical promotion state controls live eligibility. | No strategy reaches live without promotion evidence. | Month 1 |
| Live-parity backtest | Backtest/live parity | PIT does not always include full live analyzer/gate/risk path. | Add `--live-parity`, feature freshness, analyzer verdict, live gates, shared risk. | Backtest can overstate live behavior. | Backtest simulates what live would do. | PIT vs paper net R gap below `10-15%`. | Week 2 |
| Market data robustness | Ingest, Candle Store | Live feed continuity, broker clock skew, weekend gaps need stronger proof. | Market-open watchdog for freshness, continuity, spread, heartbeat, feature lag. | Monday open issues may be discovered late. | Go/no-go signal before first trade. | Latest candle age under threshold; missing candle count `0` for live symbols. | Monday |
| Missed great setup audit | Research, Analyzer | Reports mostly analyze trades taken, not opportunities missed. | Build missed-setup scanner and classify why no trade fired. | False negatives are invisible. | Missed winners categorized by feature gap, spec strictness, gate, analyzer block, no entry. | Full 90-day missed-setup coverage. | Week 2 |
| DB reliability | Database, Feature Store | Point-in-time consistency and duplicate feature/candle risks need explicit checks. | Add DB readiness: indexes, duplicates, PKs, aggregates, feature-vs-candle lag. | Data corruption can poison features/backtests. | DB preflight blocks invalid research/live runs. | Duplicate required rows: `0`; migration/PK checks pass. | Week 2 |
| Rejection logging | Journal/Research | Rejections lack analyzer score, full gate detail, lifecycle state. | Extend decision/rejection payloads into a unified `DecisionEvent`. | "Why skipped?" often needs scripts. | Accepted, rejected, and missed events share one ledger. | Time to answer "why skipped?" below `30s`. | Week 2 |
| Duplicate idea clustering | Portfolio Risk, Research | Same-minute/same-burst XAUUSD trades can be counted independently. | Add `IdeaCluster` and one-risk-budget-per-idea. | Rate limit/heat clean up after duplicate signals exist. | Cluster first, then allocate one risk budget. | Duplicate clustered entries reduced materially; cluster report exists. | Week 2 |
| One-risk-budget-per-idea | Portfolio Risk | Multiple strategies can express the same idea. | Merge/choose signals by symbol, direction, family, zone/OB/IFVG, and time window. | Same market idea can stack risk. | Portfolio model owns idea-level exposure. | Max risk per idea enforced in live and PIT. | Week 2 |
| XAUUSD short-edge modeling | Analyzer, Strategy Specs | Backtests show short-side XAUUSD edge but it is not explicitly modeled. | Add XAUUSD session/regime/bias tags and pair-specific playbooks. | Edge is accidental and hard to defend. | Short-bias context becomes measurable and explainable. | XAUUSD long/short performance reported separately by regime/session. | Month 1 |
| SMC/ICT sweep sequencing | Feature Engine, Analyzer | Sweep logic can miss canonical inducement -> sweep -> CHoCH/MSS -> entry flow. | Add sweep-before-confirmation model and tag confirmation separately. | Reversal setups can be missed. | Canonical ICT reversal path is detectable and testable. | Missed sweep-reversal category decreases after implementation. | Month 1 |
| Real-tick/conservative execution | Execution, Backtest/live parity | Many strong XAUUSD results close in 1-2 bars. | Require conservative intrabar and tick-backed validation for short-hold live candidates. | Fast scalps may look better than live execution. | Only strategies surviving cost/fill stress reach live. | `sl_first` and tick-backed results remain acceptable before promotion. | Month 1 |

## Target Architecture

Best target pipeline:

```text
Broker/MT5
  -> Ingest API
  -> Candle Store
  -> Feature DAG
  -> Lifecycle Engine
  -> Feature Matrix
  -> Strategy Spec Engine
  -> Analyzer Enrichment
  -> Portfolio Risk Engine
  -> Execution Router
  -> Journal/Research Warehouse
```

Design notes from mature platforms:

- QuantConnect/LEAN pattern: keep alpha, portfolio construction, execution, and risk management separate. In this app, analyzer/specs produce alpha context, portfolio risk converts it into allowed exposure, and execution only routes approved orders.
- Freqtrade pattern: separate research/backtest/hyperopt/dry-run/live states. In this app, use `research`, `candidate`, `shadow`, `paper`, `live`, and `retired` so broad experimentation cannot become accidental live risk.
- Backtrader pattern: analyzers, observers, broker simulation, and slippage are first-class. In this app, every backtest should emit drawdown, exposure, gate skips, duplicate clusters, analyzer/spec disagreement, and cost sensitivity.
- MetaTrader 5 pattern: real-tick and forward testing reduce optimization bias. In this app, any short-hold XAUUSD candidate must survive conservative intrabar and tick-backed validation before live promotion.

## Important Future Interfaces

These interfaces are proposed for future implementation. They are not implemented by this report.

### `AnalyzerVerdict`

```ts
type AnalyzerVerdict = {
  status: "valid" | "warning" | "invalid";
  hardInvalidReasons: string[];
  warnings: string[];
  qualityScore: number;
  confidence: number;
  tags: string[];
  recommendedStrategyFamilies: string[];
};
```

Purpose:

- `hardInvalidReasons` can block.
- `warnings` reduce confidence, size, or require confirmation.
- `tags` identify setup type, such as retest, mitigation, sweep-return, IFVG-continuation, or XAUUSD-session-short.

### `FeatureReadinessMatrix`

```ts
type FeatureReadinessMatrixRow = {
  strategyId: string;
  symbol: string;
  timeframe: string;
  feature: string;
  required: boolean;
  latestTs: string | null;
  latestCandleTs: string | null;
  freshnessStatus: "fresh" | "stale" | "missing" | "not_required";
  rowCount: number;
  blockingReason?: string;
};
```

Purpose:

- Blocks live/backtest promotion when required features are stale or missing.
- Explains zero-signal windows caused by missing context.

### `StrategyPromotionState`

```ts
type StrategyPromotionState =
  | "research"
  | "candidate"
  | "shadow"
  | "paper"
  | "live"
  | "retired";
```

Purpose:

- `research`: can be tested, cannot trade.
- `candidate`: passed basic feature/backtest checks.
- `shadow`: emits decisions only.
- `paper`: routes paper orders.
- `live`: can route live orders through allowlist and kill-switch checks.
- `retired`: retained for audit, not eligible.

### `DecisionEvent`

```ts
type DecisionEvent = {
  source: "live" | "paper" | "shadow" | "backtest" | "missed_audit";
  eventType: "accepted" | "rejected" | "missed";
  strategyId?: string;
  familyId?: string;
  symbol: string;
  timeframe?: string;
  ts: string;
  analyzerVerdict?: AnalyzerVerdict;
  strategyResult?: Record<string, unknown>;
  gateResult?: Record<string, unknown>;
  featureState?: FeatureReadinessMatrixRow[];
  lifecycleState?: Record<string, unknown>;
  reasonCodes: string[];
};
```

Purpose:

- One ledger for accepted trades, rejected live signals, and historically missed opportunities.
- Makes "why skipped?" answerable without rerunning scripts.

### `IdeaCluster`

```ts
type IdeaCluster = {
  clusterId: string;
  symbol: string;
  direction: "buy" | "sell";
  strategyFamilyIds: string[];
  primaryStructureId?: string;
  structureKind?: "zone" | "order_block" | "ifvg" | "sweep" | "level";
  windowStartTs: string;
  windowEndTs: string;
  maxRiskBudgetPct: number;
  selectedSignalId?: string;
  suppressedSignalIds: string[];
};
```

Purpose:

- Groups duplicate signals by symbol, direction, strategy family, structure identity, and time window.
- Enforces one risk budget per market idea.

## Evidence To Preserve

| Evidence | Meaning | Action |
|---|---|---|
| `smart_risk_ob_ifvg_1m_runon_15r_final` saved result: 97 executed, 71.1% WR, +75.58R | Strong XAUUSD candidate with fast holds. | Re-run after feature repair with duplicate clustering and conservative execution. |
| `keylevel_bounce_v8c_min3` saved result: 27 executed, 66.7% WR, +50.08R | Promising XAUUSD short/level candidate. | Validate sample size, fill realism, and current-window reproducibility. |
| Curated seed reports showed strong `doyle_sd`, `orb_classic`, `watukushay_no1`. | Historical strategy layer may have had edge under prior feature state. | Do not discard yet; first explain seed-vs-current mismatch. |
| Current July checks showed `orb_classic` and `watukushay_no1` executing zero trades due to volatility. | Current live candidates are not ready without gate/data diagnosis. | Add volatility diagnostics and feature matrix before promotion. |
| Current `doyle_sd` 30-day check produced only 1 executed XAUUSD loss. | Top candidate is not currently proven live-ready. | Keep paper/shadow until refreshed PIT and live-parity tests pass. |
| XAUUSD features/spread/DXY showed gaps or staleness. | Backtest/live context is incomplete. | Feature matrix and DXY/spread repair are Monday blockers. |

## Expected Results

| Upgrade | Expected result | Target metric |
|---|---|---|
| Analyzer hard-invalid split | Fewer false analyzer blocks of valid SMC/ICT setups. | Analyzer-blocked spec-valid trades: `0`, except hard-invalid. |
| Feature readiness matrix | No strategy runs with missing/stale required context. | Required feature matrix: `100% present/fresh` for live variants. |
| Shared cost/fill model | Analyzer and PIT results converge. | Analyzer vs PIT R gap below `10-15%`. |
| Live-parity PIT mode | Backtests better predict paper/live behavior. | PIT vs paper net R gap below `10-15%`. |
| Volatility diagnostics/calibration | ORB/Watukushay no longer lose all raw signals to one gate unless intentionally disabled. | Volatility skip rate below `50%` after calibration. |
| Idea clustering | Fewer duplicate XAUUSD entries and cleaner stats. | Same-burst duplicate clusters reported and suppressed. |
| Decision event ledger | Faster skip/rejection diagnosis. | "Why skipped?" answerable from DB/UI in under `30s`. |
| Missed-setup audit | Fewer invisible false negatives. | Full 90-day missed-opportunity report with reason categories. |
| Promotion states | No stale/overfit strategy reaches live. | Every live variant has promotion evidence and spec hash. |
| Market-open watchdog | Stronger Monday go/no-go signal. | Fresh candles, spread, DXY, feature lag, and active live variants all visible before trade one. |

## Prioritized Roadmap

### Monday Critical

1. Add analyzer hard-invalid split to the planned architecture and stop treating generic warnings as strategy blockers.
2. Add feature matrix preflight for live candidates.
3. Repair or explicitly disable DXY/correlation-dependent logic until DXY is present.
4. Verify `features_spread` freshness for short-hold strategies.
5. Add live allowlist separate from broad research activity.
6. Add kill switch and conservative max-open-position guard.
7. Replace health/job freshness with actual candle/feature freshness checks.
8. Run paper/shadow only unless all preflight gates pass.

### Week 2

1. Build missed-setup scanner and persist results as `DecisionEvent` records.
2. Add live-parity PIT mode with analyzer verdict, live gates, shared costs, and feature freshness.
3. Add duplicate idea clustering and one-risk-budget-per-idea.
4. Refactor zone selection into lifecycle-aware, retest-aware scoring.
5. Add volatility gate diagnostics and symbol/session/regime thresholds.
6. Add DB readiness checks for duplicates, indexes, PKs, aggregates, and feature-vs-candle lag.
7. Extend rejection logging with analyzer score, gate details, feature state, and lifecycle state.

### Month 1

1. Implement full promotion workflow: research -> candidate -> shadow -> paper -> live -> retired.
2. Build research warehouse and strategy scoreboard.
3. Add tick-backed or conservative replay for short-hold XAUUSD candidates.
4. Add portfolio-first risk model with family budgets, symbol caps, currency-leg exposure, and correlated risk.
5. Add SMC/ICT upgrades: sweep-before-confirmation, SMT/DXY divergence, BPR/liquidity void context, and structural target quality.
6. Add XAUUSD-specific session/regime/short-edge modeling.

## Acceptance Checklist

- [x] Canonical master report exists at `reports/UNIFIED_LIVE_READINESS_AND_BACKTEST_PIPELINE_PLAN.md`.
- [x] Source reports remain as source/reference material.
- [x] Before/after table covers every major pipeline layer.
- [x] Consolidated matrix includes every major issue from both source reports.
- [x] Each suggestion is mapped to a pipeline layer.
- [x] Expected results and target metrics are included.
- [x] Target architecture is documented.
- [x] Monday, Week 2, and Month 1 priorities are separated.
- [x] Security recommendations are excluded except live-safety controls.

