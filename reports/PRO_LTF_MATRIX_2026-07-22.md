# Pro-LTF Variant Matrix — EURUSD 15d (post-cleanup) — 2026-07-22

**Protocol:** baseline preserved; one variable per cell; SL 10p everywhere; `timeoutBars: 0` (SL/TP/window-end only — no timeouts); limit fills modeled honestly (touch-at-limit or unfilled); no family conversions until OOS validation. Chain under test (identical across all cells): **15m bias → 5m setup zone → 1m structure trigger** (`structureFreshnessMinutes: 30`, zone TTL 120m).

## Results (52 raw signals → 8 executed setups per variant)

| variant | entry | W/L | netR | netR_realized | expR | medR | CI95(expR) | exits (TP/SL/BE/end) | drift med | limit fill |
|---|---|---|---|---|---|---|---|---|---|---|
| **baseline tp30** | MKT | 4/4 | **+5.03** | +3.63 | +0.454 | 0.52 | −0.70..1.61 | 3/4/0/1 | 1.8p | — |
| tp12 | MKT | 6/2 | +3.76 | +2.72 | +0.34 | 0.83 | −0.25..0.93 | 1/2/0/5 | 1.8p | — |
| tp15 | MKT | 5/3 | +3.06 | +2.15 | +0.268 | 1.08 | −0.47..1.01 | 4/3/0/1 | 1.8p | — |
| **be@1R** | MKT | 1/7 | **−0.36** | −0.67 | −0.083 | 0 | −0.84..0.68 | 1/3/4/0 | 1.8p | — |
| tp30 | LIM | 3/4 | +3.15 | +3.15 | +0.45 | −1 | −0.97..1.87 | 2/4/0/1 | **0p** | 88% (7/8) |
| tp12 | LIM | 4/3 | +1.80 | +1.80 | +0.257 | 1.2 | −0.61..1.13 | 4/3/0/0 | **0p** | 88% |
| **tp15** | **LIM** | 4/3 | +3.00 | +3.00 | +0.429 | **1.5** | −0.56..1.42 | 4/3/0/0 | **0p** | 88% |

## Reads (in protocol order)

1. **Break-even at +1R is decisively rejected.** −0.36 netR, 4 of 8 trades scratched at 0.00 after touching +1R and reversing — the same setups that in the baseline ran on to 2.8R/0.84R wins. Post-+1R pullbacks are structural in this setup, not noise. BE at 1.5–2R or a trail is a *new* cell for the next matrix, not a tune of this one.
2. **Baseline tp30 leads netR (+5.03)** on three full TP hits (2.8–2.82R), but pays 1.4R of drift (netR 5.03 → 3.63 realized) and its median is dragged by full SLs. Its limit sibling equals its expectancy (+0.45) with perfect accounting.
3. **TP 12–15p fits the excursions.** tp15lim has the best median R (1.5) and cleanest session profile; tp12lim banks most often (4 TP of 7). The 30p target works only as a market-order runner with drift cost.
4. **Limit entries are verified end-to-end**: fill at the authored zone edge (drift = 0, rRealized = r exactly), 12% unfilled — those missed trades are the honest cost, and they're visible.
5. **Consumption correction confirmed:** 0 mitigated-before-anchor across all variants (the as-of window excludes them correctly); most used zones were touched *by the trigger candle itself* (5/8) — the earlier `fill=1.0` readings were trigger-candle consumption, not stale-zone leakage.
6. **Sessions:** NY strongest (+1.2…+2.8), ASIA positive for tp15 (+2.0), PM session negative in 4 of 7 cells.
7. **Statistical honesty:** every CI crosses zero at n=8. Structure and selectivity are proven; profitability is **not**. Nothing here justifies family conversions yet.

## Notes for the record

- Runner gap found: `--json --trades` output omits `closePrice` (exit mix had to be reconstructed from R thresholds) — worth a one-line fix.
- Baseline note: `timeoutBars: 96 → 0` changed baseline character from "harvest small wins" (7W/1L, +2.62) to "full-distance outcomes" (4W/4L, +5.03). Same setups; the exit rule IS the strategy.
- BE rule implemented for this experiment: `risk.breakevenAtR` in `simulateBidCandleMarketTrade` (scratch close at entry when MFE ≥ threshold; market path only).

## Next (per protocol)

- 60–90d walk-forward on the full matrix once the all-symbol backfill completes (running: GBPUSD ~98%, 7 symbols left).
- Next matrix candidates (only after OOS): BE@1.5R / trail-after-2R cell, TP15-limit as leading cell to beat, one alternate SL (e.g. zone-edge SL) with TP held fixed for attribution.
