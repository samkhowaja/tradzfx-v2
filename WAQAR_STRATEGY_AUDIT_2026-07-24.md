# Waqar Strategy Audit — 2026-07-24

## Executive verdict

**Status: NOT VALIDATED. DO NOT PROMOTE LIVE.**

Waqar shows promising GBPUSD behavior after correcting London-session timing and applying live entry-drift policy. Evidence remains too narrow and incomplete for production use.

Main blockers:

1. Active strategy windows are fixed UTC, not authored Europe/London wall time.
2. Five-symbol historical feature gap was repaired, but EURUSD and GBPUSD still contain mixed historical producer versions.
3. Only 51 trades survive corrected windows, setup checks, drift policy, and timeout across seven pairs; pair behavior is highly uneven.
4. Trade exports do not preserve exact feature-row lineage.
5. Current strategy changes source methodology from reversal pricing to momentum continuation.
6. Global strategy seed validation is blocked by unrelated `smc_ict_liquidity_reversal.yaml` compile failure.
7. Compiled `packages/strategies/dist` can differ from source without hard-failing evidence runs.

No result in this report supports live promotion.

---

## Scope

### Frozen evaluation interval

- Start: `2026-04-25T00:00:00.000Z`
- End: `2026-07-24T00:00:00.000Z`
- Interval semantics: start-inclusive, end-exclusive for audit interpretation.
- Exact duration: 90 days.
- Evaluated symbols: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, and USDJPY.

### Strategy variants

- Active modified strategy: `packages/strategies/src/specs/waqar_v2.yaml`
- Ebook-faithful experiment: `packages/strategies/src/specs/waqar_ebook_v1.yaml`
- Two-pair corrected-window research clone: `packages/strategies/src/specs/waqar_v2_bst_corrected_shadow.yaml`
- Seven-pair corrected-window research clone: `packages/strategies/src/specs/waqar_v2_bst_corrected_7pair_shadow.yaml`

Seven-pair corrected shadow remains:

- `active: false`
- `live.mode: disabled`
- valid only for ranges wholly within British Summer Time

Active `waqar_v2` was not changed during corrected-window research.

---

## Strategy interpretation

Current `waqar_v2` uses:

- 1h fresh supply/demand zone;
- 15m non-neutral HTF bias in `READY` or `SOFT_WARN` state;
- 1h pricing position;
- 1m BOS, MSS, or CHOCH aligned with HTF bias;
- fresh aligned 1m zone/FVG retest;
- optional 1m displacement confirmation;
- fixed 5-pip stop;
- 3R target;
- maximum 45 fill bars;
- maximum 180 holding bars;
- portfolio heat capped at one position per symbol and two total.

### Methodology deviation

Current strategy is not ebook-faithful. Pricing logic is explicitly inverted into momentum continuation:

- bullish bias requires premium/deep premium;
- bearish bias requires discount/deep discount.

Traditional reversal interpretation would normally seek bullish entries in discount and bearish entries in premium. Performance from `waqar_v2` therefore validates only modified continuation hypothesis, not original Waqar method.

---

## Critical session defect

Authored strategy describes London wall-clock windows:

- 08:00–09:00 Europe/London
- 14:00–15:00 Europe/London

Compiler currently interprets `timeWindows` as fixed UTC. Active strategy uses:

- 08:00–09:00 UTC
- 14:00–15:00 UTC

During BST, those execute one hour late.

Research shadow corrects interval for frozen BST-only range using:

- 07:00–08:00 UTC
- 13:00–14:00 UTC

This is not permanent DST support. Fixed offsets become wrong across GMT/BST transitions.

### Required permanent fix

Strategy schema needs two explicit forms:

1. UTC interval:
   - `utcStart`
   - `utcEnd`
2. Local wall-clock interval:
   - IANA timezone such as `Europe/London`
   - local start/end

Compiler must resolve DST per signal date and use half-open windows:

`start <= signal_time < end`

Current inclusive end can admit exact boundary signals into adjacent intervals.

---

## Corrected-window live-drift result

Frozen BST-corrected shadow, strict stage accounting, live entry-drift policy:

| Metric | EURUSD | GBPUSD | Combined |
|---|---:|---:|---:|
| Raw signals | 54 | 55 | 109 |
| Setup blocked | 11 | 9 | 20 |
| Simulated | 43 | 46 | 89 |
| Drift rejected | 31 | 35 | 66 |
| Deduplicated | 0 | 0 | 0 |
| Gate skipped | 0 | 0 | 0 |
| Invalid outcomes | 0 | 0 | 0 |
| Timeouts | 1 | 2 | 3 |
| Heat dropped | 1 | 0 | 1 |
| Executed | 10 | 9 | 19 |

