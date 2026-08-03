# Waqar Setup Formation Deep Dive — 2026-07-24

## Verdict

**Setup hypothesis shows pair- and session-specific edge, not universal seven-pair edge.**

Strong formation behavior appears on EURUSD, GBPUSD, and USDJPY. AUDUSD and USDCAD expose continuation entries firing into failed expansion or exhausted intraday moves. NZDUSD sample is unusably small. London-open formations materially outperform overlap formations.

No live promotion. Evidence exports lack exact feature-row lineage, so this report distinguishes observed execution facts from inferred strategy formation.

## Evidence boundary

Each accepted setup necessarily passed strategy predicates:

1. fresh 1h demand/supply zone;
2. non-neutral 15m HTF bias in `READY` or `SOFT_WARN`;
3. continuation pricing: bullish in premium/deep premium, bearish in discount/deep discount;
4. aligned 1m BOS/MSS/CHOCH;
5. fresh aligned 1m demand/supply/FVG retest;
6. optional medium/high displacement;
7. fixed authored 5-pip SL and 3R TP.

Trade exports preserve signal time, direction, authored/effective entry, SL, TP, drift, outcome, hold time, MFE, and MAE. They do **not** preserve exact selected 1h zone, 15m bias row/state, pricing row, 1m structure event type, retest zone kind, displacement row, feature producer version, or input hash. Exact claims such as “this trade formed from bullish CHOCH into FVG X” are therefore not auditable yet.

## Portfolio-level formation anatomy

| Slice | Trades | Wins | Win rate | Realized R | Avg MFE | Avg MAE |
|---|---:|---:|---:|---:|---:|---:|
| London open | 25 | 18 | 72.0% | +37.70R | 11.60 pips | 2.74 pips |
| London/NY overlap | 26 | 13 | 50.0% | +19.75R | 9.33 pips | 5.06 pips |
| Buys | 36 | 22 | 61.1% | +41.95R | 10.19 pips | 4.12 pips |
| Sells | 15 | 9 | 60.0% | +15.50R | 11.03 pips | 3.43 pips |

London-open edge is cleaner: higher win rate, larger favorable excursion, and roughly half overlap MAE. Direction itself does not explain edge.

Fast failures dominate bad setups: trades closed within 15 bars produced 2 wins, 8 losses, 20% win rate, and -4.03R. This indicates immediate post-entry acceptance/rejection contains useful setup-quality information.

Five losing trades first moved at least one realized-risk distance in favor before reversing: EURUSD twice, AUDUSD once, USDJPY twice. Fixed 3R-or-stop management surrendered meaningful open profit on these trades.

## Pair deep dive

### EURUSD — valid edge, weaker management

11 trades, 8 wins, 3 losses, +16.12R realized. Average MFE 12.98 pips; average MAE 3.05 pips.

Formation profile:

- London open produced most clean expansions.
- Both directions worked.
- Several winners accepted immediately with sub-1-pip MAE.
- Two losses had large favorable excursion before full reversal, exposing management weakness rather than pure entry failure.

Notable setups:

- 2026-04-27 07:00 buy: clean continuation; 13.7-pip MFE, 0.8-pip MAE, +1.94R after 1.8-pip drift.
- 2026-04-27 07:15 buy: second same-session continuation; 14.6-pip MFE, +2.51R. Correlated duplicate market thesis, not independent evidence.
- 2026-05-07 07:15 buy: immediate rejection; stopped in 3 bars after only 1.8-pip MFE. Setup trigger likely late or structure break failed acceptance.
- 2026-06-03 08:00 sell: reached 11.4-pip MFE, then lost after 124 bars. Entry had edge; fixed management gave it back.
- 2026-06-18 08:00 sell: best textbook execution; zero drift, 16.9-pip MFE, 1-pip MAE, full +3R.
- 2026-06-18 13:45 sell: reached 8.9 pips favorable, then reversed to stop. Overlap continuation became exhaustion/reversal.

Trader assessment: retain pair for research. Test partial/breakeven logic after 1R–1.5R, but avoid tuning from two examples alone.

### GBPUSD — cleanest formation quality

9 trades, 8 wins, 1 loss, +18.03R realized. Average MFE 13.11 pips; average MAE 2.08 pips.

