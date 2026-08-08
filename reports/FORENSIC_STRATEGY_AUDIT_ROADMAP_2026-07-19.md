# Forensic Strategy Audit — Completed Work, Current Evidence, and Roadmap

**Date:** 2026-07-19  
**Repository:** `tradzfx-v2`  
**Status:** Core market-data and execution trust defects repaired. Strategy inventory remains incomplete. Rankings remain provisional unless marked trusted.

## 1. Audit objective

Prove every reported strategy result through full chain:

1. Governed candles and market calendar.
2. PIT-correct feature production and joins.
3. Producer/lifecycle lineage.
4. Strategy compilation and setup evaluation.
5. Strategy-owned SL/TP geometry.
6. Spread, slippage, commission, timeout, and portfolio heat.
7. Trade export parity.
8. Strict deterministic rerun with no hidden stale-data override.
9. Meaningful sample size and out-of-sample validation.

Conventional PIT strategies and staged/ordered strategies must remain separate. `scripts/backtest-pit-v2.js` does not automatically execute staged evaluator in `packages/strategies/src/staged/`.

## 2. Completed forensic repairs

### 2.1 Waqar and setup-cache correctness

- Traced Waqar setup-cache contamination.
- Added risk-sensitive setup context identity.
- Added directional buy/sell SL/TP validation.
- Created source-faithful ebook Waqar variant.
- Prevented stale setup evaluations from silently crossing strategy/risk contexts.

### 2.2 Candle and PIT data correctness

- Repaired canonical HTF refresh/parity.
- Aligned strategy-visible candles with governed market calendar.
- Excluded normal weekend closure from gap/freshness calculations.
- Preserved two intentional daily contracts:
  - `candles_1d_utc`: canonical engine/feature daily.
  - `candles_1d_ny`: auxiliary NY-close export daily.
- Repaired XAUUSD Jul 6–7 outage data and documented ingest-resilience controls.

### 2.3 Spread correctness

- Standardized `candles_1m.spread` as pips.
- Replayed official DAG spread history.
- Corrected latest-20 selection/filter/average parity.
- Removed legacy scheduler-timestamp contamination.
- Verified spread replay and audit parity with zero mismatches.

### 2.4 Risk and execution correctness

- Fixed planned-risk R denominator in `scripts/backtest-pit-v2.js`.
- Fixed TP/SL inversion path.
- Restored strategy/compiler risk as executable authority.
- Setup engine may replace risk only with `setupEngine.overrideRisk: true`.
- Added fail-closed geometry checks after explicit setup mutation.
- Removed portfolio-heat-dropped trades from `--trades` export.
- Verified exported trade count equals executed population.
- Focused PIT regression suite last passed 65/65.

### 2.5 Feature producer truth

- Fixed false dense-producer `output_anchor_missing` errors in `apps/engine/src/dag/runner.ts`.
- Dense postflight now checks persisted feature truth when final batch buffer is empty.
- Added `resolveDensePostflightAnchor()` regressions.
- Engine suite passed 121/121; engine build passed.
- Replayed seven FX symbols at latest 5m edge:
  - `features_atr`
  - `features_pricing`
- Repaired 14/14 latest producer ledger states to `done`, invariant `ok`.

### 2.6 Producer freshness data clock

- Found `scripts/feature-capability.js` compared producer `finished_at` with wall clock.
- Weekend closure falsely marked healthy FX `features_zone@5m` producers stale.
- Capability now reads `source_max_ts` and compares producer coverage against governed candle edge.
- Wall-clock fallback remains for legacy rows without `source_max_ts`.
- Strict preflight changed seven FX symbols from blocked to `READY`.

### 2.7 Lifecycle validation

- Verified zone lifecycle cursors against latest tradable edge, not raw weekend `MAX(ts)`.
- Seven FX symbols lagged only 0.72–0.73 hours, below 2-hour blocker.
- Confirmed live/backtest `trustStoredLifecycle` asymmetry is intentional:
  - Live trusts current lifecycle state.
  - PIT backtest recomputes historical lifecycle to avoid future leakage.

### 2.8 Cross-asset volatility gate

