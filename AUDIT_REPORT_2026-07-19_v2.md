# tradzfx-v2 Multidisciplinary Audit — 2026-07-19 (v2, evening)

Audit team model: senior quantitative researchers, algorithmic traders, market-data engineers, backtesting specialists, TypeScript/Node.js engineers, database engineers, risk analysts.

Method: read-only SQL against `tradzfx_v2` (TimescaleDB) inside `BEGIN READ ONLY` transactions; static code review of the engine DAG runner, candle source, pipeline trigger, live runner, and order executor; two consecutive PIT backtester runs compared byte-for-byte for determinism. DB clock at audit time: **2026-07-19 ~21:20–21:50 UTC** (Sunday, market open since 21:00 UTC).

This is a **delta audit** against `AUDIT_REPORT_2026-07-19.md` (same day, ~18:00 UTC) with one new critical mechanism discovered and root-caused.

---

## 1. Executive summary

The system is **structurally sound but operationally degraded**, and the degradation is worse than the morning audit concluded. One new root cause explains why the morning report's "features healthy" read was wrong:

1. **NEW — Feature-anchor freeze across the entire live universe (Critical, F2-01).** Every dense and event feature for every live symbol/tf stopped advancing between **2026-07-17 14:30 and 2026-07-17 20:45 UTC**, even though `candles_1m` and the `market.candles_*_canonical` relations continued to advance normally (EURUSD 1m is current to 21:39 UTC at audit). The engine keeps running (~2,600 `done` runs/24h), but every run re-computes over a window whose newest candle is still Friday afternoon, re-upserts the same 3 rows onto the same frozen `ts` (visible via `input_hash` endTs = current wall clock vs row `ts` = 2026-07-17), and the producer ledger reports `status='done', rows_inserted=3`. **All live signal decisions since Friday ~14:30 UTC have been made on ~2.3-day-old ATR, bias, zone, iFVG, sweep, order-block, and direction_state values.** Mechanism: an 11-hour 1m ingestion gap (Fri 2026-07-17 14:37 → Sat 01:40 UTC) punched a hole in the 15m canonical series; `getRecentCandles()` then either (a) reads only the pre-gap cagg tail (rows after the gap are too few for the 400-bar window) or (b) its 1m-rollup fallback never completes/persists past the gap, so `sourceMaxTs` never advances. Not definitively isolated between (a) and (b) — see §6/S-01. The forward-only event gate (`maxCandleTs <= lastTs → skip`) then pins every downstream feature to the frozen anchor.

2. **XAUUSD ingestion still stalled (High, F-01 carried).** Last 1m bar **2026-07-19 01:58 UTC** (~19.5h stale at audit). All XAUUSD caggs frozen at 01:45–02:00. XAUUSD features frozen at 2026-07-17 20:45 (compounding F2-01). The majority of active variants (all Gold/Key-Level/scalp families) trade XAUUSD.

3. **OANDA contamination contained to raw tables (improved).** `OANDA Corporation` rows are still being written to `candles_1m`/`candles_15m` (last write 2026-07-20 00:29 UTC, i.e. minutes before audit; EURUSD OANDA vs 1x Trade differs by **~20 pips** on identical timestamps). However, the canonical arbitration view (`market.candles_1m_canonical`, migration 127/131) now serves **100% `1x Trade Ltd.` + `synthetic` rows over the last 7 days** — the engine/live/backtest read path no longer sees OANDA. Severity downgraded from High to **Medium** (raw-store hygiene + audit confusion, not signal contamination).

4. **Producer-invariant storm recurred at small scale and is silent.** 500 `output_anchor_missing` errors in 48h (vs 86,775 in the Jul-17 storm), including 304 in one hour on 2026-07-18. No alert fired; the ledger was the only witness.

5. **Live execution is effectively dormant.** 30 days: 26 orders total, **2 in `live` mode** (1 rejected, 1 expired, both 2026-07-17), 24 paper (all rejected/expired), 0 fills, 0 realized P&L. Setup funnel: 4,618 evaluations → ~5 order-linked evaluations (0.1%). Top block: "No entry zone within 1.5 ATR" (125) — consistent with stale/frozen zone + ATR features.

6. **Backtest integrity remains good (verified again).** PIT discipline enforced (`trustStoredLifecycle: false` in backtester), 15m rollup parity exact (12/12 buckets, including partial buckets with tick_count 6–15), and **two consecutive identical runs of `backtest-pit-v2.js EURUSD 30 orb_classic --mode=fast --json` are byte-identical modulo timing fields**.

7. **`market_volatility_profile` is 9 days stale (High, new).** Latest `updated_at` = 2026-07-10. Every percentile-based volatility gate (`maxAtrPercentile`, `session*Percentile`, `regimeRelax`) is resolving percentiles against a 9-day-old distribution.

