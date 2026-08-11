# Backtest Setup Deep Dive: What Is Missing And What Is Overdone

Date: 2026-07-04

Scope: saved backtest artifacts in `reports/`, curated PIT seed reports in `data/backtest-seed/`, and current PIT checks for `doyle_sd`, `orb_classic`, and `watukushay_no1` through 2026-07-03.

Security is intentionally excluded.

## Core Conclusion

The system is not lacking strategy ideas. It is lacking a clean research-to-live pipeline that can prove whether a good setup was missed, over-filtered, duplicated, or degraded by stale features.

The biggest architectural issue is still separation of responsibilities:

- The main analyzer should discover, score, tag, and explain setups.
- Strategy specs should decide whether a setup belongs to a tradable playbook.
- Live risk gates should decide whether a valid playbook signal can be executed.
- Backtests should prove the same path live trading will use.

Right now, the system has useful edge candidates, but it also has too many places where a valid opportunity can disappear without a clear reason.

## Data Reviewed

## Saved XAUUSD Strategy Artifacts

Key saved JSON reports:

- `keylevel_v1_4r_trades_120d.json`
- `keylevel_v4_trades_120d.json`
- `keylevel_v5_longs.json`
- `keylevel_v5_shorts.json`
- `keylevel_v6_ny_overlap_shorts.json`
- `keylevel_v7_shorts_time.json`
- `keylevel_v8_levels.json`
- `keylevel_v8b_zone_tp.json`
- `keylevel_v8c_min3.json`
- `smart_risk_ob_ifvg_1m_90d_trades.json`
- `smart_risk_ob_ifvg_1m_90d_after_fixes_trades.json`
- `smart_risk_ob_ifvg_1m_runon_90d_trades.json`
- `smart_risk_ob_ifvg_1m_runon_15r_90d_trades.json`
- `smart_risk_ob_ifvg_1m_runon_15r_final_90d_trades.json`

## Curated PIT Seed Reports

- `data/backtest-seed/historical-pit-90d/summary.md`
- `data/backtest-seed/historical-pit-90d/summary.csv`
- `data/backtest-seed/walkforward-30d-15d/summary.md`
- `data/backtest-seed/portfolio-overlap-90d/summary.md`

## Current PIT Checks

Current 30-day checks ending 2026-07-03:

- `doyle_sd`
- `orb_classic`
- `watukushay_no1`

These were important because they no longer match the strong mid-June seed reports.

## What The Backtests Say

## 1. XAUUSD Key-Level Bounce Has Real Signal, But It Is Narrow

Best saved key-level examples:

| Variant | Window | Executed | WR | Net R | Notes |
|---|---:|---:|---:|---:|---|
| `keylevel_bounce_v1_4r` | 120d | 111 | 44.1% | +134.00R | Profitable mostly from 4R wins despite low WR |
| `keylevel_bounce_v5_shorts` | 120d | 72 | 50.0% | +108.00R | Shorts materially outperform longs |
| `keylevel_bounce_v7_shorts_time` | 120d | 27 | 66.7% | +63.00R | Better selectivity, lower sample size |
| `keylevel_bounce_v8_levels` | 120d | 27 | 74.1% | +33.08R | Higher WR, lower average win |
| `keylevel_bounce_v8c_min3` | 120d | 27 | 66.7% | +50.08R | Good compromise between fixed R and level TP |

Interpretation:

- The edge is mostly short-side XAUUSD.
- The edge improves when time/session filtering is added.
- The level-based TP variants improve win rate but give away R.
- Fixed 4R is powerful but more brittle and more dependent on fill/intrabar assumptions.

What this system is missing:

- A proper reason-tagged short bias model for XAUUSD.
- A market-regime detector that explains why shorts work better in these windows.
- A rule that prevents the long side from diluting the edge.
- A live-parity test with spread/slippage and conservative intrabar assumptions.

What is overdone:

- Session filtering is carrying too much of the edge. In some keylevel variants, most raw signals are skipped by session.
- The system has many near-duplicate keylevel variants instead of one clean family with controlled parameters.
- Some results depend on 1-bar exits, which can be too optimistic without stricter execution modeling.

## 2. Smart Risk OB/IFVG Has The Best XAUUSD Setup Candidate

Saved smart-risk results:

| Variant | Executed | WR | Net R | Avg Hold | Main Observation |
|---|---:|---:|---:|---:|---|
| `smart_risk_ob_ifvg_1m` original | 115 | 48.9% | +52.89R | 36.7 bars | Positive, but many timeouts and portfolio heat skips |
| `smart_risk_ob_ifvg_1m_3r` | 116 | 36.7% | +55.47R | 53.5 bars | More R, worse WR, longer pain |
| `smart_risk_ob_ifvg_1m_runon` | 199 | 75.3% | +102.02R | 30.4 bars | Strongest broad result, nearest-profit-pivot target |
| `smart_risk_ob_ifvg_1m_runon_15r` | 172 | 68.7% | +120.80R | 37.8 bars | Highest saved net R, but more exposure |
| `smart_risk_ob_ifvg_1m_runon_15r_final` | 97 | 71.1% | +75.58R | 5.4 bars | Cleaner, faster, daily-loss gated |

Interpretation:

- The best behavior appears when TP is structural, not a fixed multiple.
- Nearest-profit-pivot targeting improves win rate substantially.
- The final variant is cleaner because it cuts timeouts and uses daily-loss gating.
- There is still clustering: many signals fire within the same minute or same local burst.

What this system is missing:

- A duplicate/setup-cluster model. Multiple trades often represent the same idea, not independent opportunities.
- A "one idea, one risk budget" rule.
- A structural target quality model. The nearest pivot is useful, but the system should score whether that pivot is meaningful liquidity or just a nearby minor wick.
- A stronger distinction between continuation IFVG, reversal IFVG, and mitigation return.

What is overdone:

- Repeated entries are overdone. Some saved runs show many same-minute or same-burst trades.
- Portfolio heat and daily-loss gates are doing cleanup after signal generation instead of the strategy preventing duplicate idea risk earlier.
- Very short hold times are over-represented. A strategy that wins in 1-2 bars may still be valid, but it requires realistic spread/slippage/fill tests.

## 3. Curated Seed Reports Look Strong, But Current 30-Day Runs Do Not

The curated 90-day PIT seed report from 2026-06-15 showed:

| Spec | Raw | Executed | WR | Net R |
|---|---:|---:|---:|---:|
| `doyle_sd` | 2175 | 541 | 53.8% | +457.30R |
| `orb_classic` | 757 | 416 | 66.7% | +412.55R |
| `watukushay_no1` | 1715 | 949 | 69.2% | +337.84R |

The walk-forward seed report also looked stable across five windows:

| Spec | Windows | Executed | WR | Total Net R |
|---|---:|---:|---:|---:|
| `doyle_sd` | 5 | 850 | 55.0% | +748.29R |
| `orb_classic` | 5 | 671 | 66.9% | +669.72R |
| `watukushay_no1` | 5 | 1489 | 70.2% | +559.09R |

But the current 30-day PIT checks ending 2026-07-03 showed:

| Spec | Current Result |
|---|---|
| `doyle_sd` | 2 raw XAUUSD signals, 1 executed, 0 wins, -1.11R; no signals on FX |
| `orb_classic` | 7 raw signals, 0 executed, all skipped by volatility |
| `watukushay_no1` | 56 raw signals, 0 executed, all skipped by volatility |

Interpretation:

This is a major mismatch. The most likely causes are:

- Feature coverage changed or is incomplete after the seed data period.
- Some required feature timeframes are missing or stale.
- Volatility gates are now too restrictive for the current data.
- The current backtest window includes regime/data changes not covered by the curated report.
- Strategy specs may depend on feature rows that are no longer being generated consistently.