### Executed performance

| Metric | EURUSD | GBPUSD | Combined |
|---|---:|---:|---:|
| Trades | 10 | 9 | 19 |
| Win rate | 70.0% | 88.9% | 78.9% |
| Planned R | +16.58R | +20.96R | +37.54R |
| Realized R | +13.61R | +18.03R | +31.64R |
| Average entry drift | ~0.77 pip | ~1.29 pips | ~1.02 pips |

### Interpretation

Headline metrics look strong but sample is too small. GBPUSD contributes stronger surviving evidence. EURUSD remains weaker.

Only 19 of 89 simulated candidates executed. Drift policy rejected 66, or about 74.2% of simulated candidates. Execution sensitivity is therefore structural, not minor noise.

Realized R is 5.90R below planned R:

- planned: +37.54R
- realized: +31.64R
- reduction: about 15.7%

Spread and slippage were intentionally not primary optimization targets, but entry drift cannot be ignored with a fixed 5-pip stop. One pip equals 20% of authored stop distance.

---

## Post-repair seven-pair result

Current-engine backfill completed for AUDUSD, NZDUSD, USDCAD, USDCHF, and USDJPY:

- 36,468 bars processed;
- 0 errors;
- 10/10 requested feature cells `READY`;
- `features_htf_bias` producer version `3.2.0`;
- `features_bias` producer version `3.0.0`;
- 0 missing anchors reported by readiness manifest;
- 0 obsolete `input_hash = 'backfill'` markers.

Manifest: `reports/backfill-runs/waqar-five-majors-15m-2026-07-24.json`.

Strict preflight then returned `READY` for all seven symbols with no warnings or blocked symbols. Pair-level runs used exact frozen 90-day interval, BST-corrected windows, strict setup checks, `sl_first`, and live drift gate.

| Pair | Raw | Blocked | Simulated | Drift rejected | Timeouts | Executed | W-L | Win rate | Planned R | Realized R | Avg drift |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| EURUSD | 54 | 11 | 43 | 31 | 1 | 11 | 8-3 | 72.7% | +19.44R | +16.12R | 0.76 pip |
| GBPUSD | 60 | 10 | 50 | 39 | 2 | 9 | 8-1 | 88.9% | +20.96R | +18.03R | 1.29 pips |
| AUDUSD | 34 | 2 | 32 | 22 | 3 | 5 | 0-5 | 0.0% | -4.58R | -5.00R | 1.02 pips |
| NZDUSD | 49 | 19 | 30 | 28 | 1 | 1 | 0-1 | 0.0% | -0.80R | -1.00R | 1.00 pip |
| USDCAD | 68 | 20 | 48 | 40 | 1 | 7 | 2-5 | 28.6% | +0.10R | -0.65R | 1.13 pips |
| USDCHF | 50 | 7 | 43 | 32 | 4 | 4 | 2-2 | 50.0% | +3.28R | +2.30R | 1.35 pips |
| USDJPY | 62 | 14 | 48 | 24 | 5 | 14 | 11-3 | 78.6% | +28.34R | +27.64R | 1.06 pips |
| **Total** | **377** | **83** | **294** | **216** | **17** | **51** | **31-20** | **60.8%** | **+66.74R** | **+57.44R** | — |

Drift rejected 73.5% of simulated candidates. Aggregate return is concentrated in EURUSD, GBPUSD, and USDJPY. AUDUSD failed all five executions; NZDUSD has only one execution; USDCAD is negative after realized entry drift. Aggregate number must not hide pair instability or tiny samples.

Evidence: `reports/waqar-7pair-90d-2026-07-24/summary.json` and pair JSON files in same directory.

---

## Stage-accounting defect and repair

Previous runner behavior placed synthetic drift-rejected records into `rawTrades`. These records lacked normal entry, SL, and TP geometry. Fingerprints collapsed to values such as:

- `buy|undefined|undefined|undefined`
- `sell|undefined|undefined|undefined`

Consequences:

- drift rejections inflated deduplication counts;
- surviving rejected records became generic invalid outcomes;
- stage totals obscured actual terminal decisions.

### Implemented repair

`scripts/backtest-pit-v2.js` now:

- partitions `ENTRY_DRIFT_EXCEEDED` rejections before dedupe and gates;
- reports `driftRejected` separately;
- aggregates drift rejection reasons;
- classifies missing invalid reasons as `INTERNAL_UNCLASSIFIED_OUTCOME`;
- validates pre-simulation and terminal conservation;
- fails closed on accounting mismatch.

