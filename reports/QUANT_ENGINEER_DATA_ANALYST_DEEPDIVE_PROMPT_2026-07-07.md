# Quant Engineer and Data Analyst Deep-Dive Prompt

You are acting as a senior Quant Engineer and Data Analyst auditing the `tradzfx-v2` trading system.

Your task is to perform a deep technical, statistical, architectural, and trading-performance investigation of the entire codebase. The goal is to identify inaccuracies, loopholes, weak assumptions, algorithmic flaws, missing safeguards, architectural bottlenecks, and opportunities to improve the system into a more profitable, robust trading application.

## Project Context

This is a Next.js 15 / TypeScript monorepo trading app using:

- Strategy specs in `packages/strategies/src/specs/*.yaml`
- PIT backtesting scripts
- Historical feature backfills
- Strategy variants and families
- Generated setups/signals
- Backtest reports exposed through strategy detail APIs
- MT5 candle imports
- Database-backed candles, features, lifecycle state, strategy reports, and live variant promotion

Important commands and areas:

```bash
pnpm test
pnpm -r build
pnpm graphify

node scripts/seed-strategy-specs.js
node scripts/promote-top3-live.js
node scripts/backtest-pit-v2.js ALL 90 <variantId> --persist
node scripts/run-pit-historical.js 90 data/backtest-seed/historical-pit-90d
node scripts/run-pit-walkforward.js 30 15 data/backtest-seed/walkforward-30d-15d
node scripts/backfill-candles-from-mt5-csv.js <dir> --tz-offset-minutes=180 --broker=MT5
node scripts/backfill-historical-features.js [SYMBOL1,SYMBOL2,...] [tf1,tf2,...]
```

## Main Objective

Investigate whether the system can reliably generate profitable trade setups and signals end to end.

Do not only look for code bugs. Also look for:

- Bad statistical assumptions
- Data leakage
- Lookahead bias
- Survivorship bias
- Incorrect candle/session handling
- Timezone errors
- Overfit strategy specs
- Misleading backtest metrics
- Invalid trade labeling
- Weak risk/reward modeling
- Incorrect entry/exit simulation
- Poor feature engineering
- Missing market regime awareness
- Bad live-trading promotion logic
- Architecture that prevents safe iteration or scaling

## Areas To Investigate

### 1. Data Integrity

Audit the full data pipeline:

- MT5 CSV imports
- 1m candle storage
- Higher-timeframe candle aggregation
- Historical feature backfills
- PIT feature generation
- Timezone handling
- Broker timestamp assumptions
- Missing candle handling
- Duplicate candles
- Weekend/session filtering
- Spread assumptions
- Symbol normalization
- Decimal precision / pip conversion
- Bid/ask versus mid-price assumptions

Questions to answer:

- Are candles aligned correctly across `1m`, `5m`, `15m`, `1h`, `4h`, and `1d`?
- Is there any chance future candle data leaks into past feature rows?
- Are features computed only from information available at decision time?
- Are backtests using realistic execution prices?
- Are spread, slippage, commissions, and market gaps modeled correctly?

### 2. Strategy Specs

Review all YAML specs in:

```text
packages/strategies/src/specs/*.yaml
```

For every strategy variant, evaluate:

- Whether the logic is internally consistent
- Whether indicators/features are actually predictive
- Whether entry filters are too loose or too restrictive
- Whether exits are realistic
- Whether risk/reward assumptions are justified
- Whether variants are meaningfully different or just overfit clones
- Whether `familyId` and `id` relationships are correct
- Whether standalone specs correctly set `familyId` equal to `id`

Find:

- Duplicated strategy logic
- Contradictory rules
- Dead filters that never trigger
- Overly permissive signal generation
- Unrealistic TP/SL assumptions
- Missing invalidation rules
- Missing regime/context filters

### 3. Signal Generation

Trace the full path from market data to generated setup/signal/trade.

Document:

- Where a setup is detected
- Which features are used
- How confidence is calculated
- How entry, stop loss, and take profit are selected
- How signals are ranked or filtered
- How signals are persisted
- How they are displayed in the app
- How live variants are promoted
- Whether signal output matches strategy intent

Questions:

- Are generated setups actually tradable at the time they are produced?
- Are there too many low-quality signals?
- Are setups filtered by market regime, session, spread, volatility, and liquidity?
- Are conflicting signals handled correctly?
- Are duplicate or stale setups prevented?
- Is confidence calibrated against historical outcomes?

### 4. Backtesting Accuracy

Audit the PIT backtesting system.

Look specifically for:

- Lookahead bias
- Same-candle entry/exit ambiguity
- Incorrect candle ordering
- Incorrect use of high/low when both SL and TP are touched
- Unrealistic fills
- Missing spread/slippage
- Incomplete warmup handling
- Incorrect walk-forward validation
- Improper train/test separation
- Metrics that hide risk