- Proved `maxAtr5Pips: 2.5` was not comparable across assets.
- Exact period-5 audit showed London pass rates from 3.85% for GBPUSD to 42.03% for NZDUSD; XAUUSD passed 0%.
- Changed Forex ORB to:
  - `maxAtrPercentile: 0.95`
  - `atrTf: 5m`
  - `atrPeriod: 5`
- Seeded governed spec after structural validation. Existing unrelated capability gaps required `--skip-capability`.
- p95 profile policy now adapts by symbol and session through `market_volatility_profile`.

## 3. Current trusted and provisional strategy evidence

| Strategy | Trades | Win rate | Net R | Geometry | Current classification |
|---|---:|---:|---:|---|---|
| Doyle SD | 88 | 61.4% | +72.1877R | Exact 2.5R | Trusted in repaired 90-day run; needs OOS |
| A+ ORB/FVG | 1 | 0% | -1.1884R | Exact 2R | Insufficient sample |
| Watukushay | 177 | 79.1% | -3.3665R | Exact 1R | Trusted negative result; costs erase edge |
| Smart Risk OB/iFVG | 34 | — | +0.0046R | Exact 2R | Near break-even; sample weak |
| Forex ORB, all symbols | 251 | 43.8% | -114.84R | No geometry violations | Strict run complete; XAUUSD event freshness warning |

No result should be promoted from same-window performance alone. Walk-forward/out-of-sample evidence remains mandatory.

## 4. Strict Forex ORB result after repairs

Evidence: `reports/forensic-forex-strategy-orb-90d-strict-data-clock-repaired-2026-07-19.jsonl`

| Symbol | Trades | Wins | Losses | WR | Net R |
|---|---:|---:|---:|---:|---:|
| EURUSD | 21 | 11 | 10 | 52.4% | -1.04R |
| GBPUSD | 24 | 14 | 10 | 58.3% | +2.40R |
| AUDUSD | 30 | 8 | 22 | 26.7% | -36.47R |
| NZDUSD | 30 | 7 | 23 | 23.3% | -39.69R |
| USDCAD | 33 | 10 | 23 | 30.3% | -33.30R |
| USDCHF | 34 | 9 | 25 | 26.5% | -42.02R |
| USDJPY | 36 | 19 | 17 | 52.8% | -4.04R |
| XAUUSD | 43 | 32 | 11 | 74.4% | +39.32R |
| **Aggregate** | **251** | **110** | **141** | **43.8%** | **-114.84R** |

Interpretation:

- Aggregate cross-asset Forex ORB fails.
- XAUUSD and GBPUSD are positive in-sample.
- EURUSD is near break-even.
- AUDUSD, NZDUSD, USDCAD, and USDCHF drive failure.
- XAUUSD remains `DEGRADED`, not blocked, because sparse `features_zone_retest@5m` producer coverage trails data edge.
- p95 gate fixed eligibility comparability; it did not manufacture profitability.

## 5. Assessment of proposed volatility normalization

### Verdict

**Useful direction, but not safe as immediate ATR replacement.** Repository already implements much of practical benefit:

- ATR-relative stop expressions such as `atr(5m) * 1.2`.
- ATR-relative pattern fields in `apps/engine/src/features/candlePattern.ts`.
- Symbol pip normalization through shared pip registry.
- Symbol/session volatility percentiles through `market_volatility_profile`.
- ATR outlier handling through `effective_value` in `apps/engine/src/features/atr.ts`.
- Percentile regime gate in `packages/tradePipeline/src/gates/volatilityGate.ts`.

Proposal should become parallel research feature, not mutate `features_atr` in place.

### 5.1 Strong ideas to adopt

1. **Dimensionless feature magnitudes**
   - Persist displacement body/range, FVG width, zone width, sweep depth, and structural excursion divided by PIT volatility estimate.
   - Keep raw price/pip values for audit.
   - Compare cross-symbol distributions before using global constants.

2. **Relative/log scale for metals**
   - `(H-L)/C` or log-return variance avoids XAUUSD price-level drift.
   - Useful for volatility regime state and cross-asset diagnostics.

3. **Session-conditional normalization**
   - Current `market_volatility_profile` already provides symbol/session percentiles.
   - Extend toward hour/session seasonal factors only after proving PIT construction and sufficient samples.

4. **Volatility percentile as regime gate**
   - Already implemented and validated for Forex ORB.
   - Better than hardcoded cross-asset pip ceiling.