---

## 2. Audit scope and limitations

**In scope:** raw 1m candles + HTF caggs; canonical arbitration views; feature pipeline (engine DAG, cache, producer ledger, invariant); strategy/spec and setup funnel; backtester PIT/determinism; live execution path and lot sizing; volatility gates.

**Limitations:**
- Read-only DB access; no PM2/EA/host logs inspected. The MT5 EA spool state, `tz-ingestion` PM2 logs, and nginx logs were **not** reviewed — ingestion-stall root causes are inferred from data, not from process logs.
- The F2-01 anchor-freeze mechanism is isolated to the candle-source layer but not to a single line (see §6/S-01); a live reproduction with `TM_ENGINE_CANDLE_SOURCE=0` was not attempted (would require engine restart).
- Backtest-vs-live signal-by-signal reconciliation was not performed (only aggregate stats + determinism).
- `features_opening_range` session-scoped joins were not re-verified this round.

---

## 3. System/data-flow map

```
MT5 EA (1x Trade) ──bars──> nginx :3004 ──> tz-ingestion (scripts/ingestion-server.js)
                                                    │  (spool to logs/ingest-spool on DB error)
                                                    ▼
                              candles_1m (symbol, broker, ts PK)   <── OANDA EA also writes here (unrestricted)
                                                    │
              TimescaleDB caggs (broker-grouped, migration 096): candles_5m/15m/1h/4h/1d_utc
                                                    │
              Canonical arbitration views (migrations 127/129/131): market.candles_*_canonical
                                                    │   (quality-scored broker arbitration; currently 100% 1x Trade)
              ┌─────────────────────────────────────┼───────────────────────────────┐
              ▼                                     ▼                               ▼
   Engine DAGRunner (inline,            Setup engine / gates          PIT backtester
   pipelineTrigger.ts every 15m)        (liveRunner.ts,               (backtest-pit-v2.js,
   getRecentCandles(count-based)        volatilityGate etc.)          trustStoredLifecycle:false)
              │                                     │                               │
              ▼                                     ▼                               ▼
   features_* tables +                setup_evaluations →           backtest_runs/results
   feature_producer_runs (ledger)     orders (live|paper)
              │
   refresh-lifecycle cron (PM2 tz-refresh-lifecycle, every 6h)
   → lifecycle columns (is_fresh, mitigated_at, invalidated_at)
```

Key trust boundaries: (1) ingestion accepts any broker string — arbitration is done at read time, not write time; (2) the engine hot path reads canonical views via `getRecentCandles` with 1m-rollup fallback; (3) the producer ledger is the only freshness observability, and `assertProducerFresh` only filters `status='done'`.

---

## 4. Critical and high-severity findings

### F2-01 — Feature anchors frozen universe-wide since Fri 2026-07-17; all live decisions on 2.3-day-old features
- **Severity:** Critical. **Confidence:** Confirmed (mechanism Highly likely, see S-01 for the unresolved branch).
- **Affected:** `apps/engine/src/dag/runner.ts` (`fetchCandles` → `getRecentCandles`, `sourceMaxTs = candles[candles.length-1].ts`), `packages/shared/src/candles/candleSource.ts::getRecentCandles`, all `features_*` tables, all live variants.
- **Evidence:**
  - `features_atr`: `max(ts) = 2026-07-17 20:45` across ALL symbols/tfs (4.76M rows total, 0 rows after Jul-17 20:45). EURUSD 15m latest row `ts=2026-07-17T14:30` but `input_hash = 1.2.0:b107…:q1:EURUSD:15m:2026-07-19T21:30:51Z` — today's run re-upserting onto Friday's anchor.
  - Same freeze: `features_bias` (EURUSD 15m max 2026-07-17 14:30), `features_zone` (13:45), `features_ifvg`/`features_order_block`/`features_sweep` (max 2026-07-17 ~20:30–20:45), `features_direction_state`, `features_volatility_normalized` (XAUUSD 5m max 2026-07-17 20:45).
  - `feature_producer_runs` today: every (symbol, tf) shows `source_max_ts` ∈ {Jul-17 14:00/14:30/20:00/20:45}, `rows_seen=3, rows_inserted=3, status='done'` — e.g. USDCHF 1d run at 2026-07-19 21:30 with `source_max_ts=2026-07-17 00:00`.
  - Candles are NOT the constraint: `market.candles_1m_canonical` EURUSD max = 2026-07-19 21:38; 15m canonical max = 21:45 (3.5-min lag). **But** 1m canonical has an 11.05-hour gap `2026-07-17 14:37 → 2026-07-18 01:40`, and the 15m canonical has a matching hole: zero buckets between 14:30 Jul-17 and 01:30 Jul-18 (43 missing tradable buckets through the gap edge).
