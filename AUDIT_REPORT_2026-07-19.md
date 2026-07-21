# tradzfx-v2 Multidisciplinary Audit — 2026-07-19

Audit team model: quantitative research, algorithmic trading, market-data engineering, backtesting, TypeScript/Node.js, database engineering, risk analysis.
Method: live read-only DB queries against `tradzfx_v2` (TimescaleDB), static code review, existing artifact cross-reference (`AUDIT_SUMMARY.txt`, `DATA_INTEGRITY_AUDIT_INDEX.md`, repo memory notes), and a determinism spot-check of the PIT backtester.

---

## 1. Executive Summary

The system is **operationally degraded but structurally sound**. The core value chain — ingestion → caggs → features → compiled strategy SQL → backtest — is deterministic and, where verified, mathematically exact (15m rollup matches 1m aggregation bit-for-bit). However, **live trading output is near-zero**: 4,618 setup evaluations in 30 days produced only **8 live signals** (last on 2026-07-17), and the primary money-making instrument **XAUUSD stopped streaming ~18 hours before the audit**.

The dominant themes:

1. **Event features are dead in production** (`features_ifvg`, `features_order_block` produced 6 rows total in 2 days), caused by `skipLifecycle: true` on the hot inline path — a regression confirmed by the 2026-07-17 investigation and still unremediated.
2. **Multi-broker contamination persists**: `OANDA Corporation` rows are still being written (last 2026-07-17) despite the documented fix to delete OANDA/MT5 and restrict to `1x Trade Ltd.`. Test brokers (`smoke-test`, `test`) are also present in `candles_1m`.
3. **XAUUSD ingestion stall** (last 1m bar 2026-07-19 01:58 UTC) froze its HTF caggs and starved the XAUUSD-driven strategies that account for ~82% of dollar P&L.
4. **A 19-minute producer-invariant storm** on 2026-07-17 (86,775 `output_anchor_missing` errors on `features_atr` EURUSD 15m) indicates a transient but violent pipeline failure mode.
5. **Backtest integrity is good**: PIT discipline is enforced (`trustStoredLifecycle: false` in the backtester), the preflight quality gate works (XAUUSD 30d verdict `READY`), and repeated identical runs are deterministic except for wall-clock `queryMs`.

Financial impact is concentrated in opportunity cost: with XAUUSD stalled and event features dead, the two live XAUUSD strategies (`doyle_sd`, `watukushay_no1`) cannot fire, idling the primary P&L driver.

---

## 2. Audit Scope & Limitations

**In scope:** raw 1m candles, HTF continuous aggregates, feature producers/ledger, event-feature lifecycle, strategy compilation, setup engine, gates, backtest PIT/intrabar/preflight, live-vs-backtest asymmetry, risk sizing math, determinism.

**Limitations:**
- Live MT5/MT4 terminal state (EA spool contents, terminal logs) not directly inspected; ingestion stall inferred from DB watermarks.
- The 87k-error storm was transient and over by audit time; root cause inferred from error text and code, not reproduced.
- No write operations were performed (read-only audit). Proposed fixes are not applied.
- Risk-of-ruin / portfolio heat math reviewed statically, not backtest-simulated under the current degraded data.

---

## 3. System / Data-Flow Map

```
MT5/MT4 EA (OnTimer, TimeLocal scheduling, spool on failure)
   │  POST /api/ingest/mt5/bars  (nginx exact-match → :3004)
   ▼
scripts/ingestion-server.js  ──spool──► logs/ingest-spool/*.jsonl (drain loop)
   │  UPSERT  PRIMARY KEY (symbol, broker, ts)
   ▼
candles_1m  ──TimescaleDB continuous aggregates──► candles_5m/15m/1h/4h/1d_utc/1d_ny
   │
   ├─► apps/engine DAG runner  (offline backfill + scoped recompute)
   │      producers → feature tables (features_*) → feature_producer_runs ledger
   │
   └─► apps/web pipelineTrigger.ts  (inline 15m trigger, hot path)
          runFeatureEngine( requestedFeatures, skipLifecycle: true )   ← regression source
          non-blocking 25s Promise.race lifecycle
   ▼
packages/strategies  (YAML spec → sqlBuilder/compiler → SQL per variant)
   ▼
setup engine  → setup_evaluations  → gates (spread / volatility / producer-freshness / heat)
   ▼
packages/tradePipeline/orderExecutor.ts  → live_signal / orders → MT5/MT4
   ▲
backtest: scripts/backtest-pit-v2.js (PIT, trustStoredLifecycle:false, preflight gate)
```