5. **Cross-symbol distribution tests**
   - Compare normalized feature distributions by symbol, timeframe, and session.
   - Use KS distance, PSI, quantile ratios, and tail rates.
   - Global threshold justified only if distributions align out of sample.

### 5.2 Claims requiring caution

1. **“Stop calibrating per pair entirely” is too strong.**
   - Volatility scaling removes unit/scale mismatch.
   - It does not remove microstructure, spread/risk ratio, session behavior, trend persistence, jump frequency, liquidity, or strategy-edge differences.
   - Current Forex ORB proves this: same p95 policy restored fair eligibility, yet symbol net R remained radically different.

2. **Yang–Zhang is not automatically best per intraday bar.**
   - Yang–Zhang was designed around open/close discontinuity plus intraperiod OHLC variance.
   - Applying it independently to 1m/5m bars can misinterpret ordinary adjacent-bar opens, produce unstable estimates, or double-count gaps.
   - FX/metals feed conventions, weekend closure, daily breaks, and cagg boundaries need explicit design.
   - Research candidate: session/day-level Yang–Zhang, not blind drop-in replacement for every bar.

3. **EWMA `λ=0.94` is not universal across timeframes.**
   - Decay has timeframe-specific half-life.
   - Same lambda on 1m and 4h means entirely different calendar memory.
   - Configure half-life in elapsed tradable time, then derive lambda per timeframe.

4. **Seasonal adjustment formula needs precise orientation.**
   - If `hourly_seasonal` is expected volatility multiplier, normalized surprise should be `observed / expected`.
   - Building `σ_adj = σ̂ / seasonal` and then dividing range by `σ_adj` can invert intended effect depending on definitions.
   - Define one contract: `expected_sigma(symbol, tf, session/hour, ts)`; normalized distance is `distance / expected_sigma`.

5. **Volatility normalization cannot replace cost normalization.**
   - Small FX stops suffer larger spread/slippage/commission in R units.
   - Need `cost / plannedRisk` diagnostics and minimum stop-to-cost ratio.

6. **Do not overwrite historical ATR semantics.**
   - Existing specs, cache hashes, reports, profiles, and risk formulas depend on current ATR.
   - New estimator requires new table/feature version, migration, registry contract, backfill, and A/B backtests.

## 6. Proposed volatility research design

### Phase V0 — Audit existing normalization

- Inventory all hardcoded pip/point thresholds in strategy YAML and feature code.
- Classify each as:
  - execution cost limit;
  - volatility regime limit;
  - geometric signal threshold;
  - broker/instrument safety bound.
- Keep cost and broker limits in real units where appropriate.

### Phase V1 — Add parallel volatility feature

Create new feature, tentatively `features_volatility_normalized`, without changing `features_atr`.

Suggested outputs:

- `estimator_version`
- `tf`
- `return_var_ewma`
- `range_var_ewma`
- `relative_sigma`
- `absolute_sigma`
- `seasonal_expected_sigma`
- `vol_ratio`
- `percentile_rank`
- `sample_count`
- quality fields and source anchor

Candidate estimators:

- Existing winsorized true range baseline.
- EWMA squared log returns.
- EWMA Parkinson range variance for continuous intraday windows.
- Session/day Yang–Zhang research branch.

### Phase V2 — PIT seasonal model

- Estimate symbol/timeframe/hour-or-session seasonal factors from trailing-only 60–90 tradable days.
- Never use future/full-sample averages in historical rows.
- Version profile and persist sample start/end/count.
- Minimum sample gate and robust median/trimmed estimator.
- Separate broker feed and symbol where feed behavior differs.

### Phase V3 — Shadow normalized SMC metrics

Add parallel columns/features, leaving detection decisions unchanged:

- `displacement_body_sigma`
- `displacement_range_sigma`
- `fvg_width_sigma`
- `zone_width_sigma`
- `sweep_depth_sigma`
- `structure_excursion_sigma`
- `planned_stop_sigma`
- `round_trip_cost_risk_ratio`

Backfill and compare raw vs normalized metrics.

### Phase V4 — Validation gate

For each symbol/timeframe/session and walk-forward fold:

- Coverage and freshness.
- PIT leakage tests.
- Quantile stability.
- KS/PSI cross-symbol similarity.
- Tail sensitivity around news bars.
- Weekend and XAUUSD daily-break behavior.
- Cost-to-risk distribution.
- Strategy performance under frozen global thresholds.

