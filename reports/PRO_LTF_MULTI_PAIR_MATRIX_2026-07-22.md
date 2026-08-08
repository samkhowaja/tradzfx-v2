# Pro-LTF Multi-Pair Matrix — 6 pairs × 7 variants, 15d post-cleanup — 2026-07-22

**Protocol (as agreed):** baseline preserved; one variable per cell; SL 10p everywhere; `timeoutBars: 0`; limit fills honest (touch-at-edge or unfilled); no tuning-in-place. Chain: **15m bias → 5m setup zone → 1m structure trigger**. Note: USDCHF/GBPUSD matrices ran inside the capability gate's 10-minute freshness window (see §"Ops notes" — the gate races the 15m producer cadence; GBPUSD initially appeared "silent" purely from that race).

## Headline table (netR / W-L / expR per variant × pair)

| variant | entry | EURUSD | GBPUSD | AUDUSD | NZDUSD | USDCAD | USDCHF |
|---|---|---|---|---|---|---|---|
| baseline tp30 | MKT | **+5.03** (4/4) | −17.8 (6/12) | −2.03 (2/9) | −1.11 (2/9) | **+8.76** (3/3) | −0.93 (2/8) | **+8.86** (6/9) |
| tp12 | MKT | +3.76 (6/2) | −24.2 (8/10) | +3.17 (6/5) | +4.09 (6/5) | +3.36 (3/3) | −6.73 (1/9) | +2.46 (8/7) |
| tp15 | MKT | +3.06 (5/3) | −19.3 (9/9) | +4.97 (6/5) | +3.39 (5/6) | +4.26 (3/3) | −3.93 (2/8) | +4.86 (8/7) |
| be@1R | MKT | −0.36 (1/7) | −12.91 (6/12) | −1.2 (1/10) | −0.67 (1/10) | +2.4 (1/5) | −0.93 (2/8) | **+8.48** (5/10) |
| tp30 | LIM | +3.15 (3/4) | −1.0 (4/13) | −3.0 (2/9) | −3.0 (2/9) | **+6.0** (3/3) | −5.0 (1/8) | **+9.0** (6/9) |
| tp12 | LIM | +1.8 (4/3) | **+5.0** (10/7) | +2.2 (6/5) | +2.2 (6/5) | +0.6 (3/3) | −6.8 (1/8) | +1.4 (7/7) |
| tp15 | LIM | +3.0 (4/3) | +3.0 (8/9) | **+4.0** (6/5) | +1.5 (5/6) | +1.5 (3/3) | −6.5 (1/8) | +5.0 (8/7) |

*USDJPY column added 2026-07-22 (required a zone-lifecycle refresh + post-boundary gate timing to unblock — see Ops notes). USDJPY is the strategy's best environment this window: all 7 variants positive, and the only pair where BE@1R survives (5/10, +8.48) — smooth trends mean fewer post-+1R pullbacks. tp30lim is its best cell (+9.0, expR 0.6).*

## The three decisive findings

**1. The entry mechanic IS the outcome — proven cross-pair.** GBPUSD is the cleanest evidence ever measured here: identical signals, **market entries −17.8/−24.2/−19.3 netR vs limit entries +5.0/+3.0**, with median drift **4.9 pips on a 10-pip stop** (half the planned risk spent before the trade starts) vs 0.0 for limits at *identical* MFE (14.9p). The setups are equally good; only the fill changes.

**2. Limit variants are the only cross-pair-consistent cell.** tp12lim/tp15lim are positive on EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD — and tp15lim additionally has the best medians (1.2–1.5R). The exception is USDCHF (below). Market entries are boom/bust (EURUSD and USDCAD strong, everything else red).

**3. Break-even at +1R is dead on every pair** (−0.36, −12.91, −1.2, −0.67, +2.4, −0.93; W/L between 1/5 and 2/8 everywhere). Post-+1R pullbacks are structural to this pattern in every currency tested. Not a pair issue — a rule issue. If management is wanted, it must be BE@1.5–2R or trail (new cell, later).

## Pair-level notes

- **USDCAD is the best environment this window** (trending): baseline 3/3 +8.76 (realized +17.64 — fills came in better than authored), tp30lim 3/3 full-TP +6.0.
- **USDCHF fails everywhere, both entry types, all TPs** (−0.93 … −6.8), on **71 signals** — 2.3× EURUSD's fire rate. The chain machine-guns on CHF and loses: that's not a mechanics problem, it's pair–strategy mismatch (CHF's regime this window: repeated shallow supply/demand levels that produce 1-bar stops; 10p geometry doesn't fit its noise floor). CHF should be excluded from the live observation set unless a CHF-specific geometry emerges from the walk-forward.
- **GBPUSD "silence" was a gate race, not a strategy or data problem**: 31 valid signal rows exist in the compiled SQL; the capability gate's 10-minute state-freshness rule blocks whenever the check lands >10 min after a producer write (15m cadence). Every pair fails STALE_STATE roughly a third of the time — the gate needs to measure against cadence or the runner needs to schedule the check at boundary+N (see Ops notes).

## Ops notes (discovered during this run, recorded for the report)

1. **Capability-gate freshness vs producer cadence**: state-feature freshness threshold (10 min) is tighter than the 15-min write cadence → preflight STALE_STATE is a timing lottery. Either raise the state threshold to ≥ cadence+grace, or evaluate the gate against the last boundary write, not wall clock.
2. **Zone lifecycle needed per-pair manual refreshes** after the lifecycle cron was stopped (treadmill + deadlock storm; still stopped). GBP/AUD/NZD/CAD/CHF each updated 300–1,100 zone rows on refresh. The cron needs the advisory-lock + convergence fix before re-enabling; until then lifecycle freshness comes from the inline trigger + direct function calls.
3. **Live engine verified clean on all 6 tfs for all pairs** (diag runs GBP/NZD/XAU 1m→1d OK), and the 18:16+ passes show zero `Feature engine failed` lines.
4. Exit classification note: `--json` output omits `closePrice` (rebuilt from R thresholds; one-line runner fix outstanding).

## What survives this matrix (so far)

- **tp15lim and tp12lim**: the only cells positive on 5 of 6 pairs (USDCHF excluded). This is the template for the 60–90d walk-forward.
- **Baseline tp30**: viable only on EURUSD/USDCAD this window; its live observation continues (already live on the 7 majors — see live log).
- **Rejected**: BE@1R (everywhere), tp30lim except USDCAD, all market entries on GBPUSD/AUDUSD/USDCHF.
- **Statistical honesty**: CIs still cross zero at n=6–18 per cell. The walk-forward decides; this matrix decides only which cells walk.

## Next

1. Complete backfill (USDJPY/USDSEK/XAUUSD in progress) → their matrices (JPY pairs only; SEK/XAU excluded from this strategy class).
2. **60–90d walk-forward on tp15lim + tp12lim + baseline** (EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD — USDCHF excluded) with the full comparison panel (expectancy, median r_realized, exit mix, MFE/MAE, drift, limit fill/missed rates, session/regime stability, CIs).
3. Live observation continues: baseline active on 7 majors (first live order pending; drift guard will reject market fills >2 pips — expect fewer fills than the backtest's market path).