What this system is missing:

- A backtest reproducibility manifest: data range, feature freshness, feature generation version, spec hash, migration version, and runner version.
- A "seed report vs current report diff" tool.
- A feature availability preflight before any backtest result is trusted.

What is overdone:

- Trusting old aggregate performance without proving the current feature state still supports the same strategy.
- Relying on gates to silently skip everything instead of diagnosing why the signal layer collapsed.

## 4. Session, Rate-Limit, Portfolio-Heat, Daily-Win, And Volatility Gates Are Doing Too Much

Gate patterns from curated PIT:

- `doyle_sd`: 2175 raw, 541 executed, 1634 skipped.
  - Dominant skips: rateLimit and portfolioHeat.
- `orb_classic`: 757 raw, 416 executed, 341 skipped.
  - Dominant skips: dailyWin, rateLimit, dailyLoss.
- `watukushay_no1`: 1715 raw, 949 executed, 766 skipped.
  - Dominant skips: session and rateLimit.

Current July checks:

- `orb_classic`: all raw signals skipped by volatility.
- `watukushay_no1`: all raw signals skipped by volatility.

Interpretation:

The system is over-gated. Gates are necessary, but too many gates are being used as blunt cleanup tools after broad signal generation.

Missing:

- Signal quality should reduce bad setups before they reach risk gates.
- Gates need per-symbol, per-session calibration.
- Gate reasons need to be analyzed as strategy metrics, not just rejection metadata.

Overdone:

- `rateLimit` is overused as a duplicate-control replacement.
- `portfolioHeat` is overused as an idea-clustering replacement.
- `dailyWin` can stop a strategy that is behaving well, which makes backtest metrics hard to interpret.
- `volatility` is currently capable of blocking an entire strategy family.
- `session` gates are sometimes hiding weak underlying logic.

## 5. The System Is Strongest On XAUUSD, Not Broad Forex Yet

Evidence:

- Most saved high-quality JSON reports are XAUUSD.
- Keylevel edge is XAUUSD short-biased.
- Smart-risk OB/IFVG edge is XAUUSD.
- Waqar V2 90-day report showed no EURUSD, GBPUSD, USDJPY, or XAUUSD signals for the 1H/15m/1m version, but did produce AUDUSD, NZDUSD, USDCAD, USDCHF.
- Current July checks show no meaningful live-ready FX output for the top three candidates.

Missing:

- Pair-specific playbooks.
- Pair-specific volatility thresholds.
- Pair-specific session models.
- Pair-specific spread/slippage assumptions.
- Currency-leg correlation controls.

Overdone:

- Running one strategy family across all pairs as if every pair expresses the same edge.
- Treating XAUUSD and FX majors with the same volatility logic.

## 6. The System Is Missing A "Missed Great Setup" Dataset

Current reports mostly answer:

"What happened when the strategy fired?"

They do not answer:

"What great setups happened that the system missed?"

This is the most important missing research tool.

Build a missed-setup scanner:

1. Find large post-event moves, e.g. +1.5R, +2R, +3R potential from a local setup area.
2. Reconstruct features at the decision timestamp.
3. Check whether analyzer scored the setup.
4. Check whether any strategy spec fired.
5. Check whether gates rejected it.
6. Classify why it was missed.

Miss categories:

- missing feature
- stale feature
- no zone selected
- zone marked tapped/mitigated
- analyzer hard block
- session gate
- volatility gate
- spread gate
- bias conflict
- no structural target
- no entry model
- duplicate/rate-limit block

Expected benefit:

This tells whether the analyzer is skipping great setups or the strategy specs are too narrow.

## 7. The Backtests Are Too Optimistic In Some Places

The saved results reveal several optimism risks:

- Many XAUUSD winners close within 1 bar.
- Keylevel variants often have `avgHoldBars` around 1.0-1.4.
- Some smart-risk variants show many clustered/same-minute trades.
- Limit/touch fills need conservative modeling.
- Spread/slippage realism matters heavily when holds are 1-2 bars.
- Some historical reports were generated before current feature inconsistencies appeared.

Missing:

- Conservative intrabar mode by default.
- Spread/slippage sensitivity report.
- Same-minute duplicate collapse.
- Trade idea clustering.
- Commission/swap model where relevant.
- Feature/version manifest.

Overdone:

- Counting clustered entries as independent statistical evidence.
- Treating 1-bar XAUUSD wins as equally reliable as slower structural trades.
- Optimizing TP variants without enough live-parity validation.

## 8. The Strategy Library Has Too Many Variants And Not Enough Promotion Discipline

The saved report list shows many variants:

- keylevel v1, v4, v5 longs, v5 shorts, v6, v7, v8, v8b, v8c
- smart-risk baseline, 3R, runon, runon 15R, age-limited, notight, final

This is useful research history, but dangerous as a live operating model.

Missing:

- A formal strategy promotion table.
- One canonical candidate per family.
- A variant retirement process.
- A spec hash attached to every backtest.
- Automatic comparison across variants.

Overdone:

- Variant proliferation.
- Manual interpretation of JSON files.
- Multiple variants testing the same idea without a central ranking framework.

## 9. Feature Completeness Is A Trading Logic Problem, Not Just A Data Problem

Current feature state matters because strategies silently depend on features existing at the right timestamp and timeframe.

Known current problems from DB checks:

- DXY missing.
- XAUUSD feature coverage is incomplete across lower timeframes.
- `features_spread` is sparse/stale.
- Some feature tables are stale relative to latest candles.
- Current `orb_classic` and `watukushay_no1` are blocked by volatility.

Missing:

- Per-strategy feature matrix.
- Mandatory feature freshness check before backtest.
- Mandatory feature freshness check before promotion.
- Alerts when a strategy references a feature/timeframe pair with no rows.

Overdone:

- Assuming "candles exist" means "strategy context exists."
- Backtesting without first validating feature coverage.

## 10. Analyzer Logic Is Too Absolute For SMC Retest Models

The system has generic hard blocks around tapped zones and nearby zones. That is conservative, but SMC/ICT models often trade:

- retests
- mitigations
- IFVG returns
- breaker-style returns
- liquidity raid returns
- lower-timeframe continuation after HTF draw

Missing:

- Retest-aware scoring.
- Mitigation-aware playbook tagging.
- IFVG continuation vs reversal classification.
- Liquidity sweep before CHoCH/MSS sequencing.
- SMT/DXY divergence context.
- Balanced price range / liquidity void context.

Overdone:

- First-touch/freshness bias.
- Generic blocks that should be strategy-specific filters.
- Treating tapped zones as invalid instead of lower-quality or different setup type.

## What We Are Lacking

## Architectural Gaps

1. Analyzer/spec separation is incomplete.
2. Live path and backtest path are not fully identical.
3. Backtest artifacts lack reproducibility metadata.
4. No missed-great-setup analyzer exists.
5. No strategy promotion contract exists.
6. No one-risk-budget-per-idea model exists.
7. Health checks do not fully prove feature readiness.
8. Feature generation, lifecycle refresh, and strategy evaluation need stricter sequencing.

## Algorithmic Gaps

1. Sweep/inducement sequencing needs ICT correction.
2. Tapped/mitigated zones need scoring, not blanket rejection.
3. Structural targets need quality scoring.
4. Pair/session-specific volatility gates are missing.
5. XAUUSD short-bias context needs explicit modeling.
6. DXY/correlation/SMT context is missing or degraded.
7. Regime detection is too thin.
8. Duplicate idea clustering is missing.
9. Conservative fill/intrabar modeling is not mandatory.

## Data/DB Gaps