- **Expected:** each 15-minute pipeline trigger computes features anchored at the newest canonical candle (~now), and feature `max(ts)` tracks the data clock within minutes.
- **Actual:** anchors frozen at the edge of the Friday ingestion gap; engine runs recompute the identical tail window, re-upsert identical rows (hash changes only because `buildCacheInputHash` includes wall-clock `endTs`), and the forward-only event gate (`maxCandleTs <= lastTs → skip compute`, runner.ts ~L296–330) permanently suppresses recompute past the frozen anchor.
- **Why it matters / financial impact:** every volatility gate (ATR), bias filter, zone/FVG entry check, and direction arbiter is evaluating Friday-afternoon market state. Strategies either can't fire (stale zones → "No entry zone within 1.5 ATR", the #1 block reason) or — worse — could fire on geometry that no longer exists. ~60h of decisions are suspect.
- **Root-cause hypothesis:** the 11h 1m gap leaves <400 post-gap 15m bars in the canonical cagg (400-bar lookback = 100 hours ≫ post-gap data), so `getRecentCandles`' cagg read returns only the pre-gap tail and the deterministic 1m-rollup fallback either isn't triggering for the count-based path or never persists past the gap; `sourceMaxTs` therefore never advances past 2026-07-17 ~14:30/20:45 (per-symbol cagg edge), and every downstream mechanism (event gate, cache, ledger) treats the frozen window as current.
- **Recommended fix:**
  1. **Immediate:** repair the gap window — re-export EURUSD (and verify other pairs) M1 for 2026-07-17 14:37 → 2026-07-18 01:40 from MT5, `node scripts/backfill-candles-from-mt5-csv.js <dir> --tz-offset-minutes=180 --broker=MT5`, then `refresh-candle-caggs.js` and `backfill-historical-features.js <SYMS> 15m,1h,4h,5m --start 2026-07-17 --end 2026-07-19` (SK-66 procedure for derived features: leaf closure first, then `reconcile-direction-state.js`).
  2. **Code:** in `getRecentCandles`, when the returned series' trailing bucket lags `endTs` by more than N buckets AND the series is short of `count`, the 1m-rollup fallback must produce the full window (verify it does; the evidence suggests it doesn't or its result isn't used). Add a hard postcondition: returned `candles[last].ts` within 2 buckets of `endTs` or throw (fail loud, not stale).
  3. **Gate:** flip `TM_PRODUCER_STALE_ACTION=block` for dense features after §7 acceptance, and add a freshness assertion keyed on `features_atr.max(ts)` per (symbol, tf) — ATR is the dense canary.
- **Regression test:** integration test that injects an 11h hole into a 1m fixture, runs `getRecentCandles(15m, count=400)`, and asserts the returned series spans the hole (rollup) or throws; plus a ledger-level test that `source_max_ts` must be ≥ data-clock − 2×tf for dense features or the run is `error`.

### F2-02 — XAUUSD ingestion stalled ~19.5h (carried, unremediated)
- **Severity:** High. **Confidence:** Confirmed.
- **Affected:** `candles_1m` XAUUSD, all XAUUSD caggs/features/variants.
- **Evidence:** last 1m `2026-07-19T01:58` (1x Trade; audit now() = 21:24+). Caggs frozen: 5m 01:55, 15m 01:45, 1h 01:00, 4h/1d 00:00. XAUUSD `features_*` max = 2026-07-17 20:45 (F2-01 compounding). All other pairs current to 21:23–21:39.
- **Expected:** XAUUSD streams 24/5 like the other 8 pairs.
- **Actual:** no bars for ~19.5h on the Sunday open / late Saturday session.
- **Why it matters:** XAUUSD hosts the majority of active variants (Key-Level Bounce v4–v8c, Gold scalpers, watukushay, five_one_scalp…). Historically ~82% of dollar P&L. Zero new signals possible; open positions unmanaged by current data.
- **Root-cause hypothesis:** EA/terminal for metals not streaming since Sat 01:58 (weekend EA silence class of bug — but AGENTS notes the TimeLocal fix should cover weekends; possibly terminal closed, EA chart removed, or 1xTrade metals feed halted Sat early). Needs EA/host log access.
- **Recommended fix:** check MT5 terminal + EA Experts log; verify `tz-ingestion` spool empty and `/health` ok; confirm 1xTrade metals trading hours (some brokers halt metals Sat 00:00 → Sun 22:00 — if so this is *expected* and coverage calendar should model it like the daily break). **First establish whether the feed was even offered.**
- **Regression test:** per-symbol ingestion watchdog alert if `max(ts)` lags > 3× the symbol's expected bar interval during tradable hours (marketCalendar already supports per-symbol breaks; extend to broker hours).