Formation profile:

- Seven of nine trades formed around London open.
- Winners usually expanded decisively with low adverse excursion.
- Sole loss failed in 3 bars, making post-trigger acceptance highly discriminative.
- Drift averaged 1.29 pips, yet directional impulse overcame expanded risk.

Notable setups:

- 2026-04-30 07:45 buy: 15-pip MFE, 0.6-pip MAE, +2.70R.
- 2026-05-07 07:15 buy: only loss; immediate 3-bar stop, 1.8-pip MFE. Same date/time as EURUSD failure suggests shared USD macro shock or correlated false breakout.
- 2026-05-12 07:00 sell: rapid four-bar expansion, +1.94R despite 1.8-pip drift.
- 2026-06-05 07:30 buy: zero adverse excursion, but 1.9-pip drift reduced realized result to +1.90R.
- 2026-06-18 07:00 and 08:00 sells: repeated same directional thesis, both won. Strong trend-day evidence but not two independent regimes.

Trader assessment: strongest pair-specific candidate. Edge likely London liquidity release plus aligned continuation, not generic all-session behavior.

### AUDUSD — continuation logic failed

5 trades, 0 wins, -5.00R. Average MFE 1.62 pips; average MAE 5.10 pips.

Formation profile:

- Four of five setups barely moved favorably before stop.
- Three July 15 signals repeated same bullish thesis and should not count as independent evidence.
- Premium bullish continuation may be entering after expansion, where AUDUSD mean reversion dominates.

Notable setups:

- 2026-06-24 08:00 sell: 0.2-pip MFE, direct failure.
- 2026-07-15 08:00 buy: 0.2-pip MFE, stopped in 9 bars.
- 2026-07-15 13:15 and 13:30 buys: repeated attempts; first reached 4.3 pips before reversal, second only 3.1 pips. Same-day setup clustering inflated evidence count.
- 2026-07-23 13:30 sell: stopped in 6 bars after 0.3-pip MFE.

Trader assessment: disable pair from candidate basket pending larger sample. Investigate reversal pricing variant and minimum displacement/acceptance filter.

### NZDUSD — no statistical conclusion

1 trade, 1 loss, -1R.

- 2026-04-27 07:45 buy: 2.4-pip MFE, 5.8-pip MAE, stop after 116 bars.

Trader assessment: insufficient opportunity generation. One trade cannot support inclusion or exclusion. Sparse executed frequency itself makes strategy commercially irrelevant on this pair under current gates.

### USDCAD — overlap continuation unreliable

7 trades, 2 wins, 5 losses, -0.65R. Average MFE 5.67 pips; average MAE 4.81 pips.

Formation profile:

- Five setups formed in overlap; four of those lost.
- Losing setups often rejected quickly.
- Pair may require oil/CAD regime context or London-only restriction.

Notable setups:

- 2026-05-12 13:30 buy: 0.7-pip MFE, direct stop.
- 2026-05-21 13:00 buy: stopped in 6 bars after 0.9-pip MFE.
- 2026-06-19 07:30 buy: London winner; 14.3-pip MFE, 2-pip MAE, +2.23R.
- 2026-07-17 13:15 sell: clean +2.13R; repeat at 13:30 failed in 7 bars. Re-entry after first expansion likely chased move.
- 2026-07-22 07:15 sell: reached 6.5 pips, then stopped; marginal management candidate.

Trader assessment: test London-only and one-thesis-per-session constraints. Current overlap behavior lacks edge.

### USDCHF — promising but clustered

4 trades, 2 wins, 2 losses, +2.30R. All formed during overlap.

Formation profile:

- Three trades occurred July 21 within 30 minutes, all same buy thesis.
- First July 21 buy won; later repeated buys lost. Signal engine appears to re-enter deteriorating setup after move maturity.

Notable setups:

- 2026-07-15 13:15 buy: slow 119-bar winner, +2.17R.
- 2026-07-21 13:15 buy: +2.13R.
- 2026-07-21 13:30 buy: reached 6.4 pips then stopped.
- 2026-07-21 13:45 buy: immediate 3-bar stop with 0.1-pip MFE.

Trader assessment: positive result overstates independence. Enforce setup identity/cooldown across repeated zone thesis before further evaluation.