1. Feature availability is inconsistent.
2. DXY is missing.
3. Spread features are sparse/stale.
4. Some feature rows are missing for strategy-required timeframes.
5. No feature matrix blocks invalid backtests.
6. Historical reports do not prove current DB state is still valid.

## Research Gaps

1. Too much focus on trades taken, not opportunities missed.
2. Too little comparison between analyzer verdicts and strategy signals.
3. Too little out-of-sample/current-window validation.
4. Too little pair-specific analysis.
5. Too little rejection/gate breakdown as a performance metric.

## What Is Overdone

1. Too many active/research variants.
2. Too many broad gates doing cleanup after loose signal generation.
3. Too much session filtering without proving the underlying edge.
4. Too much reliance on rate limits and portfolio heat to solve duplicate ideas.
5. Too much trust in old aggregate reports.
6. Too many one-bar XAUUSD exits counted as robust without extra execution tests.
7. Too much generic analyzer blocking where strategy-specific scoring is needed.
8. Too much all-pairs strategy reuse without pair-specific calibration.

## Best Candidates To Keep Researching

## Candidate 1: `smart_risk_ob_ifvg_1m_runon_15r_final`

Why:

- 97 executed trades.
- 71.1% win rate.
- +75.58R.
- 5.4 average hold bars.
- No timeouts in the saved final run.

Concerns:

- Same-minute clustering exists.
- XAUUSD 1-bar/short-hold execution realism must be tested.
- Current feature state may no longer reproduce it.

Needed next:

- Re-run current 90-day after feature repair.
- Collapse duplicate ideas.
- Run conservative intrabar and spread sensitivity.
- Compare analyzer verdict vs strategy signals.

## Candidate 2: `keylevel_bounce_v8c_min3`

Why:

- 27 executed trades.
- 66.7% win rate.
- +50.08R.
- Good compromise between level target and fixed-R target.

Concerns:

- Small sample size.
- Short-only XAUUSD.
- 1-bar exits dominate.

Needed next:

- Re-run with strict execution modeling.
- Test across recent July data after feature repair.
- Add regime tags explaining why shorts work.

## Candidate 3: Curated `orb_classic` And `watukushay_no1`

Why:

- Strong curated 90-day and walk-forward results.

Concerns:

- Current 30-day checks execute zero trades due to volatility gate.
- Feature coverage warnings exist.
- Current behavior does not match seed reports.

Needed next:

- Diagnose volatility gate thresholds.
- Add feature matrix before trusting current backtests.
- Re-run after feature repair.

## Recommended Build Plan

## Phase 1: Trust The Data

Build:

- feature matrix checker
- DXY health repair
- spread freshness checker
- backtest reproducibility manifest
- current-vs-seed report diff

Outcome:

No backtest is trusted unless the feature context is complete.

## Phase 2: Trust The Setups

Build:

- missed-great-setup scanner
- analyzer-vs-strategy comparison report
- setup clustering / one-risk-budget-per-idea
- lifecycle-aware zone selector
- retest-aware scoring

Outcome:

You will know whether the app is missing great setups or correctly skipping bad ones.

## Phase 3: Trust The Execution

Build:

- conservative intrabar mode
- spread/slippage sensitivity
- duplicate-entry collapse
- live-parity backtest mode
- per-symbol volatility thresholds

Outcome:

Backtest edge becomes closer to live edge.

## Phase 4: Trust The Strategy Library

Build:

- promotion contract
- strategy scoreboard
- variant retirement
- live allowlist separate from research active status
- strategy family risk budgets

Outcome:

Only proven, current, reproducible variants reach live mode.

## Direct Answer

What the system is lacking:

- A missed-setup audit.
- Feature completeness guarantees.
- Analyzer/spec/live parity.
- Pair-specific calibration.
- Duplicate idea clustering.
- Retest/mitigation-aware SMC logic.
- Conservative execution validation.
- Strategy promotion discipline.

What is overdone:

- Variant proliferation.
- Broad gates blocking after the fact.
- Session/rate-limit/portfolio-heat dependence.
- Old aggregate report confidence.
- Generic analyzer hard blocks.
- Treating all pairs like the same market.
- Counting clustered 1-bar wins as full independent proof.

The most useful next move is not to add another strategy. It is to build the missed-setup and live-parity analysis layer, then re-run the strongest XAUUSD candidates after feature repair.

## Competitor-Informed Best-Practice Upgrade Map

This section converts patterns from mature trading platforms into upgrades for the current system.

Research references:

- QuantConnect LEAN separates trading systems into Universe Selection, Alpha Creation, Portfolio Construction, Execution, and Risk Management.
- Freqtrade separates strategy work into backtesting, hyperopt, dry-run, live, and FreqAI modes, and recommends dry mode before risking capital.
- Backtrader makes broker simulation, slippage, analyzers, and observers first-class primitives.
- MetaTrader 5 Strategy Tester supports real-tick testing and forward testing to reduce optimization bias.

## 1. Analyzer/Strategy Separation

| Problem Area | Before | What Competitors Do | Best Solution For This App | After |
|---|---|---|---|---|
| Analyzer role | Analyzer can behave like a generic gatekeeper. | QuantConnect treats alpha/signal generation separately from portfolio/risk/execution. | Make analyzer a market-intelligence layer only. It outputs score, confidence, tags, warnings, and hard-invalid reasons. | Strategy specs decide playbook validity; analyzer enriches and warns. |
| Good setup detection | Analyzer may skip retests/mitigations due to hard rules. | Mature platforms separate signal features from strategy-specific interpretation. | Replace broad `BLOCK` logic with `hardInvalid` vs `qualityPenalty`. | Retest, mitigation, IFVG return, and liquidity-return setups can be tagged instead of erased. |
| Strategy specs | Specs can be overridden by generic analyzer rejection. | Strategy modules own their own entry/exit playbook. | Add a contract: spec-valid signal is blocked only by data invalidity, risk invalidity, stale features, or impossible execution. | Fewer false negatives and clearer rejection reasons. |

## 2. Backtest-To-Live Parity

| Problem Area | Before | What Competitors Do | Best Solution For This App | After |
|---|---|---|---|---|
| Backtest modes | Analyzer backtest and PIT strategy backtest answer different questions. | Freqtrade has explicit backtest/dry/live modes; QuantConnect uses the same algorithm framework for backtest/live. | Create `--live-parity` mode that runs strategy spec, analyzer verdict, live gates, shared cost model, and portfolio rules. | Backtest output predicts live behavior instead of only theoretical strategy behavior. |
| Current-vs-seed mismatch | Older seed reports look strong, current PIT checks are weak. | Professional research logs run manifests and versions. | Every result stores spec hash, feature version, migration version, data range, feature matrix, and runner version. | You can explain why July differs from June. |
| Execution costs | Some analyzer results are optimistic; many XAUUSD wins are 1-bar. | Backtrader exposes slippage; MT5 emphasizes tick modeling. | Use one shared cost/fill model across analyzer, PIT, dry-run, and live. | Short-hold strategies are stress-tested before live. |

## 3. Missed-Setup Research Layer

| Problem Area | Before | What Competitors Do | Best Solution For This App | After |
|---|---|---|---|---|
| Research question | Mostly analyzes trades taken. | Strong research systems evaluate false positives and false negatives. | Build a missed-setup scanner that finds large favorable moves and reconstructs why no trade fired. | You know whether the system missed a great setup or correctly skipped noise. |
| Setup labels | Trade reports lack opportunity-cost classification. | Alpha research labels signal quality versus future return. | Persist missed setup events with reason categories: feature gap, stale data, analyzer block, spec too strict, gate skip, no entry model. | Strategy improvement becomes evidence-driven. |
| Analyzer calibration | Analyzer quality score is not proven against future R. | Quant platforms measure alpha signal decay and forward return. | For every analyzer score bucket, calculate future max favorable excursion, max adverse excursion, and realized strategy outcome. | Analyzer becomes measurable intelligence, not just a heuristic grader. |