### F2-03 — `market_volatility_profile` 9 days stale; percentile volatility gates drifting
- **Severity:** High. **Confidence:** Confirmed.
- **Affected:** `packages/tradePipeline/src/gates/volatilityGate.ts` (percentile mode), `market_volatility_profile` producer (scheduled job not running).
- **Evidence:** `SELECT max(updated_at) → 2026-07-10T12:09`, `sample_end ≤ 2026-07-10`. All rows XAUUSD 5m/15m only. Meanwhile `features_volatility_normalized` (the newer path) is also frozen at 2026-07-17 20:45 (F2-01).
- **Expected:** percentile profile refreshed daily (documented 24h max-age for distribution features).
- **Actual:** 9-day-old p05–p99 distributions; `maxAtrPercentile`/`session*Percentile`/`regimeRelax.relaxToPercentile` (fixed in SK-62 to actually resolve) resolve against July-10 volatility.
- **Why it matters:** July 10–17 saw materially different ATR regimes; gates can pass/block setups against the wrong distribution. Direct input to the families that produced the only live orders this month.
- **Fix:** find and re-enable the profile refresh job (search PM2 ecosystem for the producer; it has written nothing since Jul-10); add `assertProducerFresh` for `market_volatility_profile` with 24h max-age.
- **Regression test:** freshness gate test: profile `updated_at` older than 24h → gate refuses percentile mode (fail closed) rather than resolving stale percentiles.

---

## 5. Medium and low-severity findings

### F2-04 — OANDA rows still written to raw tables; 20-pip divergence vs canonical (downgraded)
- **Severity:** Medium. **Confidence:** Confirmed.
- **Affected:** `scripts/ingestion-server.js` (no broker allow-list), `candles_1m/5m/15m` raw tables.
- **Evidence:** OANDA rows last 7d: AUDUSD 6,406, USDCHF 6,416, USDCAD 6,458, USDSEK 5,603, EURUSD 3,086, GBPUSD 3,093, USDJPY 3,101, NZDUSD 6,412 — last write **2026-07-20 00:29 UTC** (minutes before audit; note also a +3h clock skew vs 1x Trade rows, OANDA timestamps run ahead: OANDA `00:29` vs 1x `21:39` — **this timestamp skew is itself suspicious**, see S-03). Same-ts EURUSD open divergence up to **21.9 pips** (Jul-17 11:07). Contamination into broker-grouped caggs confirmed (OANDA 15m rows through 00:15).
- **Mitigating:** `market.candles_*_canonical` served 100% 1x Trade/synthetic over 7d (82,384 + 6,395 rows); engine/backtest/web read canonical → no signal contamination. Test brokers (`smoke-test`, `test`) remain in `candles_1m` (2 rows each + 2 from 2024).
- **Why it matters:** any future consumer that forgets the canonical view (or any raw-table audit query) silently mixes a 20-pip-off feed; the morning audit's rollup-parity check would have compared garbage had it not filtered broker.
- **Fix:** enforce broker allow-list at ingestion (`scripts/ingestion-server.js` validates against a registry; reject 400 unknown brokers); execute the long-pending delete of OANDA/test rows (needs `TM_ALLOW_DESTRUCTIVE=1` path); keep arbitration as defense-in-depth.
- **Regression test:** ingestion-server unit test: unknown broker → 400, never inserted; CI query asserting `count(*) WHERE broker NOT IN (registry)` = 0.

### F2-05 — Producer-invariant error tail continues (500 errors/48h), no alerting
- **Severity:** Medium. **Confidence:** Confirmed.
- **Affected:** `apps/engine/src/dag/runner.ts` + `producerInvariant.ts`; observability stack.
- **Evidence:** `feature_producer_runs` 48h: 500 errors / 207,181 runs. Bursts: 304 errors in the 2026-07-18 19:00 hour (62,984 runs — a mass backfill?), 96 at 16:00, 32 at 2026-07-19 06:00. `features_atr` dominates (86,969 lifetime `output_anchor_missing`), plus `features_pricing` (354), `features_pivot` (182 `output_anchor_stale` + 53 missing), `features_keltner` (3), `features_session` (1). 15 `deadlock detected` on `features_zone` (last Jul-13). 245 `chk_atr_not_zero` rejections (last Jul-14).
- **Expected:** invariant failures are pageable events; a 304-error hour should alert.
- **Actual:** silent; only discoverable by querying the ledger.
- **Fix:** backoff/circuit-breaker per (feature, symbol, tf) after N consecutive invariant failures; Prometheus/log alert on `feature_producer_runs.status='error'` rate; investigate why `features_pivot` anchor runs stale (it emits `ts` behind source — same class as SK-61 iFVG bug).
- **Regression test:** ledger monitor test: synthetic run with output anchor < source anchor → invariant `error` + alert hook fired.

