# Strategy Risk-Authority Forensic Audit — 2026-07-19

## Verdict

Conventional PIT previously replaced strategy-compiled SL/TP with generic setup-engine structural levels. Directional geometry remained valid, hiding strategy-contract corruption. Results produced before the fix under strict setup evaluation are not suitable for ranking.

Execution policy now preserves strategy-authored SL/TP by default. Setup engine still grades and blocks setups. Structural risk replacement requires explicit `setupEngine.overrideRisk: true`.

Focused PIT regressions: **65/65 passing**.

## Repaired strategy results

| Strategy | Window | Raw | Executed | Wins | Losses | Timeouts | Win rate | Net R | Avg win R | Avg loss R | Gross RR contract | Geometry violations | Trust status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `doyle_sd` | 90d | 194 | 88 | 54 | 34 | 18 | 61.4% | +72.1877 | +2.1687 | -1.3213 | Exact 2.5R | 0 | Trusted under repaired runner |
| `a_plus_orb_fvg_5m` | 90d | 6 | 1 | 0 | 1 | 4 | 0.0% | -1.1884 | 0 | -1.1884 | Exact 2R | 0 | Insufficient sample |
| `watukushay_no1` | 90d | 2,420 | 177 | 140 | 37 | 23 | 79.1% | -3.3665 | +0.3890 | -1.5630 | Exact 1R | 0 | Valid, economically weak after costs |
| `smart_risk_ob_ifvg_1m` | 90d | 47 | 34 | 14 | 20 | 2 | 41.2% | +0.0046 | +1.7610 | -1.2325 | Exact 2R | 0 | Valid, effectively break-even |

Realized wins remain below gross targets and realized losses can exceed -1R because spread, slippage, and commission are normalized against planned strategy risk.

## Root cause

Affected path: `scripts/backtest-pit-v2.js`.

Old behavior:

1. Strategy compiler generated risk geometry from YAML.
2. Setup engine independently calculated structural SL/TP for grading.
3. PIT unconditionally copied setup-engine prices into executable signal.
4. Validation checked direction only, not authored risk semantics.
5. Fixed-RR strategies silently became variable-target strategies.

Doyle evidence before contract fix included gross targets near 40R despite `tp: "sl * 2.5"`. After fix, all 88 exported trades have exact 2.5R gross geometry and no realized winner exceeds 2.5R.

## Watukushay cost finding

Gross geometry is exactly 1R for all 177 trades. High win rate does not produce profit because stops are too tight relative to execution costs.

| Symbol | Trades | Wins | Net R | Avg R | Avg entry cost / planned risk | Max entry cost / planned risk |
|---|---:|---:|---:|---:|---:|---:|
| GBPUSD | 20 | 14 | -8.411 | -0.421 | 0.410 | 0.526 |
| XAUUSD | 63 | 48 | -0.566 | -0.009 | 0.266 | 0.307 |
| EURUSD | 94 | 78 | +5.610 | +0.060 | 0.321 | 0.524 |

Verdict: strategy economics defect, not candle/database corruption.

## Forex ORB

Strict replay executes zero trades because seven FX symbols are blocked by producer-quality state and every surviving XAUUSD signal is rejected by fixed volatility threshold.

Required stale/error producers on FX symbols:

- `features_pricing@5m`
- `features_atr@5m`
- `features_zone@5m`

Degraded event producers include:

- `features_structure@5m`
- `features_displacement@5m`
- `features_zone_retest@5m`

Provisional stale-tolerant replay retained costs, setup engine, gates, and deterministic execution. It is diagnostic only:

| Symbol | Raw | Executed | Win rate | Net R | Avg win R | Avg loss R | Gross RR |
|---|---:|---:|---:|---:|---:|---:|---:|
| EURUSD | 57 | 10 | 50.0% | -3.350 | +1.104 | -1.774 | 2R |
| GBPUSD | 58 | 10 | 60.0% | -1.195 | +1.087 | -1.930 | 2R |
| AUDUSD | 57 | 22 | 18.2% | -36.578 | +0.692 | -2.186 | 2R |
| NZDUSD | 56 | 23 | 13.0% | -40.870 | +0.784 | -2.161 | 2R |
| USDCAD | 57 | 25 | 24.0% | -32.679 | +1.075 | -2.060 | 2R |
| USDCHF | 59 | 23 | 34.8% | -28.048 | +0.826 | -2.311 | 2R |
| USDJPY | 57 | 23 | 43.5% | -12.391 | +1.147 | -1.835 | 2R |
| XAUUSD | 62 | 0 | 0.0% | 0 | 0 | 0 | N/A |
| **Total** | **463** | **136** | **30.9%** | **-155.113** | — | — | **2R** |

`maxAtr5Pips: 2.5` is shared across eight unlike instruments. It rejects all 44 non-setup-blocked XAUUSD candidates. This fixed threshold is not cross-asset coherent.

Forex ORB remains unrankable until producer errors are repaired and strict replay is rerun. Provisional result indicates severe negative expectancy even if staleness is waived.

## Trust rules

1. Do not rank strict PIT outputs generated before risk-authority fix.
2. Require exported trade count to equal executed count.
3. Require directional SL/TP geometry validation.
4. Require gross RR geometry to match exact strategy contract when TP uses `sl * N`.
5. Report net executable R after spread, slippage, and commission.
6. Keep producer-quality blocks distinct from poor strategy performance.
7. Treat stale-tolerant runs as diagnostics, never final evidence.

## Evidence

- `reports/forensic-doyle-sd-90d-contract-fix-2026-07-19.jsonl`
- `reports/forensic-a-plus-orb-fvg-90d-2026-07-19.jsonl`
- `reports/forensic-watukushay-no1-90d-2026-07-19.jsonl`
- `reports/forensic-smart-risk-ob-ifvg-1m-90d-2026-07-19.jsonl`
- `reports/forensic-forex-strategy-orb-90d-2026-07-19.jsonl`
- `reports/forensic-forex-strategy-orb-90d-stale-ok-2026-07-19.jsonl`