Evaluate all reports in:

```text
data/backtest-seed/
reports/
```

Questions:

- Are win rate, expectancy, drawdown, profit factor, and Sharpe-like metrics calculated correctly?
- Are results robust across symbols and regimes?
- Do strategies survive walk-forward testing?
- Are top 3 promoted variants genuinely superior or just selected from noise?
- Is there multiple-comparison bias from testing many variants?

### 5. Architecture

Inspect the app architecture end to end.

Evaluate:

- Separation between data, strategy, backtest, and UI layers
- Type safety
- Database schema correctness
- Migration consistency
- Feature computation lifecycle
- Script reliability
- Error handling
- Test coverage
- Observability/logging
- Performance bottlenecks
- Caching behavior
- API correctness
- Whether live trading concerns are isolated from research/backtesting concerns

Find places where the architecture could cause:

- Stale signals
- Wrong strategy version used
- Incorrect variant promotion
- Race conditions
- Inconsistent data between backtest and live mode
- Silent failures
- Poor reproducibility

### 6. Algorithmic Improvements

Recommend concrete upgrades to make the app more profitable and robust.

Consider:

- Regime classification
- Session-aware filtering
- Volatility-adjusted stops
- Spread-aware execution filtering
- Adaptive position sizing
- Correlation-aware trade suppression
- News/event avoidance
- Liquidity filters
- HTF/LTF confluence scoring
- Probabilistic confidence calibration
- Trade outcome labeling improvements
- Bayesian or ensemble scoring
- Walk-forward optimization
- Robustness testing
- Monte Carlo simulations
- Parameter sensitivity analysis
- Feature importance analysis
- Strategy decay monitoring

### 7. Profitability Analysis

Analyze whether the system currently has a realistic path to profitability.

For each promising strategy/family, report:

- Best-performing symbols
- Worst-performing symbols
- Market regimes where it works
- Market regimes where it fails
- Average R multiple
- Median R multiple
- Win rate
- Profit factor
- Max drawdown
- Trade frequency
- Expectancy per trade
- Sensitivity to spread/slippage
- Whether performance survives walk-forward testing

Distinguish clearly between:

- Backtest profitability
- Walk-forward robustness
- Live-trading readiness

## Deliverables

Produce a detailed audit report with the following sections.

### Executive Summary

- Overall system health
- Biggest risks
- Biggest profitability blockers
- Highest-impact opportunities

### Critical Findings

For each issue include:

- Severity: Critical / High / Medium / Low
- Location: file path and line reference where possible
- Description
- Why it matters
- Evidence
- Recommended fix
- Expected impact

### Data and Backtest Integrity Findings

Focus on correctness of data, candle processing, PIT testing, feature generation, and result validity.

### Strategy and Signal Findings

Focus on generated setups, confidence scoring, entries, exits, TP/SL, invalidation, and signal ranking.

### Architecture Findings

Focus on code organization, maintainability, reliability, testability, and production-readiness.

### Profitability Improvement Roadmap

Prioritize improvements by expected ROI:

1. Immediate fixes
2. Short-term upgrades
3. Medium-term research
4. Long-term architecture improvements

### Suggested Experiments

Propose concrete experiments, including:

- Hypothesis
- Dataset required
- Method
- Success metric
- Failure condition
- Implementation location

### Recommended Code Changes

List specific code files/scripts/modules to change, with suggested implementation details.

### Questions For The Owner

List any assumptions or missing context that prevents final judgment.

## Investigation Rules

- Do not assume current results are valid until data leakage and backtest correctness are ruled out.
- Prefer evidence over intuition.
- Treat profitability claims skeptically.
- Confirm whether every feature used at signal time was actually available at that time.
- Compare backtest and live signal paths for consistency.
- Check both algorithmic logic and engineering implementation.
- Highlight any places where code behavior differs from intended trading behavior.
- If possible, run tests and builds:

```bash
pnpm test
pnpm -r build
```

- Use `pnpm`, never `npm` or `yarn`.

## Final Goal

The final output should help us answer:

1. Is this system currently generating valid trading signals?
2. Are the backtests trustworthy?
3. Which strategies, if any, show real edge?
4. What inaccuracies or loopholes are causing misleading results?
5. What should we fix first to move toward profitable live trading?
6. What architecture or algorithmic upgrades would create the biggest improvement?

## Recommended Reviewer Modes

Run this investigation twice if possible:

1. As a skeptical quant researcher focused on statistical validity, edge quality, overfitting, and backtest trustworthiness.
2. As a production trading systems engineer focused on architecture, reliability, live-signal correctness, operational risk, and deployment readiness.