### F2-06 — `features_direction_state` stub rows outside EURUSD; EURUSD itself frozen
- **Severity:** Medium. **Confidence:** Confirmed.
- **Affected:** `features_direction_state`, `scripts/reconcile-direction-state.js`.
- **Evidence:** non-EUR pairs: 1–3 rows per tf (stubs), all ≤ 2026-07-17 20:45; EURUSD healthy historically (17,703 @5m, 5,835 @15m) but max ts = 2026-07-17 14:35 (F2-01). XAUUSD present at all tfs but same freeze. 0 rows in 48h. Latest EURUSD 15m row: `direction=neutral, confidence=0, regime=trending` with htfAlignment/hhhl/structure/emaSlope/volume/session all 0 — a **degenerate "neutral" state being fed to any `regimeRelax` consumer**.
- **Fix:** as morning audit: document the intentional-empty set; schedule reconcile for consumers; and unfreeze via F2-01 repair.
- **Regression test:** freshness assert per documented consumer (symbol, tf); degenerate-score detector (all sub-scores 0 for >N hours → warn).

### F2-07 — DXY synthetic feed dead since 2026-07-17 14:37
- **Severity:** Medium. **Confidence:** Confirmed.
- **Affected:** `candles_1m` DXY (`broker='synthetic'`), `features_correlation` consumers.
- **Evidence:** DXY max ts 2026-07-17T14:37 (54.8h stale), 12,433 rows/7d then nothing. DXY 4h/1d bias stale since Jul-14/17.
- **Why it matters:** correlation features against DXY read stale legs; HTF bias for DXY-based filters drifts.
- **Fix:** restore the synthetic DXY producer cron; add freshness gate.
- **Regression test:** `assertProducerFresh` for DXY 1m.

### F2-08 — Setup funnel conversion remains ~0.1%; block mix consistent with stale features
- **Severity:** Medium (economic), Low (correctness). **Confidence:** Highly likely linkage to F2-01.
- **Evidence:** 30d: 3,435 `waiting`, 1,177 `blocked`, 6 null-status; only ~6 evaluations carry `order_id`. Block reasons: "No entry zone within 1.5ATR" (125), "HTF bias BLOCK (short) vs setup (long)" (17), "No active FVG aligned" (4), "No active zones" (3). Evals by hour last 24h: 2,867 at 16:00, 159 at 13:00, 2 at 17:00 — bursty, not continuous.
- **Why it matters:** the system is safe-by-starvation: it cannot lose money, but it also cannot make any.
- **Fix:** unblock F2-01/F2-02, then re-baseline the funnel before any strategy tuning.
- **Regression test:** funnel health check: if evals/day > 0 but order-linked evals/30d < threshold with top block reason = zone-distance, assert feature freshness first (self-diagnosing funnel).

### F2-09 — Lot sizing: fixed 0.01 default masks sizing config failures
- **Severity:** Low. **Confidence:** Confirmed (code), Unverified (production impact).
- **Affected:** `packages/tradePipeline/src/orderExecutor.ts::computeLotSize`.
- **Evidence:** any missing `riskPerTradePct`/`accountBalance`, non-positive SL distance, or missing pip metadata silently returns `fixedLotSize ?? 0.01`. Grade-based sizing (A+ → 0.05…) and profit-based sizing exist but every failure mode degrades to 0.01 lots without logging.
- **Why it matters:** a misconfigured live config would quietly trade 0.01 lots (under-risking is safe but hides the misconfiguration; the inverse — a bad `maxLot` env — is capped at 50).
- **Fix:** log a warning whenever the fallback path is taken; include sizing path in the order trace.
- **Regression test:** unit test: missing balance → fallback + warning emitted.

---

## 6. Suspicious observations requiring more evidence