Required invariants:

`rawSignals - warmupSkipped - invalidGeometry - setupInvalidGeometry - setupBlocked = simulated`

`driftRejected + deduped + gateSkipped + invalidOutcomes + timeouts + heatDropped + executed = simulated`

Focused validation result:

- 68 tests passed
- 0 failed
- false dedupe: 0
- generic unknown outcomes: 0

Metrics did not change after repair. Labels and conservation became correct.

---

## Feature coverage audit

Frozen 90-day 15m surfaces:

| Symbol | 15m candles | `features_bias` | `features_htf_bias` | HTF rows missing at candle timestamps |
|---|---:|---:|---:|---:|
| EURUSD | 7,299 | 5,756 | 5,756 | 1,543 |
| GBPUSD | 7,300 | 5,835 | 5,835 | 1,465 |
| AUDUSD | 7,298 | 1,781 | 2,121 | 5,177 |
| NZDUSD | 7,300 | 1,373 | 1,746 | 5,554 |
| USDCAD | 7,299 | 1,372 | 1,745 | 5,554 |
| USDCHF | 7,298 | 1,518 | 1,891 | 5,407 |
| USDJPY | 7,268 | 1,137 | 1,531 | 5,751 |

All existing `features_bias@15m` rows have corresponding HTF-bias rows. Missing HTF surface originates primarily from absent historical bias/DAG runs, not selective HTF producer failure.

For NZDUSD, USDCAD, USDCHF, and USDJPY, meaningful `features_bias@15m` history begins only on `2026-06-30`. AUDUSD is also heavily partial.

### Candle source status

Higher-timeframe source candles span full frozen range for every symbol:

- 1h: about 1,825–1,832 rows;
- 4h: about 461–462 rows;
- 1d: 90 rows.

Defect is historical feature production, not market-candle availability.

### Version mixture

Existing HTF rows include producer versions `2.0.0`, `3.1.0`, and `3.2.0`. Current engine feature version is `3.2.0`.

Mixed versions can be PIT-valid only if run metadata and trade lineage identify exact consumed rows. Current exports do not.

---

## Backfill safety verdict

### Prohibited SQL path

Do not use:

- `scripts/backfill-htf-bias.ts`
- `scripts/backfill-htf-bias-all.ts`
- migration function `backfill_htf_bias()` from `infra/migrations/041_backfill_htf_bias.sql`

Function is obsolete relative to current engine. It:

- derives HTF bias from order blocks and structure;
- writes `engine_ver = '1.0.0'`;
- writes `input_hash = 'backfill'`;
- overwrites conflicts;
- does not implement current v3.2.0 higher-timeframe candle tree.

Using it would contaminate one feature table with incompatible semantics.

### Insufficient standalone path

`scripts/backfill-htf-bias.js` targets timestamps already present in `features_bias`. It cannot create missing bias timestamps and therefore cannot repair main five-symbol defect.

### Viable repair path

Use `scripts/backfill-historical-features.js` only after backup and write-set review:

1. Build current engine and shared packages.
2. Process `1d,4h,1h,15m` high to low.
3. Use explicit frozen start/end.
4. Request complete Waqar dependency closure.
5. Preserve 500-bar context.
6. Keep cache bypass for corrected recomputation.
7. Generate readiness manifest.
8. Verify producer versions, hashes, row counts, and missing tradable timestamps.
9. Rerun preflight before strategy evaluation.

This path is broad and can rewrite dependent feature tables. It should not be run merely to increase a favorable sample.

---

## Causal lineage audit

Run-level reproducibility is partly strong. Immutable-run metadata records:

- normalized strategy spec hash;
- fixed window;
- mode;
- setup profile;
- intrabar policy;
- data edge;
- readiness-manifest hash.

Trade-level causal proof remains insufficient.

### Missing per-trade evidence

- exact 15m HTF-bias primary key;
- exact 1h pricing primary key;
- complete 1h zone composite key;
- exact 1m structure composite key;
- complete 1m retest-zone composite key;
- optional displacement row key;
- source feature timestamps beyond final zone timestamp;
- `engine_ver` and `input_hash` for each source row;
- lifecycle state evaluated as of anchor;
- `known_at` where supported;
- setup evaluation ID and `context_hash`;
- per-gate decision trail;
- strategy spec hash on each trade;
- drift-rejected candidate evidence.

Relevant tables generally lack universal row IDs. Lineage must preserve full composite keys:

- `features_htf_bias`: `(symbol, tf, ts)`
- `features_pricing`: `(symbol, tf, ts)`
- `features_structure`: `(symbol, tf, ts, event_type)`
- `features_displacement`: `(symbol, tf, ts)`
- `features_zone`: `(symbol, tf, ts, zone_kind, top, bottom)`

Legacy tables mostly lack `known_at`. Causal evidence must therefore record source timestamp, anchor timestamp, lifecycle validity as of anchor, producer version, and input hash.

### Required lineage implementation

1. Add optional compiler evidence projection.
2. Preserve feature primary keys and producer metadata through signal and trade objects.
3. Attach setup evaluation ID/context hash.
4. Retain per-gate and drift decisions.
5. Export rejected candidates separately.
6. Add stable lineage JSON to immutable artifacts.
7. Add DB persistence only after evidence schema stabilizes.
8. Fail evidence runs when any executed trade lacks required feature references.

Until complete, current results support exploratory performance analysis, not independent causal reconstruction.

---

## Reproducibility risks

### Rolling endpoint

Candidate counts changed when evaluation used moving “last 90 days.” Frozen timestamps are mandatory for comparisons.

### Persistent setup cache

Setup evaluations use deterministic context hashes, but changing feature data or stale compiled code can affect behavior. Evidence runs must record cache state or force defined cache semantics.

### Stale compiled package

Source loader and compiled `dist` previously disagreed on inactive strategy behavior. Current stale-dist check warns rather than fails. Evidence runs should hard-fail when `packages/strategies/dist` is older than source.

### Global seed gate

`seed-strategy-specs.js` compile-smoke currently fails on unrelated `smc_ict_liquidity_reversal.yaml` with:

`Cannot read properties of undefined (reading 'filter')`

Full strategy validation cannot be considered green until this is repaired.

### Evidence exclusions

Four blocked zero-trade `reports/*90d_trades.jsonl` snapshots are invalid evidence and must not be used. Valid prior trade arrays are:

- `reports/waqar_v2_EURUSD_90d_trades.json`
- `reports/waqar_v2_GBPUSD_90d_trades.json`

---

## Acceptance gates before reconsideration

### P0 correctness

- [x] Separate drift rejection from dedupe.
- [x] Remove generic unknown outcome accounting.
- [x] Enforce stage conservation.
- [x] Add regression tests.
- [ ] Add exact trade-level feature lineage.
- [ ] Preserve rejected candidate evidence.
- [ ] Hard-fail stale compiled strategy package.
- [ ] Restore global compile-smoke/seed validation.

### Session semantics

- [ ] Add timezone-aware local windows.
- [ ] Use half-open interval ends.
- [ ] Add GMT/BST transition tests.
- [ ] Rerun frozen windows spanning both GMT and BST.

### Data readiness

- [ ] Repair five-major historical dependency closure safely.
- [ ] Produce readiness manifests with zero required dense-feature failures.
- [ ] Confirm current producer versions and non-placeholder input hashes.
- [ ] Run `pnpm db:seed:check` after relevant spec/feature changes.

### Statistical evidence

- [ ] Increase corrected-window executed sample substantially beyond 19 trades.
- [ ] Separate EURUSD and GBPUSD conclusions.
- [ ] Run multiple frozen out-of-sample periods.
- [ ] Run walk-forward evaluation.
- [ ] Measure setup survival under drift without optimizing on same interval.
- [ ] Compare continuation variant against ebook-faithful reversal variant.

### Promotion

- [ ] No unresolved PIT, lifecycle, or lineage defect.
- [ ] No blocked required symbol.
- [ ] No dependence on BST-only fixed-offset shadow.
- [ ] Paper-trading acceptance interval completed.
- [ ] Explicit promotion review approved.

---

## Final conclusion

Waqar has a promising research signal, concentrated in GBPUSD. Correct London timing did not destroy edge, and corrected live-drift survivors remained profitable in frozen sample. Evidence is only 19 executed trades, however, with 74.2% of simulated candidates rejected by drift policy.

System currently cannot prove exact feature rows behind each executed trade. Five configured majors lack required historical feature coverage. Active session semantics are wrong during BST. Current variant also tests modified momentum continuation, not original strategy.

**Decision: keep `waqar_v2_bst_corrected_shadow` inactive. Keep active strategy out of live promotion. Repair timezone semantics, causal lineage, seed validation, and data readiness before expanding evaluation. Treat GBPUSD as primary research candidate; do not generalize result across seven-symbol family.**