## 4. Feature Store And Data Contract

| Problem Area | Before | What Competitors Do | Best Solution For This App | After |
|---|---|---|---|---|
| Feature availability | Strategies can silently get zero signals when features are missing. | Production quant systems treat data quality as a hard prerequisite. | Add per-strategy feature matrix: symbol, timeframe, table, row count, latest timestamp, freshness, required/optional. | Backtests fail loudly when required context is missing. |
| DXY/correlation | DXY is missing, weakening correlation/SMT context. | Multi-asset platforms explicitly model reference assets. | Make DXY/correlation dependencies explicit in spec requirements. | Correlation-dependent strategies cannot run with missing reference data. |
| Spread | `features_spread` is sparse/stale. | Broker simulators model costs as part of execution. | Store spread per symbol/timeframe and require freshness for short-hold strategies. | XAUUSD 1-bar scalps are tested against realistic costs. |
| Lifecycle | Zone/OB/IFVG state can drift. | Stateful features are replayable and deterministic. | One deterministic lifecycle refresh path for backfill and live. | Live and backtest select the same valid zones. |

## 5. Strategy Promotion And Variant Control

| Problem Area | Before | What Competitors Do | Best Solution For This App | After |
|---|---|---|---|---|
| Variant sprawl | Many near-duplicate strategy variants exist. | Freqtrade separates research/hyperopt from live mode. | Add strategy states: `research`, `candidate`, `shadow`, `paper`, `live`, `retired`. | Many variants can exist, but only promoted candidates can trade. |
| Activation | `is_active` can mean too much. | Mature systems require explicit deployment stage. | Add a live allowlist and later `is_live_enabled`. | Research activation no longer equals live risk. |
| Promotion | Strong report can be treated as deployment proof. | MT5 forward testing validates after optimization. | Require PIT, conservative intrabar, walk-forward, current-window replay, shadow, and paper before live. | No stale/overfit variant goes live accidentally. |
| Scoreboard | Manual report reading. | Platforms provide performance reports and metrics. | Build a variant scoreboard with net R, drawdown, skip reasons, duplicate rate, current reproducibility, feature health, and live parity. | Best candidate is obvious and auditable. |

## 6. Gate And Risk Redesign

| Problem Area | Before | What Competitors Do | Best Solution For This App | After |
|---|---|---|---|---|
| Gates | Session/rate-limit/portfolio-heat/daily-win/volatility do a lot of cleanup. | Portfolio/risk models handle exposure after alpha quality is measured. | Split alpha quality from risk filtering. Report both separately. | You know if edge is weak or risk gate is too strict. |
| Rate limit | Used partly as duplicate suppression. | Portfolio construction merges targets before execution. | Add setup clustering: same symbol, direction, zone/OB/IFVG, strategy family, and time window. | One idea receives one risk budget. |
| Volatility | Current July checks block all ORB/Watukushay raw signals. | Risk/protection parameters are strategy-specific and tunable. | Make volatility thresholds symbol/session/regime-specific. | Volatility gate stops bad regimes without killing the strategy. |
| Daily win | Can hide strategy quality by stopping winners early. | Risk filters should be measured apart from alpha. | Report raw strategy performance and risk-filtered performance side by side. | Better understanding of whether daily-win is helping or distorting. |

## 7. Execution Realism