- **S-01 — F2-01 mechanism, branch (a) vs (b):** either `getRecentCandles` returns the pre-gap cagg tail without triggering rollup (short-series case: `cagg.length < 2` returns early; but the tail has ≥2 rows…), or the rollup fires but `filterTradableCandles`/gap logic drops the result, or rollup is not attempted for count-based reads at all. **Reproduce:** with the gap unrepaired, call `getRecentCandles(pool,'EURUSD','15m',now,400)` directly and inspect the returned series; then `TM_ENGINE_CANDLE_SOURCE=0` on one engine replica. Needs a staging run, not done here.
- **S-02 — Why did the 11h gap happen Fri 14:37?** All forex pairs gap together (EURUSD shown; check others), suggesting a shared cause: ingestion server down, nginx route failure, DB admin-kill (the Jul-6 class of outage), or broker feed halt. The spool should have caught a DB outage — check `logs/ingest-spool/*.jsonl` for 2026-07-17 14:37 → 2026-07-18 01:40 and PM2 logs for `tz-ingestion`.
- **S-03 — OANDA timestamps run ~3h ahead of wall clock** (`max ts = 2026-07-20 00:29` vs DB now 2026-07-19 ~21:30). Either the OANDA EA exports with a +3 tz-offset (server time mislabeled as UTC) or its clock is wrong. If the offset is real, OANDA rows are also *misaligned*, not just divergent — another reason they must never leak into canonical reads.
- **S-04 — The 2026-07-18 19:00 burst of 62,984 producer runs** (vs ~2,300/hour baseline) with 304 errors — looks like an unlogged mass backfill. Who ran it, and did it write the `:q1:` re-upserts? Check `feature_producer_runs` for `producer != 'engine'` in that hour (only `historical_backfill` seen: 2 runs, 42,480 rows into `features_volatility_normalized`).
- **S-05 — Setup-evaluation burst pattern** (2,867 evals in one hour, then near-zero) suggests evaluations are batch-triggered, not per-bar — verify the trigger cadence matches design.

## 7. Raw-candle and timeframe-alignment analysis

- **Integrity:** zero geometrically corrupt rows (`h<l`, non-positive, non-finite) across `candles_1m`. `candle_quality` suspects: only 2 USDSEK rows (last 2026-07-06), consistent with the documented wide-spread exotic policy.
- **Rollup parity:** 15m cagg vs 1m aggregation for EURUSD (1x Trade, last 4h): **12/12 buckets bit-exact** on o/h/l/c, including partial buckets (tick_count 6 vs 15). Aggregation math is correct.
- **HTF freshness:** all non-XAUUSD pairs: 15m cagg current to 00:15 (Jul-20, OANDA skew aside, canonical 21:45, ~3.5-min refresh lag — healthy). XAUUSD frozen (F2-02). DXY frozen (F2-07).
- **Alignment defects:** (1) the 11h 1m gap Fri 14:37 → Sat 01:40 across forex pairs (S-02); (2) minor 4–5-minute 1m gaps Sun 20:59–21:19 (3 gaps, likely Sunday-open thin feed — informational); (3) OANDA +3h timestamp skew (S-03).
- **Coverage context:** EURUSD 30d 1m rows = 40,146 vs ~43,200 expected (30d × 1,440 × 5/7) — the 11h gap plus micro-gaps explain the shortfall; features_bias 15m density 0.69 over 30d matches weekend-free calendar expectation (~0.71) — healthy, not a finding.

## 8. Reconstructed signal case studies

- **The only 2 live orders (2026-07-17):** `orders` live: one rejected (08:45) and one expired (09:00) on Jul-17. Both predate the 14:37 gap — i.e., the last live order attempts happened hours *before* the feature freeze. Since then: zero live order attempts, consistent with the funnel starving on frozen zones/ATR (F2-01 → F2-08).
- **Degenerate direction_state feeding gates:** EURUSD 15m latest `features_direction_state`-adjacent bias row reads `neutral/confidence=0` with all sub-scores 0 — any consumer with `regimeRelax` predicated on this state is relaxing/blocking against a non-informative row. Reconstruct: `SELECT * FROM features_bias WHERE symbol='EURUSD' AND tf='15m' ORDER BY ts DESC LIMIT 1` → reason string `"neutral trending | confidence=0 | htfAlignment=0, hhhl=0, structure=0, emaSlope=0, volume=0, session=0, volatility=+93"`.
- **Top block reason traces to frozen data:** "No entry zone within 1.5 ATR" (125/30d) — zones frozen at Jul-17 13:45 (`features_zone` EURUSD 15m max) while price moved on; entries can't be "within 1.5 ATR" of stale zones at current price.

## 9. Backtest-integrity assessment

- PIT discipline: backtester compiles with `trustStoredLifecycle: false` (recomputes lifecycle PIT-correctly) — confirmed per AGENTS contract, and live uses `true` (pipelineTrigger.ts:117). Asymmetry is intentional — **do not align**.
- Preflight quality gate: `dataQuality: "READY"` for EURUSD 30d orb_classic; coverage table reports `features_bias` 15m density 0.6904 without flagging (matches calendar expectation).
- Gate instrumentation works: run reported `gateSkips.volatility=3`, executed 8/12 raw signals, WR 0%, Net R −2.09 — plausible outputs, no fabricated fills.
- **Caveat:** backtests over windows ≤ the last 3 days inherit the F2-01 data freeze (features_* frozen), so recent-window backtests and live share the same stale-feature blind spot; pre-Jul-17 windows are unaffected because the backtester recomputes PIT.

## 10. Live-versus-backtest consistency assessment

