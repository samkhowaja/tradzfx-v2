# Forex ORB Economics and Frozen OOS Plan — 2026-07-19

## Evidence contract

- Strategy: `forex_strategy_orb`
- Window: 2026-04-20 through 2026-07-19
- Mode: deterministic
- Setup profile: strict
- Intrabar policy: close
- Capability verdict: READY for all eight symbols
- Trades: 251
- Trade-level evidence: `reports/forex-orb-trade-economics-2026-07-19.csv`

## Portfolio economics

| Metric | Result |
|---|---:|
| Trades | 251 |
| Win rate | 43.8% |
| Planned reward/risk | 2.000R |
| Planned gross R before execution costs | +79.00R |
| Net R after spread, slippage, commission | -114.84R |
| Total execution-cost drag | 193.84R |
| Average round-trip cost/risk | 0.784R |
| Median round-trip cost/risk | 0.701R |
| Average net losing trade | -1.884R |

`Gross R` assigns each TP `+2R` and each SL `-1R` from planned geometry. `Net R` uses effective entry and cost-adjusted exit while retaining planned directional risk as denominator. No timeout trades occurred.

## Symbol economics

| Symbol | Trades | Win rate | Avg cost/R | Median cost/R | Gross R | Cost drag | Net R |
|---|---:|---:|---:|---:|---:|---:|---:|
| XAUUSD | 43 | 74.4% | 0.318 | 0.319 | +53 | 13.68 | +39.32 |
| GBPUSD | 24 | 58.3% | 0.650 | 0.508 | +18 | 15.60 | +2.40 |
| EURUSD | 21 | 52.4% | 0.621 | 0.586 | +12 | 13.04 | -1.04 |
| USDJPY | 36 | 52.8% | 0.696 | 0.645 | +21 | 25.04 | -4.04 |
| USDCAD | 33 | 30.3% | 0.918 | 0.876 | -3 | 30.30 | -33.30 |
| AUDUSD | 30 | 26.7% | 1.016 | 0.881 | -6 | 30.47 | -36.47 |
| NZDUSD | 30 | 23.3% | 1.123 | 0.966 | -9 | 30.69 | -39.69 |
| USDCHF | 34 | 26.5% | 1.030 | 1.011 | -7 | 35.02 | -42.02 |

## Finding

Loss near `-2R` is expected under current cost model, not TP/SL inversion. Stop loss contributes planned `-1R`; adverse entry and exit costs add about `0.9R` on average for losing trades. Tight ATR stops make spread, slippage, and commission large relative to planned risk.

Current portfolio fails economics despite positive pre-cost expectancy. Main defects:

1. Cost-to-risk ratio too high for six symbols.
2. Weak raw signal edge on AUDUSD, NZDUSD, USDCAD, and USDCHF.
3. Same nominal rules behave differently across instruments.
4. No timeout contribution; losses come from decisive stop/target outcomes.

## Frozen OOS hypotheses

Frozen before any disjoint-window or walk-forward run:

| ID | Universe | Hypothesis | Current-window status | Promotion requirement |
|---|---|---|---|---|
| H1 | XAUUSD only | XAUUSD retains positive net expectancy because high hit rate offsets execution costs. | Candidate | Positive net R and profit factor above 1 on disjoint OOS; no blocked quality verdict. |
| H2 | GBPUSD only | GBPUSD has marginal positive edge but may not survive OOS variance. | Exploratory | Positive OOS net R with at least 30 decisive trades across folds. |
| H3 | EURUSD + GBPUSD + USDJPY | Liquid-pair basket reduces structurally weak symbols while preserving signal breadth. | Exploratory | Positive aggregate OOS net R; no single symbol contributes over 70% of gains. |
| H4 | Exclude AUDUSD, NZDUSD, USDCAD, USDCHF | Removing same-window failures improves economics but is selection-biased. | Diagnostic only | Must not be promoted from same-window result; validate only on frozen disjoint windows. |

## Anti-overfit rules

- No parameter changes after OOS starts.
- No symbol additions/removals after result inspection.
- Conventional PIT and staged evidence remain separate.
- Historical disjoint-window tests count as retrospective OOS, not prospective proof.
- Insufficient sample remains `INSUFFICIENT_SAMPLE`, not positive evidence.
- Any blocked data-quality verdict invalidates affected fold.