Acceptance requires normalized distributions materially closer across assets without degrading data quality or introducing future leakage.

### Phase V5 — Controlled strategy variants

- Create new YAML variants using normalized fields.
- Never rewrite canonical variants during research.
- Freeze constants before OOS run.
- Compare:
  - current ATR baseline;
  - EWMA log-return sigma;
  - EWMA range sigma;
  - seasonal-normalized versions.
- Rank by OOS net R, drawdown, stability, cost sensitivity, and sample size—not in-sample net R alone.

## 7. Immediate remaining work

### Priority 1 — Close XAUUSD sparse-event warning

- Inspect `features_zone_retest@5m` latest `source_max_ts`, producer mode, and data-edge lag.
- Confirm whether lag is legitimate no-event output or actual producer scheduling gap.
- Sparse producers should prove input coverage without requiring output at every candle.
- Mark XAUUSD `READY` only with truthful producer evidence.

### Priority 2 — Forex ORB trade-economics forensic

For every executed trade, calculate:

- planned stop distance in pips and price units;
- spread, slippage, and commission in R;
- gross R vs net R;
- timeout contribution;
- MAE/MFE if available;
- stop-to-round-trip-cost ratio;
- symbol/session/direction breakdown.

Goal: explain average losses down to approximately `-2R` despite nominal 2R target geometry.

### Priority 3 — Out-of-sample symbol hypotheses

Current 90-day evidence may generate hypotheses only:

- XAUUSD-only.
- GBPUSD-only.
- EURUSD/GBPUSD/USDJPY basket.
- Failing-symbol exclusion.

Freeze these hypotheses, then test untouched earlier/later windows or walk-forward folds. Do not optimize and validate on same 90 days.

### Priority 4 — Complete conventional strategy inventory

For every active conventional spec:

- strict deterministic preflight;
- coverage/capability verdict;
- exact risk geometry;
- executed/export parity;
- costs and gate counts;
- net R and drawdown;
- sample sufficiency;
- classification: `TRUSTED`, `DEGRADED`, `BLOCKED`, or `INSUFFICIENT_SAMPLE`.

### Priority 5 — Audit staged strategies separately

- Map staged evaluator entrypoint and state transitions.
- Verify PIT ordering and expiry.
- Add staged-specific deterministic tests.
- Produce separate staged performance table.
- Never compare staged results generated through a different execution contract without labeling them.

### Priority 6 — Seed/capability debt

- Normal all-spec seed remains blocked by unrelated active-spec capability gaps.
- Identify exact unavailable surfaces per active spec.
- Fix, deactivate, or explicitly classify those specs.
- Restore `pnpm db:seed:check` as clean governance gate.

## 8. Promotion criteria

Strategy may be considered for live promotion only when all conditions pass:

- Strict preflight `READY`.
- No lifecycle corruption.
- Producer source anchors cover governed data edge.
- PIT joins proven and no future-state leakage.
- Geometry violations zero.
- Executed count equals export count.
- Costs included and cost/risk ratio acceptable.
- Meaningful sample size.
- Frozen-parameter OOS or walk-forward profitability.
- Drawdown and symbol concentration acceptable.
- Live feature freshness and ingestion resilience green.
- `pnpm db:seed:check`, tests, and `pnpm -r build` pass.

## 9. Recommended next sequence

1. Close XAUUSD `features_zone_retest` producer warning.
2. Produce Forex ORB per-trade economics report.
3. Run frozen OOS/walk-forward symbol hypotheses.
4. Complete conventional strategy trust inventory.
5. Audit staged evaluator independently.
6. Build volatility-normalization shadow feature and research dataset.
7. Promote normalized rules only after cross-symbol distribution and OOS acceptance tests.

## 10. Bottom line

Volatility-normalization proposal is useful and aligns with repairs already made. Project already has ATR-relative geometry, winsorized ATR, pip math, and symbol/session percentile profiles. Best next step is not replacing ATR globally. Add versioned parallel volatility estimator, persist normalized SMC metrics, prove PIT and cross-symbol distribution stability, then create frozen experimental variants. Current strict Forex ORB evidence shows why: scale normalization fixes unfair gating, but does not make strategy edge universal across symbols.