- Live and backtest read the **same canonical candle relations** and the same feature tables; the intentional `trustStoredLifecycle` split is the only structural divergence and is correct-by-design.
- Live execution layer adds gates the fast backtest profile skips (`--mode=fast` → `setupProfile: skip`); full/deterministic modes exist for parity runs but were not exercised this round beyond the determinism check.
- Recent consistency cannot be validated while F2-01 persists: live features are frozen, so any live-vs-backtest diff over the last 3 days would compare two stale systems and "agree" spuriously.

## 11. Reproducibility and determinism results

- **PIT backtester deterministic (verified):** two consecutive runs of `node scripts/backtest-pit-v2.js EURUSD 30 orb_classic --mode=fast --json` (identical inputs, ~2 min apart) produced **byte-identical JSON modulo timing fields** (`queryMs`, `durationMs`, `generatedAt`, `totalMs`). No `Math.random()`/wall-clock leakage in the signal path for this configuration. (The default `--intrabar=random_walk` mode was not tested; per its name it requires a seeded RNG to be deterministic — flag for follow-up.)
- **Feature pipeline non-deterministic in a bad way:** `buildCacheInputHash` embeds wall-clock `endTs`, so identical inputs produce distinct hashes every run — cache-busting by construction. This is what allowed the F2-01 re-upserts to masquerade as fresh writes. Recommend hashing the **data clock** (`sourceMaxTs`) instead of wall clock for dense features.

## 12. Recommended fixes, prioritized by risk

| # | Priority | Fix | Addresses |
|---|----------|-----|-----------|
| 1 | P0 | Repair the Fri 14:37→Sat 01:40 1m gap (MT5 re-export → backfill-candles → refresh-caggs → backfill features incl. reconcile-direction-state) | F2-01 |
| 2 | P0 | Add postcondition to `getRecentCandles`/engine: dense feature run whose `sourceMaxTs` lags data clock by >2 buckets → throw/alert, never upsert stale rows | F2-01 |
| 3 | P0 | Investigate + restore XAUUSD feed (EA logs; confirm broker metals hours) | F2-02 |
| 4 | P1 | Flip `TM_PRODUCER_STALE_ACTION=block` for dense features after P0 items green; add ATR freshness canary per (symbol,tf) | F2-01/05 |
| 5 | P1 | Restore `market_volatility_profile` refresh job; fail closed on stale percentiles | F2-03 |
| 6 | P1 | Alerting on `feature_producer_runs.status='error'` rate; circuit breaker per (feature,symbol,tf) | F2-05 |
| 7 | P2 | Ingestion broker allow-list; delete OANDA/test rows via guarded migration; investigate S-03 tz skew | F2-04 |
| 8 | P2 | Restore DXY synthetic producer | F2-07 |
| 9 | P2 | Hash data clock (not wall clock) in `buildCacheInputHash` for dense features | §11 |
| 10 | P3 | Log lot-size fallback path in order trace | F2-09 |

## 13. Proposed regression tests

1. `candleSource.gap.test.ts`: 11h 1m hole → `getRecentCandles(15m, count=400)` must span the hole via rollup or throw; never return a silently-short pre-gap series.
2. `producerInvariant.freshness.test.ts`: dense run with `outputMaxTs < dataClock − 2×tf` → status `error`, reason `output_anchor_stale`, and no rows upserted onto old ts.
3. `pipeline.e2e.test.ts`: simulated 15m trigger after an ingestion gap → `features_atr.max(ts)` advances past the gap within one trigger cycle post-repair.
4. `volatilityGate.staleProfile.test.ts`: profile `updated_at` > 24h → percentile mode refuses (fail closed).
5. `ingestion.brokerAllowlist.test.ts`: unknown broker → HTTP 400, zero rows.
6. `backtest.determinism.test.ts`: two runs, fixed variant/window → identical JSON modulo timing whitelist (encode §11 result as CI).
7. `funnel.selfDiagnose.test.ts`: order-linked evals ≈ 0 with top block = zone-distance → assert feature freshness first.

## 14. Exact commands and queries used

All queries executed inside `BEGIN READ ONLY … ROLLBACK` against `tradzfx_v2`, 2026-07-19 ~21:20–21:50 UTC, via ad-hoc scripts `_tmp_audit_v2.js` … `_tmp_audit_v19.js` (credentials loaded from `.env.local`, `pg` client, `statement_timeout=60–120s`).

Key queries (abridged):