Key documented asymmetries (intentional, per AGENTS.md): `trustStoredLifecycle` = true live / false backtest; `candles_1d_utc` canonical vs `candles_1d_ny` auxiliary.

---

## 4. Critical & High-Severity Findings

### F-01 — XAUUSD ingestion stalled ~18h; HTF caggs frozen
- **Severity:** Critical  **Confidence:** Confirmed
- **Location:** `candles_1m`, `candles_5m/15m/1h`, ingestion path `scripts/ingestion-server.js` + EA.
- **Evidence:** `MAX(ts)` XAUUSD `1x Trade Ltd.` = `2026-07-19 01:58:00Z`; `candles_15m` max `01:45`, `candles_1h` max `01:00`; other pairs current to `20:15`. `now()` at query = `2026-07-19 20:18Z`.
- **Expected:** continuous 24/5 XAUUSD stream (broker confirmed streaming through holidays per AGENTS.md).
- **Actual:** ~18h gap; no new 1m bars since 01:58.
- **Why it matters:** XAUUSD drives ~82% of dollar P&L across `doyle_sd` and `watukushay_no1`. A stalled feed idles the primary revenue source and silently degrades any feature depending on fresh XAUUSD candles. This mirrors the Jul 6–7 39h outage pattern (ingestion not surviving an upstream event).
- **Root-cause hypothesis:** EA/terminal disconnect or ingestion-server stall; not a DB write failure (other symbols writing). The ingest-resilience layers (EA spool, server spool) should have prevented data loss but did not keep the stream alive.
- **Recommended fix:** restart/verify EA on the XAUUSD terminal; confirm `tz-ingestion` PM2 health (`GET :3004/health`); after recovery, backfill from MT5 CSV (`backfill-candles-from-mt5-csv.js`), `refresh-candle-caggs.js`, and re-run `backfill-historical-features.js XAUUSD 5m,15m,1h` for the gap window.
- **Regression test:** alert when `now() - MAX(candles_1m.ts)` per active symbol exceeds 5 minutes during tradable hours (`isTradableInstant`), wired into `ops/monitor-v2-health.ps1`.

### F-02 — Event features dead in production (ifvg / order_block)
- **Severity:** High  **Confidence:** Confirmed
- **Location:** `apps/web/src/lib/pipelineTrigger.ts:212` (`skipLifecycle: true`), `features_ifvg`, `features_order_block`.
- **Evidence:** past 2 days, `features_ifvg` = 4 rows (1m) + 1 row (5m), `features_order_block` = 1 row — all XAUUSD, all max `2026-07-17`. Producer ledger shows ATR/bias advancing every 15 min but event tables idle.
- **Expected:** lifecycle/maintenance produces event rows on schedule; inline hot path is supposed to be non-blocking but not the only producer.
- **Actual:** the only live compute path (inline `runFeatureEngine`) skips lifecycle, and the scheduled maintenance (`refresh-lifecycle` PM2) is not creating new event rows — so event features are effectively frozen.
- **Why it matters:** strategies keyed on iFVG / order-block setups (several `gold_scalp_*`, `five_one_scalp_*`) cannot evaluate fresh setups; silently reduces signal flow.
- **Root-cause hypothesis:** `skipLifecycle: true` on the hot path removed the only producer invocation that was creating event rows; the PM2 lifecycle cron is either not running or not covering event tables.
- **Recommended fix:** verify `tz-refresh-lifecycle` PM2 job runs `refresh-lifecycle.js ALL 2 5000` on the documented 15–30 min cadence and that it emits event rows; add `assertProducerFresh` on event tables; reintroduce event-row creation independent of the inline skip.
- **Regression test:** integration test asserting `features_ifvg`/`features_order_block` receive ≥1 row per symbol per hour during market hours; ledger `feature_producer_runs` row per run.