### USDJPY — strongest return, trend-regime concentration

14 trades, 11 wins, 3 losses, +27.64R. Average MFE 13.29 pips; average MAE 4.61 pips.

Formation profile:

- 13 of 14 trades were buys, showing result depends on persistent bullish USDJPY regime.
- Winners often required 45–144 bars; edge is intraday continuation, not immediate scalp.
- Same-day repeated entries create correlated evidence.

Notable setups:

- 2026-04-29 13:15 buy: +1.99R after 1.7-pip drift.
- 2026-05-20 13:15 and 13:30 buys: both reached more than 1R favorable before severe reversal. One failed directional thesis counted twice.
- 2026-05-26 13:15 buy: 144-bar winner; very slow realization.
- 2026-07-16 13:15 buy: immediate weak failure; 14:00 re-entry then won +4.56R because favorable entry drift reduced realized risk. Shows re-entry can work, but outcome depends on renewed acceptance.
- 2026-07-20 13:00 and 13:45 buys: same trend thesis, both won.
- 2026-07-21 07:00 buy: +4.71R realized due favorable drift and only 3.5-pip effective risk.

Trader assessment: retain, but test across bearish and ranging USDJPY regimes. Current sample validates one favorable macro trend more than robust pair edge.

## Recurring setup archetypes

### A. Clean London continuation

Characteristics:

- low MAE after entry;
- sustained 13–17-pip MFE;
- usually 20–70 bars to target;
- strongest on GBPUSD, EURUSD, and USDJPY.

This is best-supported archetype.

### B. Immediate false-break failure

Characteristics:

- less than 2-pip MFE;
- stop within 3–19 bars;
- common on AUDUSD, USDCAD, and isolated EURUSD/GBPUSD trades.

Potential filter: require post-break acceptance or minimum close distance beyond structure before market entry. Must be forward-tested; current export lacks exact structure row needed to design safely.

### C. Mature-move re-entry

Characteristics:

- multiple entries same symbol, direction, date, and session;
- first setup may win, later setup deteriorates;
- visible on USDCHF July 21 and USDCAD July 17.

Potential fix: setup-level identity keyed by HTF zone plus direction, one active thesis per session, or cooldown measured from thesis completion rather than raw signal.

### D. Favorable excursion then full reversal

Characteristics:

- price reaches at least one effective-risk unit;
- no profit protection;
- eventual -1R.

Five observed cases. Test partial exit or break-even only as separate forward experiment. Do not rewrite historical result.

### E. Regime-concentrated trend capture

USDJPY profits came almost entirely from buys during persistent bullish regime. Strong return may be beta to macro trend. Need walk-forward blocks containing bearish and sideways regimes.

## Data and architecture holes blocking exact setup forensics

Trade evidence must add per-condition lineage:

- feature table;
- symbol and timeframe;
- exact feature `ts`;
- stable row key;
- producer `engine_ver`;
- `input_hash`;
- predicate result;
- selected zone bounds/kind/freshness/fill;
- HTF direction/state/score;
- pricing position;
- structure event type/level/direction;
- displacement grade and magnitude;
- candle anchor and source timestamps.

Without this envelope, setup formation can only be inferred from strategy predicates and execution path, not replayed exactly.

## Professional next tests

1. Run combined seven-pair portfolio replay to apply `maxConcurrentTotal: 2`.
2. Add setup-thesis dedupe; rerun with one HTF-zone/direction thesis per session.
3. Compare London-only versus overlap-only by pair.
4. Compare current continuation pricing against ebook reversal pricing on same frozen data.
5. Add exact causal lineage before optimizing structure, zone, or displacement filters.
6. Forward-test immediate acceptance filter and 1R management as separate shadows.
7. Expand walk-forward evidence across multiple volatility and directional regimes.

## Final assessment

System is finding real continuation expansions, especially London-open GBPUSD/EURUSD and bullish-trend USDJPY. It also repeatedly enters false breaks, mature moves, and correlated re-signals. Pair universality is disproven by current sample. Best research basket is GBPUSD, EURUSD, and USDJPY, but all remain shadow-only until lineage, timezone semantics, portfolio replay, setup dedupe, and regime robustness are resolved.