```sql
-- candle freshness / staleness
SELECT symbol, count(*), max(ts), round(extract(epoch FROM now()-max(ts))/3600.0,2) AS stale_hours
FROM candles_1m WHERE ts > now()-interval '30 days' GROUP BY symbol;

-- broker inventory & OANDA divergence
SELECT symbol, broker, count(*), min(ts), max(ts) FROM candles_1m GROUP BY 1,2;
SELECT a.ts, a.o AS oanda_o, b.o AS x1_o, round((a.o-b.o)::numeric,6) AS diff
FROM candles_1m a JOIN candles_1m b USING (symbol, ts)
WHERE a.symbol='EURUSD' AND a.broker='OANDA Corporation' AND b.broker='1x Trade Ltd.'
  AND a.ts > now()-interval '3 days' ORDER BY abs(a.o-b.o) DESC LIMIT 10;

-- canonical arbitration freshness + broker mix
SELECT symbol, max(ts), count(*) FROM market.candles_1m_canonical
WHERE ts > now()-interval '7 days' GROUP BY symbol;
SELECT broker, count(*) FROM market.candles_1m_canonical
WHERE ts > now()-interval '7 days' GROUP BY broker;   -- 100% 1x Trade + synthetic

-- feature freeze evidence
SELECT tf, count(*), max(ts) FROM features_atr GROUP BY tf;               -- all ≤ Jul-17 20:45
SELECT ts, input_hash FROM features_atr WHERE symbol='EURUSD' AND tf='15m'
ORDER BY ts DESC LIMIT 3;                                                  -- hash endTs = today, ts = Friday
SELECT symbol, tf, max(source_max_ts), count(*) FROM feature_producer_runs
WHERE started_at > now()-interval '3 hours' AND status='done' AND producer='engine'
GROUP BY 1,2;                                                              -- source_max frozen Jul-17

-- the gap
SELECT prev, ts, extract(epoch FROM ts-prev)/60 AS gap_minutes FROM (
  SELECT ts, lag(ts) OVER (ORDER BY ts) prev FROM market.candles_1m_canonical
  WHERE symbol='EURUSD' AND ts >= '2026-07-17 14:00' AND ts <= '2026-07-19 21:30'
) s WHERE ts-prev > interval '2 minutes';                                  -- 663-minute gap

-- producer errors
SELECT date_trunc('hour', started_at), count(*) FILTER (WHERE status='error'), count(*)
FROM feature_producer_runs WHERE started_at > now()-interval '48 hours'
GROUP BY 1 ORDER BY 1 DESC;

-- volatility profile staleness
SELECT symbol, tf, period, session, updated_at, sample_end
FROM market_volatility_profile ORDER BY updated_at DESC LIMIT 12;          -- max updated_at Jul-10

-- funnel & orders
SELECT setup_status, count(*) FROM setup_evaluations
WHERE created_at > now()-interval '30 days' GROUP BY 1;
SELECT status, trade_mode, count(*), max(created_at) FROM orders
WHERE created_at > now()-interval '30 days' GROUP BY 1,2;

-- rollup parity
-- (15m cagg vs 1m array_agg/max/min over last 12 buckets, broker-filtered) → 12/12 exact
```

Commands:

```bash
node scripts/backtest-pit-v2.js EURUSD 30 orb_classic --mode=fast --json   # ×2 → byte-identical modulo timing
node _tmp_audit_v2.js … _tmp_audit_v19.js                                   # read-only probes (this audit)
```

## 15. Appendix: open questions and next steps

**Open questions:**
1. S-01: which exact branch in `getRecentCandles` lets `sourceMaxTs` freeze — short-cagg-series path or rollup-not-persisted? (Staging repro planned.)
2. S-02: what caused the Fri 14:37 → Sat 01:40 ingestion gap? Check `logs/ingest-spool/`, PM2 `tz-ingestion` logs, and host uptime.
3. S-03: is the OANDA feed's +3h timestamp skew a tz-offset bug in its EA/export?
4. S-04: what launched 62,984 producer runs on 2026-07-18 19:00?
5. Is the XAUUSD Saturday halt a broker schedule (expected) or an outage (F2-02)?
6. Does `--intrabar=random_walk` use a seeded RNG? (Determinism follow-up.)

**Next steps (in order):**
1. Execute fix #1–#2 (gap repair + stale-upsert postcondition) — re-run this audit's freshness queries to confirm `features_atr.max(ts)` advances within one 15m trigger.
2. Re-run `pnpm db:seed:check` + a full-mode PIT backtest (`--mode=full`) on one XAUUSD and one EURUSD variant post-repair to re-baseline the funnel.
3. Implement alerting (fix #6) before the next weekend.
4. Update `AGENTS.md` with the F2-01 incident once root cause is confirmed (S-01) — the "producer ledger tells the truth" contract needs an addendum: `status='done'` with frozen `source_max_ts` must itself be an alertable condition.
5. Clean up ad-hoc audit scripts (`_tmp_audit_*.js`, `_tmp_det*.json`) after fixes are verified.
