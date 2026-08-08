# Market Data Forensic Report — 2026-07-19

## Executive verdict

**PASS_WITH_WARNINGS**

Canonical market data now passes hard parity checks needed for deterministic strategy replay:

- Canonical spread feature parity: **0 mismatches**.
- Closed historical HTF projection parity: **0 mismatches**.
- Raw invalid OHLC geometry: **0 findings**.
- Canonical invalid OHLC geometry: **0 findings**.
- Canonical duplicate symbol/timestamp rows: **0 findings**.
- Active strategy dependency blockers: **0**.

Strategy results still require rerun. Prior rankings may contain outputs produced before HTF and spread repairs.

## Scope

| Dimension | Scope |
|---|---|
| Audit window | 2026-04-20 through 2026-07-19 |
| HTF parity window | Latest 30 days, complete historical buckets only |
| Symbols | AUDUSD, EURUSD, GBPUSD, NZDUSD, USDCAD, USDCHF, USDJPY, USDSEK, XAUUSD |
| Timeframes | 1m, 5m, 15m, 1h, 4h, 1d |
| Raw source | `candles_1m` |
| Governed source | `market.candles_1m_canonical` |
| HTF projections | `market.candles_{5m,15m,1h,4h,1d_*}_canonical` |
| Feature checked | `features_spread@1m` |

## Confirmed defects and repairs

| Defect | Evidence | Root cause | Repair | Final status |
|---|---:|---|---|---|
| Historical canonical HTF staleness | 36,301 parity failures before repair | Historical raw/cagg refresh paths did not rebuild canonical HTF projections | Added canonical refresh to `scripts/refresh-candle-caggs.js` and `scripts/backfill-candles-from-mt5-csv.js`; rebuilt audit range | **Resolved: 0 closed historical mismatches** |
| Strategy-visible closed-market candles | Weekend rows existed in governed raw evidence | Shared readers returned canonical rows without consumer-level market-calendar filtering | Added tradability filtering in `packages/shared/src/candles/candleSource.ts` | **Resolved; 14 focused tests pass** |
| Stale spread feature values | 5,389 initial mismatches | Stored rows predated current sanity-filtered producer behavior | Recomputed 11,623 existing rows through `DAGRunner` with cache bypass | **Resolved for candle-anchored rows: 0 mismatches** |
| Spread audit false positives | Thousands after replay, mostly errors near 1e-15 | Audit used exact float equality and initially selected 20 valid rows instead of selecting latest 20 then filtering | Matched producer selection order and added 1e-9 comparison tolerance | **Resolved** |
| HTF audit edge false positives | 95 findings after historical rebuild | Partial first bucket and live ingestion/projection race included in parity | Audit now checks full buckets and allows five-minute projection refresh grace | **Resolved** |
| NZDUSD recent stale projection | One remaining closed 5m mismatch | Effective canonical 1m source changed after projection materialization | Refreshed NZDUSD canonical HTFs for recent two-day range | **Resolved** |

## Current warnings

### 1. Legacy spread timestamp lineage

- Count: **369** rows.
- Code: `SPREAD_NON_ANCHOR_ROWS`.
- Meaning: old rows use scheduler wall-clock timestamps rather than canonical candle timestamps.
- Current producer anchors dense feature rows to newest source candle.
- Every inspected legacy row had a canonical candle-anchor replacement.
- These rows are excluded from current producer parity but retained as historical evidence.

Risk: queries that select spread rows by nearest timestamp without preferring candle anchors may consume duplicate semantic observations.

Recommended action: archive legacy rows, verify no trade or run foreign-key lineage depends on them, then remove or quarantine them in a migration.

### 2. Raw canonical spread pollution

- Count above pair sanity caps: **4,198** samples.
- Largest concentration: USDSEK 2,204; USDCHF 592; USDJPY 531; GBPUSD 380; NZDUSD 342.
- Raw values remain evidence.
- Current `features_spread` producer drops samples above `baseSpreadPips * SPREAD_SANITY_MULTIPLIER` before averaging.

Risk: consumers reading `market.candles_1m_canonical.spread` directly, without producer sanity rules, can receive implausible values.

Recommended action: inventory direct spread consumers; require governed spread accessor or explicit sanity filtering.

### 3. Suspect candles

- Count: **2**.
- Symbol: USDSEK.
- Reason: 1m range exceeded 1,000-pip quality cap.
- Timestamps fall around 2026-07-05/06.
- Rows remain in raw evidence and are flagged through `candle_quality`.

Risk: direct raw readers can include quarantined observations.

Recommended action: verify every strategy path uses governed candle source and quality policy.

### 4. Coverage warnings

- Surfaces flagged: **45/54**.
- Daily surfaces: **100%** for all nine symbols.
- Lowest 1m coverage: USDJPY **98.79%**; XAUUSD **99.27%**.
- Other FX 1m coverage: approximately **99.38%–99.51%**.
- HTF coverage generally exceeds **99%**.

Current `gapCount` is missing-row count for 1m and run count for some HTFs; `largestGapMinutes=0` on 1m therefore does not describe outage duration. Exact missing timestamp runs still need extraction before classifying feed outages.

Risk: setups near genuine feed gaps may use incomplete lookbacks or be skipped. Aggregate performance can differ by symbol based on feed completeness.

Recommended action: produce exact tradable missing-run ledger, then tag affected setups and trades.

## Trust decision

| Data/output | Current trust |
|---|---|
| Raw broker rows as immutable evidence | Trusted with documented pollution and quality flags |
| Governed canonical 1m OHLC | Trusted for replay through shared consumer path |
| Closed historical canonical HTFs | Trusted after rebuild and zero parity result |
| Candle-anchored `features_spread@1m` | Trusted after producer-path reconciliation and zero parity result |
| Legacy non-anchor spread rows | Not trusted for new replay |
| Existing historical strategy rankings | **Not yet trusted**; rerun required |
| Existing trades near missing-data windows | Not trusted until lineage tracing |

## Strategy-impact assessment

Data repairs can alter:

1. HTF bias, zones, structure, order blocks, sweeps, and pricing features derived from stale projections.
2. Spread gates and execution eligibility from stale or polluted spread history.
3. Setup availability around weekends and closed-market timestamps.
4. Trade entry timing and result geometry when rerunning PIT logic.

No previous extraordinary Waqar result should be cited. Setup-cache identity and post-override TP/SL geometry defects were separate execution defects and have already been repaired.

## Required next phase

1. Extract exact coverage-gap runs per symbol/timeframe.
2. Map setups and trades onto missing or suspect source windows.
3. Trace suspicious strategy outcomes, starting with `doyle_sd`, `a_plus_orb_fvg_5m`, `watukushay_no1`, `forex_strategy_orb`, and `smart_risk_ob_ifvg_1m`.
4. Rerun strategy suite on repaired canonical data.
5. Compare old and repaired results trade-by-trade.
6. Publish revised strategy ranking only after reproducibility checks.

## Reproducibility artifacts

- Audit implementation: `scripts/audit-market-data-integrity.js`
- Spread replay: `scripts/reconcile-spread-feature.js`
- Machine-readable result: `reports/market-data-integrity-latest.json`
- Generated summary: `reports/market-data-integrity-latest.md`
- Dependency audit: `reports/strategy-data-dependencies-latest.json`
- This forensic interpretation: `reports/MARKET_DATA_FORENSIC_REPORT_2026-07-19.md`