| Problem Area | Before | What Competitors Do | Best Solution For This App | After |
|---|---|---|---|---|
| One-bar winners | Many XAUUSD candidates win in 1-2 bars. | MT5 supports real-tick testing; Backtrader models slippage. | Tick-backed replay for short-hold strategies; conservative `sl_first` mode required. | Fast scalps only survive if execution is realistic. |
| Fill assumptions | Touch fills may be optimistic. | Broker simulators distinguish market, limit, stop, slippage. | Add fill modes: optimistic, mid, conservative, real-tick. | Strategy score includes execution sensitivity. |
| Costs | Analyzer/PIT cost models differ. | Mature engines centralize broker simulation. | Shared `ExecutionCostModel` package used everywhere. | No more analyzer-vs-PIT R mismatch. |
| Dry-run | Exists but not a full validation stage. | Freqtrade recommends dry mode before live. | Paper/shadow run must produce live-equivalent decision logs before live promotion. | Monday live starts from verified forward behavior. |

## 8. SMC/ICT Algorithmic Upgrades

| Problem Area | Before | Best SMC/ICT Interpretation | Best Solution For This App | After |
|---|---|---|---|---|
| Sweeps | Sweep logic can require structure confirmation before the sweep. | Classic reversal flow is inducement/sweep -> displacement/CHoCH/MSS -> return entry. | Add sweep-before-confirmation model and tag post-sweep confirmation separately. | More canonical ICT reversal setups are found. |
| Tapped zones | Tapped zones can be blocked too broadly. | Retests/mitigations can be valid setup types. | Score tapped/mitigated zones by age, reaction, displacement, and HTF draw. | Fewer good retest setups missed. |
| Structural targets | Nearest pivot works but may be minor noise. | Liquidity targets should represent meaningful pools. | Score target quality by pivot degree, equal highs/lows, session high/low, HTF level, and distance. | TP quality improves and small noisy targets are avoided. |
| XAUUSD short edge | Backtests show strong short-side behavior. | Gold often has session/liquidity asymmetry. | Add explicit XAUUSD session-bias and liquidity-regime tags. | Short edge becomes explainable rather than accidental. |
| SMT/DXY | Missing/degraded. | ICT often uses correlated divergence and dollar context. | Add DXY and correlated-pair divergence features as optional/required spec dependencies. | Better filtering around dollar-driven moves. |

## 9. Best Possible End-State For This App

| Layer | Before | After |
|---|---|---|
| Data | Candles/features exist, but freshness gaps can hide. | Feature store with hard contracts, freshness matrix, DXY/spread health, and replay manifests. |
| Analyzer | Generic grader with possible hard blocks. | Market intelligence engine: setup discovery, tags, score, warnings, false-negative analysis. |
| Strategy | Many variants and YAML specs. | Playbook engine with schema validation, spec hashes, promotion state, and live allowlist. |
| Backtest | Multiple useful but separate reports. | Unified live-parity simulator with analyzers, observers, and reproducibility manifest. |
| Research | JSON files and manual interpretation. | Research warehouse: taken trades, rejected trades, missed setups, gate breakdown, analyzer/spec disagreement. |
| Risk | Multiple broad gates. | Portfolio-first model with one-risk-budget-per-idea, exposure caps, family budgets, and correlated risk. |
| Execution | EA order routing with live gates. | Kill switch, shadow/paper stage, tick/slippage stress test, execution-quality reports. |

## Expected Results After These Upgrades

| Metric | Before | After |
|---|---|---|
| Ability to explain missed winners | Mostly manual, incomplete | Automated missed-setup report with reason categories |
| Current-vs-seed mismatch | Hard to explain | Reproducibility manifest identifies feature/spec/data/version drift |
| Analyzer false blocks | Unknown | Measured and reduced to hard-invalid only |
| Duplicate XAUUSD entries | Present in saved reports | Clustered into one idea and one risk budget |
| Volatility gate behavior | Can block 100% of raw signals | Symbol/session/regime thresholds with diagnostics |
| Strategy promotion | Report-driven and manual | Mechanical candidate -> shadow -> paper -> live pipeline |
| Backtest realism | Good PIT base, but some optimistic assumptions | Conservative/tick-backed live-parity validation |
| Research value | Trades taken dominate | Trades taken + rejected + missed opportunities all analyzed |