### F-03 — Producer-invariant error storm (87k `output_anchor_missing`)
- **Severity:** High  **Confidence:** Likely
- **Location:** `apps/engine/src/dag/producerInvariant.ts:61`, ledger `feature_producer_runs`.
- **Evidence:** 86,775 errors `producer invariant failed: output_anchor_missing` on `features_atr` EURUSD 15m between `2026-07-17 17:27:28` and `17:46:59` (~4,567/min), plus 245 `chk_atr_not_zero` CHECK violations, scattered `output_anchor_stale` (pivot), and 15 `deadlock detected` (features_zone).
- **Expected:** producer invariant failures are exceptional and rate-limited.
- **Actual:** a tight retry loop generated ~87k failed runs in 19 minutes.
- **Why it matters:** hammering the DB with failing inserts risks pool exhaustion, lock contention (consistent with the deadlocks), and masks real failures in log noise. Also indicates the invariant can be tripped by a transient upstream condition and then retried with no backoff.
- **Root-cause hypothesis:** an upstream anchor (source candle window) briefly absent/misaligned; the caller retried immediately with no backoff/circuit-breaker. The deadlocks suggest concurrent zone lifecycle writes collided during the same window.
- **Recommended fix:** add exponential backoff + circuit breaker around producer retries; log-and-skip rather than hot-loop on invariant failure; alert on error rate > N/min.
- **Regression test:** unit test that a persistent `output_anchor_missing` condition produces bounded retries (e.g. ≤3) then opens the circuit.

### F-04 — Multi-broker contamination not remediated (OANDA + test brokers)
- **Severity:** High  **Confidence:** Confirmed
- **Location:** `candles_1m.broker`, ingestion server allow-list.
- **Evidence:** `OANDA Corporation` rows present for EURUSD (4,310), GBPUSD (9,578), AUDUSD (14,444), last write `2026-07-17 23:59`; `smoke-test` rows (2 per symbol, Jul 7) and `test` rows (2024) still present. MT5 broker rows persist (dead since Apr/Jul 7).
- **Expected:** single canonical broker (`1x Trade Ltd.`) after the documented 2026-07-17 fix; OANDA/MT5 deleted.
- **Actual:** the cleanup was not executed; OANDA kept writing until Jul 17.
- **Why it matters:** caggs aggregate over `candles_1m` regardless of broker, so duplicate/conflicting bars from a second broker double-count buckets and corrupt HTF OHLC and any feature reading them (the exact issue flagged in the 2026-07-17 investigation). This directly threatens backtest integrity and live feature values.
- **Root-cause hypothesis:** the OANDA feed was never disabled at the source and the `DELETE`/allow-list step was deferred.
- **Recommended fix:** disable the OANDA source, `DELETE FROM candles_1m WHERE broker IN ('OANDA Corporation','MT5','smoke-test','test')`, enforce a server-side broker allow-list in `ingestion-server.js`, then `refresh-candle-caggs.js` over the affected range.
- **Regression test:** ingestion server rejects any batch whose broker is not in the allow-list (400); a periodic query asserts `COUNT(DISTINCT broker)=1` per symbol.

---

## 5. Medium & Low-Severity Findings

### F-05 — `features_direction_state` 2-row artifacts on non-consumer pairs
- **Severity:** Medium  **Confidence:** Confirmed
- **Location:** `features_direction_state`, `scripts/reconcile-direction-state.js`.
- **Evidence:** AUDUSD/GBPUSD/NZDUSD/USDCAD/USDCHF/USDJPY/USDSEK have exactly 1–2 rows per tf (max `2026-07-17`), EURUSD healthy (5,835 @15m, 17,703 @5m), XAUUSD absent. Past 2 days: **0 rows** anywhere.
- **Expected:** either fully reconciled per documented consumer set (XAUUSD 1h/15m = 100%) or intentionally empty; not a 2-row stub.
- **Actual:** partial reconcile left stub rows; the reconcile is not running on a schedule.
- **Why it matters:** any future strategy that keys on `direction`/`regime` for a stub pair will silently read stale/absent state.
- **Fix:** document the intentional-empty set; run `reconcile-direction-state.js <SYM> <tf>` on demand or schedule it for newly-promoted consumers. **Test:** freshness assert per documented consumer (symbol, tf).

### F-06 — HTF bias (4h/1d) and DXY synthetic feed stale
- **Severity:** Medium  **Confidence:** Confirmed
- **Evidence:** DXY synthetic 1m max `2026-07-17 14:37`; `features_atr/bias` 4h watermark `2026-07-17 12:00`, 1m watermark `2026-07-17 14:38`. Matches 2026-07-17 investigation (#5).
- **Why it matters:** HTF bias gates reference 4h/1d; staleness biases directional filtering. DXY feeds correlation features.
- **Fix:** include 4h/1d bias in the pipeline trigger feature set or a scheduled backfill; restore the DXY synthetic producer.
- **Test:** freshness gate on `features_bias@4h/1d` and `candles_1m` for DXY.

### F-07 — `features_atr` `chk_atr_not_zero` CHECK violations (245)
- **Severity:** Low  **Confidence:** Confirmed
- **Evidence:** 245 rejected rows, last `2026-07-14`.
- **Why it matters:** ATR=0 indicates flat/empty source windows; rejections are correct but indicate upstream data-quality edge cases being fed to the producer.
- **Fix:** producer should skip (not attempt) zero-ATR rows; keep the CHECK as a backstop. **Test:** producer emits no zero-ATR rows given flat input.

### F-08 — Producer deadlocks on `features_zone` (15)
- **Severity:** Low  **Confidence:** Confirmed
- **Evidence:** 15 `deadlock detected`, last `2026-07-13`.
- **Fix:** order zone lifecycle writes consistently / retry-on-deadlock. **Test:** concurrent lifecycle run completes without deadlock under load.

---

## 6. Suspicious Observations Requiring More Evidence

- **S-1 — Producer watermark ~2 days behind run time.** All `feature_producer_runs` watermarks sit at `2026-07-17 ~14:30` while `finished_at` is current (`20:15`). Either the watermark semantic is "source max ts" (lagging by design, since 15m bars complete 15 min behind and features need a closed window) or the producer is re-reading a stale anchor. Need to confirm the intended watermark definition in `dag/runner.ts` before classifying as a bug.
- **S-2 — EURUSD open frozen at 1.14359 across 6+ consecutive 15m bars** (18:00–20:15) while high/low wiggle. Plausible in thin Sunday liquidity, but could indicate a stale quote feed. Cross-check against a second broker/tick source.
- **S-3 — 125 "No entry zone within 1.5 ATR" blocks.** Could be legitimate (zones consumed) or a symptom of dead event features shrinking the zone pool. Correlate block rate before/after the F-02 regression date.

---

## 7. Raw-Candle Timeframe-Alignment Analysis

Verified `candles_15m` against raw `candles_1m` for EURUSD over the last 3 hours (12 bars): **open = first 1m open, high = max 1m high, low = min 1m low, close = last 1m close — exact match on all 12 bars.** Cagg bucketing and refresh are correct for this pair/window. The alignment guarantee does **not** hold wherever a second broker writes into the same bucket (F-04), because the cagg aggregates over all brokers.

XAUUSD HTF is internally consistent but frozen at the F-01 ingestion stall (cagg can only be as fresh as its 1m source).

## 8. Reconstructed Signal Case Studies

- **Setup funnel (30d):** 4,618 `setup_evaluations` → 8 `live_signal` (0.17% pass-through). Dominant block: "No entry zone within 1.5 ATR of current price" (125 explicit), with HTF-bias conflict (17) and no-active-FVG (4) trailing. The funnel is functioning but starved of qualifying zones — consistent with event-feature death (F-02) reducing fresh zone supply.
- **Determinism case:** two identical `backtest-pit-v2.js XAUUSD 14 watukushay_no1 --mode=fast --json` runs produced byte-identical payloads except `queryMs` (35 vs 33). Reproducible.

## 9. Backtest-Integrity Assessment

- **PIT discipline:** enforced. `backtest-pit-v2.js` compiles with `trustStoredLifecycle: false`, so lifecycle state is recomputed PIT-correctly rather than trusting wall-clock `is_fresh` (SK-20/SK-55). Confirmed in code.
- **Preflight gate:** `XAUUSD 30d` verdict `READY` with full feature/candle coverage reported (bias@1h, moving_average@1h, pricing@15m, atr@1h, canonical candles at 1m/15m/1h). The blocked-symbol-skip behavior is in place.
- **Intrabar & setup profiles:** modes (`fast/full/deterministic`) and `--intrabar` / `--setup-profile` overrides are wired per AGENTS.md; deterministic mode uses `close` resolution.
- **Prior critical issues (C1–C5 from 2026-07-07 audit):** intra-bar time validation, OHLC validation, and pip/spread conversion were addressed (pip math centralized in `packages/shared/src/pairs/pipMath.ts`, corrupt-bar policy in the importer). Residual risk: C2/C3 fixes must be re-verified whenever the importer changes.
- **Main residual threat:** not the backtester itself, but **input data contamination** (F-04 multi-broker) which would silently corrupt both backtests and live features via the shared caggs.

## 10. Live-versus-Backtest Consistency Assessment

The documented `trustStoredLifecycle` asymmetry (live=true, backtest=false) is **intentional and correct**: live needs the fast current-state read; the backtest must not leak future lifecycle state. Do not "align" them. Both paths share `buildOrbSessionScopedJoin()` for session-scoped features and the same compiler, so SQL parity is preserved. The real consistency risk is environmental: a live decision made on stalled/dead features (F-01/F-02) will diverge from any backtest that used complete data. Consistency is therefore gated on data freshness, not on code.

## 11. Reproducibility & Determinism Results

- **Backtest determinism: PASS.** Identical inputs → identical payload (only wall-clock `queryMs` differs). See §8.
- **Data determinism: at risk.** Because caggs aggregate over all brokers, re-running a backtest after new OANDA rows land can change results without any code change — a hidden non-determinism source rooted in F-04, not in the engine.

## 12. Recommended Fixes, Prioritized by Risk

| Pri | Fix | Addresses | Effort |
|-----|-----|-----------|--------|
| P0 | Restore XAUUSD ingestion; backfill + refresh caggs + features | F-01 | 1–2h |
| P0 | Disable OANDA, delete non-canonical brokers, add ingestion allow-list, refresh caggs | F-04 | 2–3h |
| P1 | Restore event-feature production (verify `tz-refresh-lifecycle` cron, decouple from `skipLifecycle`) | F-02 | 2–4h |
| P1 | Backoff + circuit-breaker on producer invariant retries | F-03 | 2h |
| P2 | Freshness alerts: per-symbol candle lag, event-feature rows/hour, watermark lag | F-01/02/S-1 | 2h |
| P2 | Reconcile/schedule `direction_state` for documented consumers | F-05 | 1h |
| P3 | Include 4h/1d bias + DXY synthetic in pipeline; zero-ATR skip; deadlock retry | F-06/07/08 | 3h |

## 13. Proposed Regression Tests

1. `candles_1m` single-broker invariant: `COUNT(DISTINCT broker)=1` per symbol (CI query + ingestion 400 on non-allow-listed broker).
2. Freshness monitor: alert if `now() - MAX(candles_1m.ts) > 5m` during `isTradableInstant` for any active symbol.
3. Event-feature liveness: ≥1 `features_ifvg` + `features_order_block` row per symbol per hour in market hours.
4. Producer circuit-breaker: persistent `output_anchor_missing` → ≤3 retries then circuit open (unit test).
5. 15m-rollup exactness: periodic assertion `candles_15m` == aggregation of `candles_1m` over a sampled window (extend the §7 query to all symbols).
6. Backtest determinism: run twice, assert payload equality excluding `queryMs`/timestamps (codify the §8 spot-check).
7. `direction_state` freshness per documented consumer (XAUUSD 1h/15m).
8. Zero-ATR guard: producer emits no ATR=0 rows; CHECK remains as backstop.

## 14. Exact Commands & Queries (evidence, read-only)

```sql
-- F-01 ingestion stall / F-04 brokers
SELECT symbol, broker, MAX(ts) FROM candles_1m WHERE symbol IN ('XAUUSD','EURUSD','DXY') GROUP BY 1,2;
SELECT symbol, broker, COUNT(*), MIN(ts), MAX(ts) FROM candles_1m GROUP BY 1,2 ORDER BY 1,2;

-- HTF freshness
SELECT '15m' tf, symbol, COUNT(*), MAX(ts) FROM candles_15m GROUP BY symbol;

-- F-02 event features (2d)
SELECT symbol, tf, COUNT(*), MAX(ts) FROM features_ifvg      WHERE ts > now()-interval '2 days' GROUP BY 1,2;
SELECT symbol, tf, COUNT(*), MAX(ts) FROM features_order_block WHERE ts > now()-interval '2 days' GROUP BY 1,2;

-- F-03 producer errors (7d)
SELECT feature_table, error_message, COUNT(*), MAX(finished_at)
  FROM feature_producer_runs WHERE status='error' AND finished_at > now()-interval '7 days'
  GROUP BY 1,2 ORDER BY 3 DESC;

-- F-05 direction_state coverage
SELECT symbol, tf, COUNT(*), MAX(ts) FROM features_direction_state GROUP BY 1,2;

-- Setup funnel / block reasons (30d)
SELECT COUNT(*), MAX(created_at) FROM setup_evaluations WHERE created_at > now()-interval '30 days';
SELECT unnest(block_reasons) reason, COUNT(*) FROM setup_evaluations
  WHERE created_at > now()-interval '30 days' AND block_reasons IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
SELECT COUNT(*), MAX(created_at) FROM live_signal WHERE created_at > now()-interval '30 days';

-- §7 timeframe alignment (EURUSD, 3h)
SELECT c15.ts, (c15.o=agg.o1 AND c15.h=agg.h1 AND c15.l=agg.l1 AND c15.c=agg.c1) AS match
FROM candles_15m c15 JOIN LATERAL (
  SELECT (ARRAY_AGG(o ORDER BY ts))[1] o1, MAX(h) h1, MIN(l) l1, (ARRAY_AGG(c ORDER BY ts DESC))[1] c1
  FROM candles_1m WHERE symbol='EURUSD' AND broker='1x Trade Ltd.'
    AND ts >= c15.ts AND ts < c15.ts + interval '15 minutes') agg ON true
WHERE c15.symbol='EURUSD' AND c15.ts > now()-interval '3 hours' ORDER BY c15.ts DESC;
```

```bash
# Backtest preflight + determinism
node scripts/backtest-pit-v2.js XAUUSD 30 watukushay_no1 --mode=fast --preflight
node scripts/backtest-pit-v2.js XAUUSD 14 watukushay_no1 --mode=fast --json   # run twice, diff payload
```

---

*Audit performed read-only against the live `tradzfx_v2` database on 2026-07-19. No data was modified.*
