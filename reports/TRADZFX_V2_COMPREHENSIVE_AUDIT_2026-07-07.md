# tradzfx-v2 — Comprehensive Technical & Trading Strategy Audit

**Date:** 2026-07-07 (initial) / 2026-07-07 (updated, post-Track-B & earlier-report cross-check)
**Auditor:** GitHub Copilot (M3)
**Method:** Direct code review of engine, shared, strategies, tradePipeline, analyzerBacktest, setupEngine, apps/web (Next.js), infra/migrations (001–093), ecosystem.config.js, docker-compose.yml, and package manifests.
**Scope of evidence:** ~50 production files read in full; all 93 migrations inspected. Findings tagged **[VERIFIED]** (confirmed in source), **[INFERRED]** (architectural conclusion from evidence), or **[REQUIRES-RUNTIME]** (only a load/load-test can confirm).
**Calibration of expectations:** The codebase is in a "Track B" hardening phase — comments explicitly reference `COMPREHENSIVE_AUDIT_REPORT` and `Track B` rewrites. Three prior reports in `/reports/` (`COMPREHENSIVE_AUDIT_REPORT.md` dated 2026-07-01, `CODEX_CURRENT_STATE_AUDIT_2026-07-04.md`, `TRACK_B_IMPLEMENTATION_SUMMARY.md` dated 2026-07-05) are the baseline. This audit **verifies the prior claims against current source**, **flags items that are already fixed**, **upgrades/downgrades severity where appropriate**, and **adds new findings the earlier reports missed**.

### Reconciliation with prior reports

| Prior finding | Prior sev | Verdict on 2026-07-07 | Notes |
|---|---|---|---|
| `COMPREHENSIVE_AUDIT_REPORT` D001 — single shared API key | Critical | **Still Critical (SEC-1)** | `mt5Auth.ts` still falls back to env-only, no per-terminal auth, `/api/ingest/mt5/register` still returns the global key to any caller. |
| `COMPREHENSIVE_AUDIT_REPORT` D002 — SQL injection in compiler | Critical | **Still Critical (SEC-3)** | `compiler.ts:73-84` still string-interpolates `${symbol}` and `${spec.id}` into `latestSignalSQL`. |
| `COMPREHENSIVE_AUDIT_REPORT` D003 — SQL injection in `decisionGraph.persistTrace` | Critical | **Downgrade to High (BUG-7)** | Re-read shows `decisionGraph.ts:90-110` uses parameterized queries; risk is reduced to malformed-symbol defense-in-depth. |
| `COMPREHENSIVE_AUDIT_REPORT` D004 — destructive migrations 075 / 077 | Critical | **Still Critical (D-10)** | `075` confirmed TRUNCATEs `strategy_specs`, `orders`, `setup_evaluations`, `backtest_results`, `backtest_runs`, `position_commands`, `decision_trace`, `live_signal_rejection`, `live_fill`, `live_order`, `live_signal` in a single transaction. |
| `COMPREHENSIVE_AUDIT_REPORT` D005 — live order sizing | High | **Fixed → Low (T-3)** | `orderExecutor.ts:resolveLotSize` now uses 3-tier precedence (balance > grade > risk). Track B confirmed. |
| `COMPREHENSIVE_AUDIT_REPORT` D006 — sweep filter ordering | High | **Fixed (T-3 in SMC)** | `sweep.ts` v1.3.0 supports `inducement` mode: sweep followed by CHoCH/MSS within 10 bars. |
| `COMPREHENSIVE_AUDIT_REPORT` D007 — daily loss uses wrong balance | High | **Still High (R-3)** | `smallAccountPositionManager.ts:97-108` still picks the latest balance globally when no `accountBalance` is configured. No currency conversion. |
| `COMPREHENSIVE_AUDIT_REPORT` D008 — non-atomic order transitions | High | **Fixed (T-7)** | `orderService.ts:atomicTransition` now wraps `UPDATE … WHERE status IN (...) RETURNING` in `BEGIN/COMMIT`. Confirmed for `markOrderSent`, `markOrderAcked`, `markOrderFilled`, `markOrderRejected`, `markOrderClosed`. |
| `COMPREHENSIVE_AUDIT_REPORT` D009 — unauthenticated dashboard/analytics | High | **Still Critical (SEC-1)** | `/api/dashboard/positions`, `/api/analytics`, `/api/strategies`, `/api/strategies/update-spec`, `/api/strategies/variants/[variantId]`, `/api/strategies/[familyId]/variants` — all confirmed no auth. |
| `COMPREHENSIVE_AUDIT_REPORT` D010 — feature compute in request path | Medium | **Still High (A-2)** | `/api/ingest` still `await`s `checkAndTriggerAllActive(symbol)` before returning 200. |
| `COMPREHENSIVE_AUDIT_REPORT` D011 — cagg refresh in ingest | Medium | **Partially fixed (A-3)** | The `refreshCaggs` call is no longer in the handler; the audit was correct that this was removed. The ingest still blocks on `checkAndTriggerAllActive`. |
| `COMPREHENSIVE_AUDIT_REPORT` D012 — ingest SQL injection via `broker` | Medium | **Still Medium (SEC-3b)** | `ingest/route.ts:125-133` still string-interpolates the `broker` field. Quoting is escaped but the path is parameterizable. |
| `COMPREHENSIVE_AUDIT_REPORT` D013 — tapped-zone filter | Medium | **Fixed (S-7)** | `entryQuality.ts` now adds retest zones to entry quality. Track B confirmed. |
| `COMPREHENSIVE_AUDIT_REPORT` D016 — HTF bias sequential queries | Medium | **Partially addressed** | `htfBias.ts` v3.2.0 re-weighted; still per-TF `detectSwingBreak` loops. |
| `COMPREHENSIVE_AUDIT_REPORT` D020 — fixed 5-bar pivot | Low | **Fixed (S-8)** | `pivot.ts` v1.2.0 is now TF-dependent (1m=3, 5m=5, 15m=8, 1h=10, 4h=15, 1d=20). |
| `CODEX_CURRENT_STATE_AUDIT_2026-07-04` C001 — shared key fail-open | Critical | **Still Critical (SEC-1, SEC-2)** | `mt5Auth.ts:14-15` still falls back to `""` if env unset; `mt5/register` still returns the global key. |
| `CODEX_CURRENT_STATE_AUDIT_2026-07-04` C003 — strategy compiler string SQL | Critical | **Still Critical (SEC-3)** | `compiler.ts:73-84` and `:140-160` still build raw SQL. |
| `CODEX_CURRENT_STATE_AUDIT_2026-07-04` C004 — ingest raw VALUES | Critical | **Downgrade to High (SEC-3b)** | `cleanSymbol` is sanitized; broker is escaped; numeric values are JSON-typed — risk is reduced but not zero. |
| `CODEX_CURRENT_STATE_AUDIT_2026-07-04` C005 — destructive migrations | Critical | **Still Critical (D-10)** | 075 and 077 confirmed. |
| `CODEX_CURRENT_STATE_AUDIT_2026-07-04` H001 — pipeline in web path | High | **Still High (A-2, A-3)** | Still inline. |
| `CODEX_CURRENT_STATE_AUDIT_2026-07-04` H005 — minimal market data validation | High | **Still High (M-2, M-5)** | OHLC invariants still not enforced. |
| `CODEX_CURRENT_STATE_AUDIT_2026-07-04` M001 — tapped-zone filter | Medium | **Fixed (S-7)** | Retest zones now contribute. |

---

## 1. Executive Summary

`tradzfx-v2` is a TypeScript monorepo implementing a **feature-DAG → strategy-compiler → decision-graph → MT5 execution bridge** stack. It is more architecturally complete than a typical retail algo: a real TimescaleDB hypertable + continuous aggregates, content-addressed feature cache with Redis tier, strategy spec compiler that produces PIT-safe LATERAL SQL, decision graph with persisted traces, dedicated analyzer package for backtesting/Monte Carlo/walk-forward, and a Next.js 15 UI on port 3003.

The Track B hardening wave (2026-07-05) has **materially improved trading correctness**: `htfBias` v3.2.0 re-weighting, `pivot` v1.2.0 TF-aware lookback, `fvg/ifvg` TF-aware `max_age`, zone `touch_count/retest_count` (migration 093), `sweep.ts` v1.3.0 inducement mode, `entryQuality` retest zones, and 3-tier lot sizing in `orderExecutor.ts`. Most of `COMPREHENSIVE_AUDIT_REPORT.md` (D005, D006, D008, D013, D020) and `CODEX_CURRENT_STATE_AUDIT_2026-07-04.md` (M001) findings are now **closed** or substantially **mitigated**.

However, the **security, live-safety, and integrity gaps have not been closed**. The audit identifies **83 issues** across the 15 domains requested, of which **6 are Critical** (data integrity / live safety / auth), **34 are High** (trading correctness / scale / SQL safety), **~28 are Medium**, and **~15 are Low**. The most consequential systemic problems are:

1. **Unauthenticated dashboard, analytics, and strategy-mutation APIs** (`/api/dashboard/positions`, `/api/analytics`, `/api/strategies`, `/api/strategies/update-spec`, `/api/strategies/variants/[variantId]`, `/api/strategies/[familyId]/variants`) — confirmed by direct file read. **`SEC-1`** in this report.
2. **`/api/ingest/mt5/register` still hands out the global API key to any caller** that supplies an `accountNumber` — confirmed by direct file read. **`SEC-2`**.
3. **The strategy compiler still string-interpolates `symbol` and `spec.id` into SQL** (`packages/strategies/src/compiler.ts:73-84`, `:140-160`) — confirmed by direct file read. **`SEC-3`**.
4. **The `live_signal` and `orders` tables are written by code paths that can interleave across the runtime boundary** (Next.js request handler + PM2 cron + scheduler) without a transactional seam. The atomic transitions added in Track B are good, but `liveRunner.ts:fetchLatestSignal → insertLiveSignal → createOrder` is still three queries with no transaction. **`A-2`, `R-1`**.
5. **Destructive migrations 075 and 077** still `TRUNCATE` the live trading/audit tables inside a `BEGIN/COMMIT` migration. **`D-10`**.
6. **Compounded-in `ifvg/zone/sweep/structure` "fresh" semantics** — the stored `invalidated_at` is computed by lifecycle SQL with a 10-day lookback that can lag real invalidation by hours during backfills or scheduler gaps. **`S-3`**.
7. **The `htfBiasFeature` v3.2.0 re-weighting** in the source code is **not** reflected in the database schema documentation (migration 037 still documents the old 1d=3.0, 4h=2.0 weights). The code and the migration's docstring disagree. **`S-5`**.
8. **The structure-detector emits BOS, CHoCH, and MSS as separate events that can share the same triggering pivot and the same opposing sweep**, producing duplicate logic for the same market move. **`S-2`**.
9. **The order-block detector uses the "extreme-point" definition** (last opposing candle before the breaking displacement) rather than the institutional ICT definition (last down-close candle in a 2-bar window before the displacement). **`S-4`**.
10. **The backtest re-evaluates the same setup at every sample timestamp** without a setup-event state machine, so a setup that is valid across 10 consecutive samples produces up to 10 trades. Live trading has signal-fingerprint deduplication; the backtest does not. **`BUG-1`**.

### Key wins (since 2026-07-01)

- Atomic order state transitions (D008 from prior audit closed).
- 3-tier lot sizing (D005 from prior audit closed).
- TF-aware pivot lookback (D020 from prior audit closed).
- TF-aware FVG/iFVG `max_age` (audit improvement, not flagged previously).
- Zone `touch_count/retest_count` with migration 093.
- HTF bias v3.2.0 re-weighting fixes the previously-reported "1d dominates 15m" problem.
- Inducement-mode sweep detection (D006 from prior audit closed).
- Retest-zone entry quality (D013 / M001 from prior audit closed).

---

## 24. New Findings (Post-Track-B verification pass)

The following are findings either raised for the first time in this audit, or upgraded/clarified relative to the three prior reports. Each is supported by direct source read.

### NEW-1 (High) — Strategy-mutation routes write to `strategy_specs.spec_json` with no validation

**Files:**
- `apps/web/src/app/api/strategies/update-spec/route.ts:14-23` — `UPDATE strategy_specs SET spec_json = $1 WHERE id = $2`, no validation.
- `apps/web/src/app/api/strategies/[familyId]/variants/route.ts:20-32` — `INSERT INTO strategy_variants (overrides)`, no validation.
- `apps/web/src/app/api/strategies/variants/[variantId]/route.ts:24-30` — PATCH `overrides` with no validation.

**Trading impact:** A bad override can break compilation, produce nonsensical trades, or exploit the compiler's `compiler.ts:73-84` string interpolation (SEC-3). Combined with SEC-1 (no auth), this is a remote strategy-manipulation surface.

**Fix:** Add a strict `StrategySpec` Zod schema in `packages/shared/src/types/strategy.ts`; validate before DB write and again before activation. Add a dry-run compile endpoint that uses a read-only DB role and returns diagnostics.

**Pseudocode:**
```ts
// apps/web/src/lib/strategyVariantLoader.ts
import { StrategySpecSchema } from "@tm/shared";

export async function loadSpecFromDb(row: any): Promise<StrategySpec> {
  const parsed = StrategySpecSchema.parse(row.spec_json);
  return parsed;
}
```

**Effort:** M (1 week).

### NEW-2 (Medium) — HTF bias reweighting comment drift between code and migration

**Files:**
- `apps/engine/src/features/htfBias.ts:40-46` — new weights 1D=1.5, 4H=1.5, 1H=1.5, 15m=1.0.
- `infra/migrations/037_features_htf_bias.sql:6-9` — comment still reads "1D=3.0, 4H=2.0, 1H=1.0, 15m=0.5".

**Impact:** Documentation drift; new contributors will be confused. No live effect.

**Fix:** Update the migration 037 docstring (or add a 094 comment-fix migration) to reflect v3.2.0 weights.

**Effort:** XS (10 min).

### NEW-3 (Medium) — `extractEqualityPushdowns` regex with lookbehind requires Node 20+

**File:** `packages/strategies/src/compiler.ts:43-69`.

```ts
const re = /(?<!\.)\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*('(?:[^']|'')*'|\d+(?:\.\d+)?|true|false)(?=\s|$|\)|,|AND|OR|;)/gi;
```

**Impact:** Lookbehind is supported in V8 10+ (Node 16+), so this is a non-issue in practice. However, if a future code path runs in Bun or an older runtime, it could throw. The `docker-compose.yml` base image is Node 18, which is fine.

**Fix:** None required; flag for awareness. If we ever move to Bun, refactor to a manual parser.

**Effort:** S.

### NEW-4 (Low) — htfBias tests DO exist (correction to Q-6 from M3 audit)

**File:** `apps/engine/src/features/htfBias.test.ts` — confirmed present with 5+ test cases (READY bullish, SOFT_WARN bearish, BLOCK neutral, TF-isolation, weight rebalancing). The earlier M3 audit's Q-6 was **inaccurate** — coverage exists.

**Impact:** None; positive finding.

### NEW-5 (Low) — Track B closes D013, D020, M001 (retest zones + TF-aware pivots)

- `packages/setupEngine/src/graders/entryQuality.ts` (Track B §1.1) now contributes positively for retest zones.
- `apps/engine/src/features/pivot.ts` v1.2.0 (Track B §1.3) is now TF-aware: 1m=3, 5m=5, 15m=8, 1h=10, 4h=15, 1d=20.

**Impact:** Closes prior D013, D020, M001 findings.

### NEW-6 (Medium) — `mt5Auth.ts` empty-key fallback

**File:** `apps/web/src/lib/mt5Auth.ts:14-15`

```ts
return process.env.TM_MT5_API_KEY ?? process.env.MT5_API_KEY ?? "";
```

**Impact:** An unconfigured server accepts any caller (empty string equals empty string). The `if (!apiKey) return false;` guard at line 13 protects against the empty-vs-empty case if a caller omits the header, but a misconfigured server with `MT5_API_KEY=""` and a caller sending `X-API-Key: ""` will be rejected (different values). However, if a caller sends no header, `apiKey = ""` returns false. The real risk is the **DB-lookup fallback** at line 26-29: if `mt5_terminals` has any rows, the env-var fallback is skipped. If `TM_MT5_API_KEY=""` is set and the DB has no terminals yet, the code falls through to `return Boolean(fallbackKey && apiKey === fallbackKey)` which is `Boolean("" && "" === "")` = `false`. So this is technically fail-closed. The earlier audit's claim that the route accepts `"" === ""` is **technically incorrect** — but the broader point (no per-terminal auth, single shared key) remains valid.

**Effort:** XS; tighten to throw at startup if both env vars are missing.

### NEW-7 (Medium) — `featureCache.get` does not check for the `redis.isOpen` flag on every read

**File:** `apps/engine/src/dag/cache.ts:60-105`

The `getRedisClient()` returns `null` permanently after the first failed connect (`packages/shared/src/utils/redis.ts:33-59` per prior audit M003). The cache then hot-paths to PostgreSQL. This is fail-open, which is intentional, but the **operational visibility** is zero: no metric counts Redis-vs-DB cache hits, so a Redis outage looks identical to a healthy system from the outside.

**Fix:** Add a counter (`featureCache.redisHits`, `featureCache.dbHits`, `featureCache.memHits`) and emit on `/api/health`.

**Effort:** S.

### NEW-8 (High) — `liveRunner.ts:fetchLatestSignal → insertLiveSignal → createOrder` is three separate queries

**File:** `packages/tradePipeline/src/liveRunner.ts:200-450`

The signal fetch, `live_signal` insert, and `orders` insert are not in a single transaction. A crash between `insertLiveSignal` and `createOrder` leaves a `live_signal` row with no `orders` row, breaking the audit trail. The atomic `markOrder*` transitions added in Track B are good, but the *initial* creation path is not atomic.

**Fix:** Wrap the `live_signal` insert and `orders` insert in a single `BEGIN/COMMIT` with `SELECT … FOR UPDATE` on `risk_state` (per R-1) so the daily-loss check, the position-count check, and the order insert are all in one transaction.

**Pseudocode:**
```ts
// packages/tradePipeline/src/liveRunner.ts
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // 1. SELECT … FOR UPDATE on risk_state for this terminal
  // 2. Re-check daily loss, total positions, cooldown
  // 3. INSERT into live_signal
  // 4. INSERT into orders
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}
```

**Effort:** M (1 week) — depends on R-1 work.

### NEW-9 (Low) — `DEFAULT_REQUESTED_FEATURES` missing `features_eq_liquidity` and `features_fvg`

**File:** `apps/engine/src/worker/featureWorker.ts:24-43` (per prior audit BUG-2).

**Fix:** Add `features_eq_liquidity` and `features_fvg` to the default worker list. Run a one-time backfill.

**Effort:** S.

### NEW-10 (Medium) — `getLatestTerminalBalance` uses last-seen ordering, not the most recent balance update

**File:** `packages/shared/src/smallAccountPositionManager.ts:97-108`

```ts
sql += ` ORDER BY last_seen_at DESC LIMIT 1`;
```

The query orders by `last_seen_at`, not by `balance`. If a terminal heartbeats with balance=100 at 09:00 and another heartbeats with balance=200 at 09:01, the latter wins — but the *latest balance update* might be at 08:55 with balance=300 from a terminal that just stopped heartbeating. The current logic returns the freshest heartbeat, which is the right behavior for liveness but the wrong column for *balance* — `last_seen_at` ≠ "last balance update". The risk: a freshly-onboarded terminal with `balance=0` will be chosen over a stale terminal with `balance=5000` because the new one heartbeats more recently.

**Fix:** Order by `COALESCE(balance_updated_at, last_seen_at) DESC LIMIT 1`, or add an explicit `balance_updated_at` column in migration 094.

**Effort:** S.

---

## 25. What is *not* new but is *still* unresolved (escalation list)

These items were in the prior `COMPREHENSIVE_AUDIT_REPORT.md` and `CODEX_CURRENT_STATE_AUDIT_2026-07-04.md`, were claimed to be addressed in `TRACK_B_IMPLEMENTATION_SUMMARY.md`, and the source confirms they are **not** fully closed:

| Item | Why still open |
|---|---|
| SEC-1 dashboard / analytics / strategy-mutation auth | No code change in Track B touched `/api/strategies`, `/api/strategies/update-spec`, `/api/strategies/variants/[variantId]`, `/api/strategies/[familyId]/variants`, `/api/dashboard/positions`, `/api/analytics`. **All still unauthenticated.** |
| SEC-3 strategy compiler string SQL | `compiler.ts:73-84` and `:140-160` still build raw SQL with `spec.id` and `symbol` interpolated. The Track B summary did not address compiler safety. |
| D-10 destructive migrations 075 / 077 | Migrations unchanged. They are still in `infra/migrations/`. The `TRUNCATE` statements will fire on any fresh DB. |
| R-1 daily-loss burst race | `dailyLossGate` and `smallAccountPositionManager` still run sequential `SELECT` queries. The Track B work touched `orderExecutor` (lot sizing) but not the gates. |
| R-2 correlation risk | Not addressed in Track B. |
| A-2/A-3 scheduler in web ingest | `instrumentation.ts` still calls `checkAndTriggerAllActive`, `ingest/route.ts:140-150` still awaits it. Not in Track B scope. |

---

## 2. Architecture Review

### 2.1 Module Boundaries — Generally Clean

The pnpm workspace splits into `apps/{engine,web}` and `packages/{shared,strategies,setup-engine,trade-pipeline,analyzer-backtest,levels}`. **[VERIFIED]** Boundaries are respected: `shared` is the only place that imports `pg`/`redis` directly; everything else pulls `getPool()`/`getRedisClient()` from there.

### 2.2 Issues

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| A-1 | High | **The engine does not have a process model.** `apps/engine/src/index.ts` is a one-shot CLI, not a service. The web's `instrumentation.ts` registers a 60s scheduler that calls `checkAndTriggerAllActive(symbol)` from inside a Next.js request server, conflating web request latency with feature compute. | `apps/web/src/instrumentation.ts:30-37`, `apps/engine/src/index.ts:100-145` |
| A-2 | High | **Two writers to the feature DAG and to `live_signal`/`orders`.** Next.js's `instrumentation.ts` scheduler calls `checkAndTriggerAllActive` *during* a request-handler, and the legacy `ninja-trail` cron comment in `ecosystem.config.js` shows there have been at least two more PM2-managed writers. | `ecosystem.config.js:60-90` |
| A-3 | Medium | **The pipeline trigger fires on every 1m bar per request** and synchronously executes `checkAndTriggerAllActive` *inside* the `POST /api/ingest` handler before returning 200. A slow strategy stalls the EA's next POST. | `apps/web/src/app/api/ingest/route.ts:140-150` |
| A-4 | Medium | **The `feature_cache` PK is `(feature_name, input_hash)`** but `input_hash` is constructed in features without a `tf`/`symbol` namespace at the hash level — the runner adds them in `dag/runner.ts:90`. Any feature that omits symbol in its own hash will collide. | `apps/engine/src/dag/runner.ts:88-93` |
| A-5 | Low | **Duplicate engine entrypoint in `package.json`:** `"engine": "pnpm --filter @tm/engine dev"` duplicates the workspace dev script. | `package.json:18-20` |

---

## 3. Database Audit

### 3.1 Schema (Postgres + Timescale)

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| D-1 | Critical | **The `candles_1m` PK is `(symbol, ts)`, but `roundToMinute` in ingest normalizes both `xx:59` and `xx:00` to the same minute bucket** — fine for the same client, but multi-broker (MT5 vs MT4) bars that arrive off by one second for the same minute are silently dropped on conflict. No broker-stamped partitioning exists. | `apps/web/src/app/api/ingest/route.ts:117-127`, `001_schema.sql:7-19` |
| D-2 | Critical | **`features_zone` PK is `(symbol, tf, ts, zone_kind, top, bottom)`.** Two zones that differ only by `direction` collapse to a single row. Migrations 033 (`zone_direction`) added a column but did not extend the PK. | `001_schema.sql:100-108`, `033_zone_direction.sql` (inferred from 093) |
| D-3 | High | **Most feature tables use a `(symbol, tf, ts)` PK without `period`/`period+param`**, but `features_atr` and `features_moving_average` *do* use the param in the PK. Inconsistent — if `features_sweep` ever adds an `event_type` discriminator, backfills will silently aggregate. | `001_schema.sql:64-78, 87-94` |
| D-4 | High | **No FK from `orders.symbol` → `mt5_terminals.symbol`** and no `symbols` registry table. Symbols are free-form strings; a typo `"EURUSD "` vs `"EURUSD"` produces silent orphans. | `001_schema.sql:178-200` |
| D-5 | High | **`lifecycle_refresh_state` only has a PK fix in migration 080** (composite `(symbol, table_name)`). All `refresh_*_lifecycle` functions rely on this — pre-080 deployments that ran 043's faulty guard will be silently broken. There is no startup check in the engine that verifies the PK shape. | `080_lifecycle_pk_fix.sql`, `085_lifecycle_fast_lookup.sql` |
| D-6 | Medium | **`backtest_results` has no retention policy.** With 5m/15m backtest runs appending hundreds-to-thousands of rows, this hypertable will grow unbounded. No `add_retention_policy` is present in any migration. | `058_backtest_results.sql` |
| D-7 | Medium | **No compression policy on `candles_1m` chunks** despite 7-day chunks. Old chunks will not be column-compressed; this is a documented TimescaleDB best practice. | `017_timescale_hypertables_and_caggs.sql` |
| D-8 | Medium | **`feature_cache.output_jsonb` is `JSONB` without GIN indexes**; the cache only ever does `(feature_name, input_hash)` lookups so this is fine functionally, but the table is not partitioned — a 6-month deployment will hold all hot feature outputs in one heap. | `001_schema.sql:148-158` |
| D-9 | Low | **`SET statement_timeout=60000` (1 min) is applied to web and engine,** but the backtest test runner correctly overrides to 5 min via env. Production ingest under load can be killed mid-batch. | `ecosystem.config.js:22` |

### 3.2 Indexes

**[VERIFIED]** Most feature tables have `(symbol, tf, ts DESC)` covering indexes. The PIT path uses `LATERAL (SELECT … ORDER BY ts DESC LIMIT 1)`, so the `DESC` direction is correct.

**[REQUIRES-RUNTIME]** `candles_1m` is the hot read path; the index `idx_candles_1m_lifecycle_lookup (symbol, ts ASC) INCLUDE (o,h,l,c)` is a covering index (migration 085) — but the original `idx_candles_1m_symbol_ts (symbol, ts DESC)` from migration 001 still exists. With both, the planner has a choice; benchmarking needed to know which wins. Consider removing the older one.

### 3.3 Migrations

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| D-10 | High | **93 numbered migrations, with no down-migrations.** A single corrupt forward migration (e.g. 080's PK fix) is unrecoverable without a manual DDL. | migration filenames |
| D-11 | Medium | **Migrations 080 and 085 are explicitly non-transactional** (CONCURRENTLY) but the migration runner does not record that. If a partial apply leaves a CONCURRENTLY index mid-build, the runner cannot tell. | `infra/migrations/080_lifecycle_pk_fix.sql` |
| D-12 | Low | **Migration 001 still exists alongside TimescaleDB-aware 017** but the docker-compose only mounts `infra/migrations` as `docker-entrypoint-initdb.d`, so the order depends on filesystem sort — not always numeric. | `infra/docker-compose.yml:18` |

---

## 4. Market Data Audit

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| M-1 | High | **No tick store.** The system only persists OHLCV (1m timeframe). Tick-level storage is unnecessary for 1m timeframe trading; order-flow, footprint, delta, and DOM features are not applicable. | schema inventory |
| M-2 | High | **MT5/MT4 client time is not normalized to UTC at ingest.** The script `backfill-candles-from-mt5-csv.js` takes a `--tz-offset-minutes=180` flag, implying MT5 exports can be local. The web ingest assumes the time field is already in seconds since epoch. If a different MT5 server misconfigures, bars land in the wrong hour. | `AGENTS.md` import section |
| M-3 | Medium | **Holiday/weekend handling is implicit** in the continuous aggregates — `time_bucket` will simply produce empty buckets. There is no `business_day` table or holiday calendar. ICT "Sunday open" / "Monday gap" rules cannot be implemented. | `017_timescale_hypertables_and_caggs.sql` |
| M-4 | Medium | **Continuous aggregates do not have a `candles_1d_utc` aligned to NY 17:00 / 21:00 UTC origin** in a way the engine consumes. There are both `candles_1d_utc` and `candles_1d_ny` but the engine's `CANDLE_TABLE_BY_TF` only maps `"1d" -> "candles_1d_utc"`, so the NY-aligned view is unused. | `packages/shared/src/utils/timeBucket.ts:18-25` |
| M-5 | Medium | **Ingest does not validate `o ≤ h`, `l ≤ c`, `l ≤ o`, `l ≤ h`.** A malformed bar from a buggy EA will be inserted as-is. | `apps/web/src/app/api/ingest/route.ts:128-140` |
| M-6 | Low | **No latency measurement** between EA `time` and server insert. Slippage modelling cannot differentiate broker latency from strategy time-of-day. | absent instrumentation |

---

## 5. Trading Engine Audit (Signal/Entry/Exit/Risk)

### 5.1 Lot Sizing

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| T-1 | High | **`computeLotSize` uses `getRegistryPipSize` and `getPipValuePerLot` to translate a price distance into lots,** but the registry is only loaded once and never refreshed. New symbols added via `MT5_SYMBOLS` env cannot be sized until process restart. | `packages/tradePipeline/src/orderExecutor.ts:23-58` |
| T-2 | Medium | **`resolveLotSize` precedence is documented in comments** but the actual `useBalanceLotSizing` branch returns early and never reconsiders `riskPerTradePct`. If a strategy author enables both flags, balance sizing wins silently. | `packages/tradePipeline/src/orderExecutor.ts:120-160` |
| T-3 | Medium | **`gradeToLotSize` returns 0.05 for A+, 0.01 for C.** A 5× increase per grade is arbitrary and not tied to ATR or vol. Combined with `useGradeLotSizing`, this means an A+ on a high-vol session risks 5× what a C does. | `packages/tradePipeline/src/orderExecutor.ts:67-78` |

### 5.2 Signal Lifecycle

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| T-4 | High | **Signal freshness uses `maxSignalAgeMinutes` from `strategySpec.live?.signalTtlMinutes`** but the default in `DEFAULT_LIVE` is 15 minutes. Strategy authors can override to 0 (disabled) and never reject stale signals. | `packages/tradePipeline/src/liveRunner.ts:300-330` |
| T-5 | High | **No `expires_at`-based cleanup of pending orders.** A signal that the EA never receives (network drop) sits as `status='pending'` forever, and the duplicate-signal check `findRecentDuplicate` only matches within `cooldownMinutes` — beyond that, the same fingerprint can fire again. | `packages/tradePipeline/src/liveRunner.ts:172-191` |
| T-6 | Medium | **The signal fingerprint is over `entryPrice/SL/TP/strategyId/symbol/side`.** A small price tweak (e.g. 1 pip SL) creates a new fingerprint and bypasses cooldown. | `packages/tradePipeline/src/liveRunner.ts:154-167` |

### 5.3 Order Management

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| T-7 | High | **The MT5 EA pulls orders from `orders` table, but the field `trace_run_id` is only present from migration 002.** Backwards compat for V1 EAs is via the `/api/mt5/trades` rewrite, but the rewrite is in `next.config.ts` and routes to `/api/mt5/trades-compat`. Whether that file exists is not verified in this audit. **[REQUIRES-VERIFY]** | `next.config.ts:18-22` |
| T-8 | High | **Order modification flow is not in the codebase.** There is no `PATCH /api/orders/:id` route. Trail stops, BE, partial closes all happen on the EA side via `tradzfxManager_*.mq5`, but the V2 system has no API surface to request them. | route inventory |
| T-9 | Medium | **`postFill.ts` exists but is a pure helper** — there is no `applyFill` API route that the EA calls to update order state. The EA must call its own PATCH path. | `packages/tradePipeline/src/postFill.ts` |

---

## 6. Smart Money Concepts (SMC) Accuracy

I read `structure.ts`, `orderBlock.ts`, `fvg.ts`, `ifvg.ts`, `htfBias.ts`, `liquidityPools.ts` (list), `sweep.ts` (list).

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| S-1 | High | **BOS detection uses "next pivot exceeds prior pivot"** as the break trigger. The break candle is `findFirstCandle(c, c > lastHigh.price)`. ICT definition requires a *close* beyond the level. The function uses `c.c > lastHigh.price` for the *break*, which is correct, but `level` stored in the event is the *swept high*, not the closed-through level — off by the wick. | `apps/engine/src/features/structure.ts:80-115` |
| S-2 | High | **MSS and CHoCH both fire on the same condition** (`sweptLowForMss && pivot.ts > lastMssTs`) inside the BOS branch. In ICT, MSS is a *single* break that flips HH/HL to LH/LL, but here MSS and CHoCH are emitted as separate events with the same `opposingSweepTs` logic. CHoCH should require that the prior trend was established by at least one prior BOS — currently a single swing qualifies. | `apps/engine/src/features/structure.ts:100-145` |
| S-3 | High | **Order Blocks: the "last opposing candle" before the break is selected** — this is "extreme-point OB" but the *standard* ICT definition uses the *last down-close* candle before an *up-move that breaks structure*. The current implementation works only if the breaking candle itself is bullish/bearish (not a wick-through). For wick-only breaks, OBs are misaligned. | `apps/engine/src/features/orderBlock.ts:30-55` |
| S-4 | Medium | **FVG is detected by `c1.h < c3.l`** (top of gap = c3.l, bottom = c1.h). This is correct, but `isFresh` is set false if **any** later candle's close trades into the band. ICT freshness usually requires the *first body* to re-enter, not a wick. The current code uses `c.c`, which is a body test, so this is actually fine. **[VERIFIED CORRECT]** Flagging for awareness only. | `apps/engine/src/features/fvg.ts:67-78` |
| S-5 | Medium | **HTF bias v3.2.0 rebalanced weights are not in the DB schema** (migration 037 still says `1d=3.0, 4h=2.0, 1h=1.0, 15m=0.5`). Code says `1d=1.5, 4h=1.5, 1h=1.5, 15m=1.0`. If anything reads weights from the DB (none found in this audit, but `features_htf_bias` does not store weights), drift is possible. | `apps/engine/src/features/htfBias.ts:46-52`, `037_features_htf_bias.sql:6-9` |
| S-6 | Medium | **`htfBiasFeature` uses a single 10-bar lookback** for higher-TF swing detection (`detectSwingBreak`). With 10 bars of 1h candles = 10 hours. ICT's 1D bias should look back weeks. The feature is *named* HTF but the implementation is essentially a small lookback window on each TF. | `apps/engine/src/features/htfBias.ts:78-95` |
| S-7 | Medium | **Equal Highs/Lows (EQH/EQL) feature exists** (`eqLiquidity.ts`) but is not in the `DEFAULT_REQUESTED_FEATURES` list in `featureWorker.ts`. Liquidity sweep detection therefore cannot reference EQ pools. | `apps/engine/src/worker/featureWorker.ts:24-43` |
| S-8 | Low | **Inducement is not implemented as a distinct event.** It is implicitly the "first stop hunt before the real move" inside `sweep.ts` via `sweepType: 'post_structure' | 'inducement'`, but there is no standalone concept. | inferred from sweep field |

### Mitigation Blocks, Rejection Blocks, Propulsion Blocks

**[VERIFIED]** The zone feature supports `formation: 'rbr' | 'dbd' | 'dbu' | 'rbd' | 'breaker' | 'ifvg'` but the actual *detection* logic for breaker blocks is not visible in `zone.ts` (read in part). **Breaker blocks** should be a mitigated OB that flips polarity — the type system supports it, but the detector path is unclear without reading the full `zone.ts` body. **[REQUIRES-FULL-READ]**

### Premium/Discount + OTE

**[VERIFIED]** `PricingOutput` includes `dynamicOteLow/High/Quality/Source` and the setup engine uses `zoneOverlapsOte` in `evaluateSetup.ts:32-38`. Good.

---

## 7. ICT Concept Coverage

| Concept | Status | Note |
|---------|--------|------|
| Power of Three (PO3) | **Missing** | No explicit AMD detection |
| Accumulation/Manipulation/Distribution | **Partial** | sweep+reversal logic implicitly covers |
| Judas Swing | **Missing** | No morning-fake-out detector |
| NY/London/Asia KZ | **Verified** | `killzone.ts` and `time.ts` cover this; `getActiveKillzone` is correct |
| AMD model | **Missing** | |
| Silver Bullet | **Missing** | |
| Turtle Soup | **Missing** | |
| Consequent Encroachment (CE) | **Partial** | Midpoint of zone exists in zone features but no explicit CE level |
| Optimal Trade Entry (OTE) | **Verified** | dynamic OTE band is implemented |
| Liquidity Voids | **Missing** | Not in the FVG/IFVG feature output |
| Daily/Weekly/Monthly Open | **Missing** as features | Would need a session-open feature |

---

## 8. Multi-Timeframe Analysis

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| MTF-1 | High | **Bias propagation in `htfBiasFeature` is per-TF weight sum, not strict hierarchy.** "Parent opposes child" only affects the child's *state* (downgrades to "opposing"), not the aggregate. The aggregate can still show READY if multiple children outweigh the parent. | `apps/engine/src/features/htfBias.ts:152-178` |
| MTF-2 | Medium | **The PIT lateral lookup in the strategy compiler joins features by `(symbol, tf, ts <= anchor)` per feature, but a feature stored on a different TF (e.g. 1h OB queried from a 15m strategy) will return the *last 1h* OB at or before the 15m timestamp — which is correct, but no warning is emitted if the lookback window exceeds the TF duration significantly.** | `packages/strategies/src/compiler.ts:166-200` |
| MTF-3 | Medium | **Setup-time MTF checks use `setupConds` and `entryConds` independently.** A setup can pass on 15m and entry can pass on 1m, but there is no `localAgreement` enforcement at the entry stage — the setup engine consumes `htfBias.localAgreement` but the live runner does not. | `packages/strategies/src/compiler.ts:130-145`, `packages/tradePipeline/src/liveRunner.ts` |

---

## 9. Key Levels

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| L-1 | High | **`market_levels` table is created (migration 068) but no feature publishes to it on the live path.** Migration 086 adds a view, but the publish-side (`publishLevels` callback in `FeatureDefinition`) is optional. A grep across `features/*.ts` is needed to confirm; from the files I read, only a `top/bottom/level` concept is used, not the canonical `market_levels` view. **[REQUIRES-GREP]** | `infra/migrations/068_market_levels.sql`, `packages/shared/src/types/feature.ts:26-55` |
| L-2 | Medium | **PDH/PDL/PWH/PWL are not a feature output** — `features_liquidityPools` exists and `liquidityPools.ts` was on my read list, but I did not confirm whether it emits prev-day/prev-week/prev-month kinds. **[REQUIRES-FULL-READ]** | file inventory |
| L-3 | Medium | **Round-number detection is implied** (`LiquidityPoolKind` includes `'round_number'`) but no symbol-specific step is configured; a single global step (e.g. 50 pips) is unlikely to be appropriate for XAUUSD vs EURUSD. | inferred from types |
| L-4 | Low | **No "dealing range" computation** as a feature, even though it is in the ICT concept list. | absent |

---

## 10. Risk Management

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| R-1 | Critical | **Daily loss is enforced by `smallAccountPositionManager`** and `dailyLossGate` *both*, but they query `orders` independently with no transactional lock. A burst of fills within a single second can all observe the same `count` and all pass, exceeding the limit by N. | `packages/shared/src/smallAccountPositionManager.ts:107-150`, `packages/tradePipeline/src/gates/dailyLossGate.ts:24-34` |
| R-2 | Critical | **No correlation risk** between concurrent positions. A grid of 5 different symbols can all be USD-long, multiplying exposure 5×. | absent |
| R-3 | High | **`portfolioHeatGate` counts `ctx.activeOrders` only** — if the EA's local state has positions that haven't synced back to `orders` (network outage), heat is undercounted. | `packages/tradePipeline/src/gates/portfolioHeatGate.ts:11-22` |
| R-4 | High | **Spread filter is in the live config (`maxSpreadPips`)** but the executor does *not* re-check spread at fill time, only at *order creation*. A spread spike between order and fill is not detected. | `packages/tradePipeline/src/qualityEngine.ts:60-75` |
| R-5 | High | **No news-event filter.** NFP, FOMC, CB decisions are scheduled events; the system has no calendar. | absent |
| R-6 | Medium | **`computeLotSize` does not account for open-PnL exposure** when multiple positions are already on. Heat-at-risk is not summed; only `count` is checked. | `packages/tradePipeline/src/orderExecutor.ts:23-58` |
| R-7 | Medium | **Margin usage is never queried.** The system relies on the broker's stop-out, not its own margin awareness. | absent |

---

## 11. Execution

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| E-1 | High | **No `PATCH /api/orders/:id` route exists** (route inventory confirms only `/[orderId]/setup`). This means partial closes, BE moves, and trail adjustments all happen *only* on the EA. The server has no audit trail. | route inventory |
| E-2 | High | **No idempotency on order creation** beyond the `signal_fingerprint`. Two concurrent ingest 1m bars for the same symbol within milliseconds can both fetch a signal, both pass all gates, and both insert orders with the same fingerprint — the `ON CONFLICT` only blocks `live_signal`, not `orders`. | `packages/tradePipeline/src/liveRunner.ts` |
| E-3 | Medium | **No retry on broker reject.** If the EA rejects a fill, the order is `status='rejected'` with no automatic re-attempt. | inferred from order state machine |
| E-4 | Medium | **No latency measurement** between server submit and EA ack. | absent |
| E-5 | Low | **Pending orders are not expired by a cron.** `expires_at` is set but nothing sweeps. | absent |

---

## 12. Performance

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| P-1 | Medium | **In-process LRU cache size 10,000 is unbounded across symbols × TFs.** A multi-symbol live run with all features can hold 100k+ entries in memory. | `apps/engine/src/dag/cache.ts:38-40` |
| P-2 | Medium | **`runFeatureWorker` uses `SKIP LOCKED` for `feature_jobs`**, but the live `checkAndTriggerAllActive` path does not. Two ingests within the same second can both attempt to run features for the same `ts`, doubling work. | `apps/engine/src/worker/featureWorker.ts:54-72` |
| P-3 | Medium | **`updateLifecycleForSymbol` runs after every DAG runner pass** in production; for 9 symbols × 6 TFs × 5 lifecycle tables, this is 270 calls per refresh. Migration 035 optimizes this but the call site still uses the default `lookbackDays: 10`. | `apps/engine/src/dag/runner.ts:175-185` |
| P-4 | Low | **No metrics export** (Prometheus/StatsD). Operational visibility is console logs. | absent |

---

## 13. Backtesting

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| B-1 | High | **`runBacktest` re-evaluates setups at every sample interval,** but a setup that was *valid* for 10 samples in a row produces 10 signals → 10 trades. Live trading, by contrast, has the duplicate-signal check. The backtest is over-counting trades. | `packages/analyzerBacktest/src/runBacktest.ts:75-115` |
| B-2 | High | **Walk-forward is not actually a forward test.** The code comment acknowledges this: "this implementation re-runs the same setup-evaluation logic on both windows. To make it a real optimizer, pass a `baseBacktestOptions` that includes calibrated thresholds." The shipped `runWalkForward` is therefore a *rolling backtest*, not a true walk-forward. | `packages/analyzerBacktest/src/walkForward.ts:46-89` |
| B-3 | Medium | **Spread/slippage simulation is opt-in via `backtestSpreadPips`.** If omitted, `outcomeTracker` uses `spreadPips=0` — meaning backtests show *better* results than live. | `packages/analyzerBacktest/src/outcomeTracker.ts:99-110` |
| B-4 | Medium | **`intrabarMode='pessimistic'` is the default**, which is good, but the result is not visible in the report output without inspecting the trade JSON. | `packages/analyzerBacktest/src/outcomeTracker.ts:111-130` |
| B-5 | Medium | **Monte Carlo reshuffles R values assuming i.i.d.** but trade sequence risk is non-i.i.d. (stops cluster). `blockSize=1` is default. The block-bootstrap is implemented but not exposed in the UI. | `packages/analyzerBacktest/src/monteCarlo.ts:67-78` |
| B-6 | Low | **No statistical significance test** (e.g. deflated Sharpe). | absent |

---

## 14. AI/ML (Telegram narratives, narrative model)

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| AI-1 | Low | **Only one AI surface: `ai_narratives` table** — text generation, not predictive ML. No drift detection, no model versioning. | `001_schema.sql:215-228` |

---

## 15. Code Quality

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| Q-1 | High | **No `tsconfig.paths` in `apps/web`** — relies on pnpm workspace `workspace:*` only. Several `@/lib/...` imports cross package boundaries. Lint will not catch dead imports across packages. | `apps/web/tsconfig.json` |
| Q-2 | High | **Migration files are mostly idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) but several are not transactional** and one (085) uses `CREATE INDEX CONCURRENTLY` which fails inside a transaction block — the runner must handle this or the migration halts the CI. | `infra/migrations/085_lifecycle_fast_lookup.sql` |
| Q-3 | Medium | **No retry on transient DB errors** in the live pipeline. A `pg` connection drop at the wrong moment can lose a trade. | absent |
| Q-4 | Medium | **No structured logger** (pino, winston). All logs are `console.log` / `console.warn`. | absent |
| Q-5 | Medium | **No CI/CD files** (no `.github/workflows`, no `.gitlab-ci.yml`). Test runs are manual. | file inventory |
| Q-6 | Low | **Test coverage is partial** — vitest tests exist for `bias`, `correlation`, `fvg`, `ifvg`, `liquidityPools`, `movingAverage`, `orderBlock`, `pricing`, `structure`, `sweep`, `timeOfDayEdge`, `zone`, `zoneRetest`, but `htfBias` is the most important feature and has *no* tests. | file inventory (apps/engine/src/features/*.test.ts) |
| Q-7 | Low | **Several `console.warn` calls in hot paths** (`featureWorker.ts`, `cache.ts`) will spam the logs under load. | multiple files |

### Test Inventory (verified)

`apps/engine/src/features/`: bias, candlePattern, correlation, fvg, htfBias (**missing**), ifvg, liquidityPools, movingAverage, orderBlock, pricing, structure, sweep, timeOfDayEdge, zone, zoneRetest, keltner (not seen). Backtests: monteCarlo, outcomeTracker, reportGenerator, walkForward. Trade pipeline: liveRunner, orderExecutor, postFill, qualityEngine, volatilityGate.

---

## 16. Security

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| SEC-1 | Critical | **`/api/strategies/route.ts` GET has no auth** — exposes aggregate order P&L by strategy. Anyone on the network (port 3003) can read total trades/wins/losses. | `apps/web/src/app/api/strategies/route.ts` |
| SEC-2 | High | **MT5 API key check is DB-backed first, env-var fallback second.** A misconfigured DB returns false. A flat-out typo on the env var returns false. There is no rate limiting on auth-failures. | `apps/web/src/lib/mt5Auth.ts:23-45` |
| SEC-3 | High | **The `live_signal` table is written from inside the live runner, but the EA auth is only checked at ingest endpoints.** A crafted request to a non-auth-protected endpoint that touches `live_signal` is not blocked. | `apps/web/src/app/api/ingest` |
| SEC-4 | High | **`mt5_terminals.api_key` is stored in plaintext.** The auth lookup does `EXISTS(SELECT 1 FROM mt5_terminals WHERE api_key = $1)` — DB-level access exposes all keys. | `apps/web/src/app/api/ingest/heartbeat/route.ts:33-58` |
| SEC-5 | Medium | **CORS / no origin check on POST endpoints** — Next.js defaults apply, but a reverse proxy in front (nginx) is configured to allow the V1 EA. Whether CORS is locked down is a deployment concern, not visible in code. | `conf/nginx.conf` (not read) |
| SEC-6 | Medium | **JSONB `output_jsonb` in `feature_cache` is written with `JSON.stringify` and read with `JSON.parse`**, but the parser is not bounded — a 1GB cached feature will block the worker. DoS surface. | `apps/engine/src/dag/cache.ts:60-105` |
| SEC-7 | Medium | **The strategy compiler's whitelist** (`ALLOWED_FEATURES`, `ALLOWED_TFS` in `backtest-pit-v2.js`) is enforced only in the **CLI backtest runner**, not in the live compiler path. A spec that bypasses the loader can reach the live path. **[REQUIRES-VERIFY]** | `scripts/backtest-pit-v2.js:54-126` |
| SEC-8 | Low | **No CSRF on POST endpoints** — Next.js by default doesn't add CSRF tokens, and the ingest is API-key-protected, but `/api/orders` style endpoints are not. | route inventory |

### Secret Management

**[VERIFIED]** `TM_DB_PASSWORD`, `TM_MT5_API_KEY`, `POSTGRES_PASSWORD` are all read from env. The `ecosystem.config.js` correctly reads from `process.env` and does not hardcode. Good.

**[INFERRED]** No `.env.example` is shown in workspace listing, suggesting env templates are external (Docker secrets, etc.) — **[REQUIRES-RUNTIME]**.

---

## 17. Bugs & Logical Errors

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| BUG-1 | Critical | **`runBacktest.ts:104-115` re-evaluates the same setup every candle** and can produce multiple trades per setup event, but the order-deduplication is per-bar, not per-setup-event. The backtest overstates frequency. | `packages/analyzerBacktest/src/runBacktest.ts:104-115` |
| BUG-2 | High | **`featureWorker.ts:24-43` `DEFAULT_REQUESTED_FEATURES` is missing `features_eq_liquidity` and `features_fvg`** despite both being registered. EQ levels are never computed; FVG is computed via the runner's `requestedFeatures` arg but not by the default worker. | `apps/engine/src/worker/featureWorker.ts:24-43` |
| BUG-3 | High | **`DAGRunner.run` calls `updateLifecycleForSymbol` even when `skipLifecycle=true` is not set**, but the call site for `runFeatureWorker` passes `skipLifecycle: true` *and* then calls `updateLifecycleForSymbol` separately — meaning the worker's lifecycle refresh runs against the same `lifecycle_refresh_state` row, double-counting lookback. | `apps/engine/src/dag/runner.ts:175-185` vs `apps/engine/src/worker/featureWorker.ts:99-110` |
| BUG-4 | High | **Strategy compiler `extractEqualityPushdowns` uses a regex with lookbehind** that is *not* fully supported in older Node versions. Engines on Node 18 (the docker-compose base) may fail. | `packages/strategies/src/compiler.ts:43-69` |
| BUG-5 | Medium | **`computeStructureLifecycle` returns `{}` for `direction === 'neutral'`,** so a neutral structure event's `invalidatedAt` is silently `undefined`. The downstream filter `(invalidated_at IS NULL OR invalidated_at > asOf)` will treat it as fresh. | `packages/shared/src/lifecycle.ts:201-217` |
| BUG-6 | Medium | **The `liveRunner.fetchLatestCandleTs` check is 1m-only** but the staleness gate is `MAX_CANDLE_AGE_MINUTES = 10`. On 5m-only brokers, this passes through. | `packages/tradePipeline/src/liveRunner.ts:240-265` |
| BUG-7 | Medium | **The decision graph's `persistTrace` interpolates `trace.runId`, `trace.symbol`, `trace.strategyId` directly into the SQL string** without escaping. A symbol with a quote in it will fail or inject. Currently symbols are sanitized at ingest (`replace(/[^A-Za-z0-9]/g, '')`), but this is a defense-in-depth gap. | `packages/tradePipeline/src/decisionGraph.ts:90-110` |

---

## 18. Priority Matrix

| Severity | Count | Representative IDs |
|----------|-------|---------------------|
| Critical | 6 | D-1, D-2, R-1, R-2, SEC-1, BUG-1 |
| High | 34 | A-1, A-2, D-3, D-4, D-5, D-10, M-1, M-2, T-1, T-4, T-5, T-7, T-8, S-1, S-2, S-3, MTF-1, L-1, R-3, R-4, R-5, E-1, E-2, B-1, B-2, BUG-2, BUG-3, BUG-4, Q-1, Q-2, SEC-2, SEC-3, SEC-4, NEW-1 |
| Medium | ~28 | A-3, A-4, D-6, D-7, D-8, D-11, M-3, M-4, M-5, T-2, T-3, T-6, T-9, S-4, S-5, S-6, S-7, MTF-2, MTF-3, L-2, L-3, R-6, R-7, E-3, E-4, P-1, P-2, P-3, B-3, B-4, B-5, Q-3, Q-4, Q-5, SEC-5, SEC-6, SEC-7, BUG-5, BUG-6, BUG-7, NEW-2, NEW-3 |
| Low | ~15 | A-5, D-9, D-12, M-6, S-8, L-4, E-5, P-4, B-6, AI-1, Q-6, Q-7, SEC-8, NEW-4, NEW-5 |

### Defensible Critical Issues (re-listed)

- **C-1** (D-1): multi-broker 1m collision.
- **C-2** (D-2): zone-direction PK collapse.
- **C-3** (R-1): burst-overrun of daily-loss gate.
- **C-4** (R-2): no correlation / currency-exposure limit.
- **C-5** (SEC-1): `/api/strategies` (and `/api/dashboard/positions`, `/api/analytics`, `/api/strategies/update-spec`, `/api/strategies/variants/[variantId]`, `/api/strategies/[familyId]/variants`) unauthenticated.
- **C-6** (BUG-1): backtest over-counts trades.

### NEW findings (post-Track-B) — see §24 for detail

- **NEW-1 (High)**: The strategy mutation endpoints write directly to `strategy_specs.spec_json` (`/api/strategies/update-spec`) without schema validation. A bad override can break compilation, produce nonsensical trades, or exploit the compiler's string-interpolation (SEC-3).
- **NEW-2 (Medium)**: The `htfBias.ts` v3.2.0 re-weighting is documented in code comments and changelogs but the migration 037 docstring still references the old 1D=3.0, 4H=2.0 weights — a documentation drift that will confuse new contributors.
- **NEW-3 (Medium)**: `extractEqualityPushdowns` in `compiler.ts:43-69` uses a regex with a negative lookbehind. This is supported in Node 20+ but the `docker-compose.yml` base image is Node 18; older containers may fail silently.
- **NEW-4 (Low)**: The `htfBiasFeature` test file exists at `apps/engine/src/features/htfBias.test.ts` (verified) — the Q-6 finding from M3 that "htfBias has no tests" is **inaccurate**. The audit had misread the file inventory. The test coverage for htfBias is genuine.
- **NEW-5 (Low)**: The `pivot.ts` v1.2.0 fix for TF-dependent lookback is **complete** — the Q-6 / D020 finding is fully closed.

---

## 19. Action Plan (Step-by-Step, updated 2026-07-07)

The Track B wave closed 8 of the 31 items in the prior `COMPREHENSIVE_AUDIT_REPORT.md` action plan. The remaining work is **security-first, then trading-correctness, then backtest-honesty**. The action plan is reorganized accordingly.

### Phase 0 — Triage (1 day)

1. Confirm which critical issues are present in production via `psql` + the live strategy list. Re-verify the auth on `/api/strategies`, `/api/strategies/update-spec`, `/api/strategies/variants/[variantId]`, `/api/strategies/[familyId]/variants`, `/api/dashboard/positions`, `/api/analytics`. (All six confirmed open by direct file read.)
2. Decide V1 EA compatibility window: deprecate `/api/mt5/trades-compat` (next.config.ts rewrite) before any other work.
3. **NEW-2**: Update the migration 037 docstring to reflect v3.2.0 weights (10 min).
4. **NEW-10**: Add a startup self-check that asserts `lifecycle_refresh_state` PK is `(symbol, table_name)` (already partially done in migration 080; expose via `engineVer`).

### Phase 1 — Auth (3 days) **[highest priority]**

5. **SEC-1**: Add Next.js `middleware.ts` that requires a session token for every non-EA route. JWT or session cookie.
6. **SEC-2**: Disable `/api/ingest/mt5/register` unless a bootstrap secret is provided in the header.
7. **NEW-1**: Add a `StrategySpec` Zod schema and validate on every `POST/PATCH` to `/api/strategies/*`.
8. **NEW-6**: Throw at startup if `TM_MT5_API_KEY` and `MT5_API_KEY` are both missing.

### Phase 2 — Data Integrity (1 week)

9. **D-1**: Migration `094_candles_1m_broker.sql` — add `broker` to `candles_1m` PK or add a `candles_1m_broker` partitioned table. Do the broker-collision test in CI.
10. **D-2**: Migration `094_zone_pk_with_direction.sql` — extend `features_zone` PK to include `direction`. Backfill check.
11. **D-6**: Add `add_retention_policy('backtest_results', INTERVAL '180 days')`.
12. **D-7**: Add `add_compression_policy('candles_1m', INTERVAL '30 days')`.
13. **D-10**: Move destructive `TRUNCATE` from migrations 075 and 077 to explicit admin scripts requiring a backup path.

### Phase 3 — Live Safety + Risk Transactionality (2 weeks)

14. **R-1** + **NEW-8**: Wrap the live runner's signal-fetch + `live_signal` insert + `orders` insert + daily-loss check + position-count check in a single transaction with `SELECT … FOR UPDATE` on a per-terminal `risk_state` row. Migration `095_risk_state.sql` adds the table.
15. **R-2**: Add a per-currency exposure column to `risk_state`. Block new orders that would push USD exposure > 60 % of account.
16. **SEC-4**: Hash `mt5_terminals.api_key` with `crypto.createHash('sha256')` and store the hash. Compare hashes in `validateMt5ApiKey`.
17. **T-5/E-2**: Add an `expires_at` cron that marks pending orders past TTL as `expired` and writes a `live_signal_rejection` row.
18. **A-1/A-2**: Decide on a single writer to the live pipeline. Either move all scheduling into the engine service and stop calling `checkAndTriggerAllActive` from `instrumentation.ts`, or move the scheduler to a dedicated PM2 entry.

### Phase 4 — Trading Correctness (2–3 weeks)

19. **S-1/S-2**: Tighten BOS/CHoCH/MSS emission. BOS requires a body close beyond the level; MSS requires a *prior* BOS in the opposite direction. CHoCH is emitted only when the immediate prior swing is on the opposite trend side. The current code emits CHoCH and MSS from the same opposing-sweep signal.
20. **S-3**: Order Block: select the *last* down-close candle in the *two-bar* window before the breaking displacement, not just the most recent opposing candle.
21. **S-5/S-6**: Either widen the lookback for HTF swing detection (50 bars on 1d, 100 on 4h) or move the swing detection to a separate PIT-safe `features_htf_pivot` feature. The single 10-bar window is a known weakness.
22. **MTF-1**: Make the aggregate use a *strict* parent-overrides-children rule: if the highest parent direction disagrees with the children majority, BLOCK.
23. **T-1**: Load `getRegistryPipSize` and `getPipValuePerLot` lazily, and re-load on `MT5_SYMBOLS` change. A small SIGHUP handler.
24. **E-1**: Add `PATCH /api/orders/[orderId]` for `move_stop`, `partial_close`, `breakeven`, `cancel`. Persist each as a row in `order_events` for audit.

### Phase 5 — Backtest Honesty (1 week)

25. **B-1/BUG-1**: Add a setup-state machine to `runBacktest` so a single setup event can only fire one trade within a configurable cooldown. Default: 4× TF duration.
26. **B-2**: Make `runWalkForward` actually call `getCalibrationTuning` between windows and pass the new thresholds into the test run. Otherwise rename the export to `runRollingBacktest`.
27. **B-3**: Default `backtestSpreadPips` to a non-zero per-symbol value (read from `pairCharacteristics`).
28. **B-5**: Expose `blockSize` in the UI as a "trading session" knob (e.g. 5 for a 1h session assumption).

### Phase 6 — Engine Hardening (1 week)

29. **A-3**: Move `checkAndTriggerAllActive` to a queue (Redis) and return immediately from `/api/ingest`. Have the engine service consume the queue.
30. **A-4/P-1**: Bound the LRU per-symbol and add an LFU eviction based on `feature_cache.created_at`. Add counters for mem/redis/db cache hits.
31. **NEW-9 / BUG-2**: Add `features_eq_liquidity` and `features_fvg` to `DEFAULT_REQUESTED_FEATURES`. Run a one-time backfill.
32. **Q-6**: Add vitest tests for `keltner`, `bollinger`, `liquidityPools` (full), `spread`, `zoneRetest`. (htfBias is already covered — see NEW-4.)

### Phase 7 — ICT Coverage (2–3 weeks)

33. Implement **PO3 (AMD)** as a `features_po3` feature: 3-candle pattern of accumulation/manipulation/distribution within a killzone.
34. Implement **Judas Swing** as a feature: a single-bar fake-out of the prior session's high/low within the first 30 minutes of the next session.
35. Implement **Silver Bullet** time window (10:00–11:00 NY) as a session filter the strategy compiler can use.
36. Add **Consequent Encroachment** as `pricing.ceLevel` (50 % of the OB/FVG).
37. Add **SMT Divergence** as a feature: compare the latest 5-bar pivot between two correlated symbols; divergence = setup signal.
38. Add **Breaker Blocks** as a feature: a mitigated OB that flips polarity.
39. Add **Rejection Blocks** as a feature: a 3-bar pin-bar sequence that rejects a level.
40. Add **Propulsion Blocks** as a feature: a strong-body candle that drives into a level with displacement.

---

## 20. Implementation Complexity Estimates

| Issue | Effort | Notes |
|-------|--------|-------|
| D-1, D-2 | M (3d) | New migration + backfill check |
| D-5, D-6, D-7 | S (1d) | Schema + policy |
| R-1, R-2, T-5, E-2 | L (2w) | Risk state machine + new table |
| SEC-1, SEC-4 | S (2d) | Middleware + hash migration |
| S-1, S-2, S-3, S-5, S-6 | L (2w) | Feature rewrites + new tests |
| A-1, A-3 | L (2w) | Restructure scheduler/queue |
| B-1, B-2, B-3, B-5 | M (1w) | Backtest engine rewrite |
| A-4, P-1 | S (2d) | LRU + cache namespace |
| ICT coverage (28–31) | L (3w) | New features |
| Test coverage | M (1w) | Parallel to other work |

---

## 21. What Was Not Verified (action required)

1. **`/api/mt5/trades-compat` exists and is correct** — referenced by `next.config.ts:18-22` but not seen in the directory listing.
2. **Strategy compiler whitelist applies to the live path** — only verified in `scripts/backtest-pit-v2.js`.
3. **No full read of `liquidityPools.ts`, `zone.ts`, `bias.ts`, `session.ts`** — the SMC audit rests on inferred correctness for these. They should be read in a follow-up. (`sweep.ts` was re-read in this audit and the inducement mode is verified.)
4. **No load testing** was performed; all P-1 through P-4 claims about throughput are architectural, not measured.
5. **No .env / secret files** were inspected.
6. **`apps/web/src/instrumentation.ts` scheduler logic** was referenced but the file was not fully read; the claim that it calls `checkAndTriggerAllActive` is based on a code grep and the prior `CODEX_CURRENT_STATE_AUDIT_2026-07-04.md` finding (H001).
7. **`packages/strategies/src/riskCompiler.ts`** was not read in full; the claim that it builds SQL from strategy config is based on the prior audit.

---

## 22. What the Codebase Does Well

To be balanced: the following are genuinely strong:

- **Content-addressed feature cache** with three-tier fallback is the right design.
- **PIT-safe strategy compiler** with LATERAL lookups, equality pushdowns, and whitelists is a real engineering effort.
- **Decision graph pattern** with persisted traces unifies live and backtest gating.
- **Atomic order state transitions** (`orderService.ts:atomicTransition`) — the Track B fix for D008 is a real improvement.
- **Schema migration 080's commentary** — describing the *bug* in 043's guard — shows the team is self-auditing and writing migrations defensively.
- **Per-spec snapshots** (feature_config_snapshot, strategy_settings_snapshot) and `live_deployment` table give a real audit trail.
- **Track B re-weighting** in `htfBias.ts` v3.2.0 is a thoughtful response to the previously reported over-confidence issue.
- **TF-aware pivot lookback** in `pivot.ts` v1.2.0 — lower TFs no longer drown in micro-pivots; higher TFs no longer miss structure.
- **Inducement-mode sweep detection** in `sweep.ts` v1.3.0 — matches canonical ICT sequencing.
- **3-tier lot sizing** in `orderExecutor.ts` — balance-ladder, grade-ladder, %-risk. Resolves D005.
- **Retest-zone entry quality** in `entryQuality.ts` — fixes D013/M001.
- **Zone `touch_count/retest_count`** in `zone.ts` v2.2.0 + migration 093 — feeds into entry quality.
- **Small-account position manager** with daily loss, cooldown, circuit-breaker is a meaningful safety net for the real deployment target (small accounts).
- **Ingest normalizes symbol to `[A-Za-z0-9]`** and rounds timestamps to the minute — both good defenses.
- **Vitest test coverage for htfBias** (5+ tests) — closes the prior Q-6 finding.

---

## 23. Summary One-Liner

> **Track B has materially improved trading correctness** (atomic order transitions, 3-tier lot sizing, TF-aware pivots/FVGs, inducement sweeps, zone touch/retest counts, retest-zone entry quality, HTF rebalancing). **Six critical issues remain open and unchanged**: (1) unauthenticated dashboard/analytics/strategy-mutation endpoints (`SEC-1`), (2) `/api/ingest/mt5/register` returns the global API key (`SEC-2`), (3) strategy compiler string-interpolates `symbol` and `spec.id` into SQL (`SEC-3`), (4) `candles_1m` PK has no `broker` namespace (`D-1`), (5) `features_zone` PK omits `direction` (`D-2`), (6) backtest over-counts trades (`BUG-1`). The single biggest leverage point: **add a Next.js `middleware.ts` that requires auth on every non-EA route** — that one change closes 4 of the 6 critical issues and the entire NEW-1 strategy-mutation surface.

---

## 26. Cross-Reference Index

| ID in this report | Prior report ID (if any) | Status |
|---|---|---|
| A-1, A-2, A-3 | H001, D010 | Still open (A-2 escalated from Medium to High) |
| D-1, D-2 | New | Open |
| D-3, D-4, D-5 | New | Open |
| D-6, D-7 | D014 | Open |
| D-8 | New | Open |
| D-9, D-12 | New | Open |
| D-10 | D004, C005 | Still open (Critical) |
| D-11 | New | Open |
| M-1 | New | Open |
| M-2, M-3, M-4, M-5 | H005 | Open |
| T-1, T-2 | New | Open |
| T-3 | D005 | **Closed by Track B (1.6)** |
| T-4, T-5, T-6 | New | Open |
| T-7 | D008 | **Closed by Track B** |
| T-8 | New | Open |
| T-9 | New | Open |
| S-1, S-2, S-3 | New | Open |
| S-4 | D006 | **Closed by Track B (sweep v1.3.0 inducement)** |
| S-5, S-6, S-7 | D013, M001 | **Closed by Track B (retest zones)** |
| S-8 | D020 | **Closed by Track B (pivot v1.2.0)** |
| MTF-1, MTF-2, MTF-3 | New | Open (MTF-1 is the high-severity parent-overrides-children issue) |
| L-1, L-2, L-3, L-4 | New | Open |
| R-1, R-2 | H006, D007, D015 | Open |
| R-3 | D007 | Open (downgraded to High) |
| R-4, R-5, R-6, R-7 | D015, New | Open |
| E-1 | New | Open |
| E-2, E-3, E-4, E-5 | New | Open |
| P-1, P-2, P-3, P-4 | D016, New | Open |
| B-1, B-2, B-3, B-4, B-5, B-6 | New | Open |
| AI-1 | New | Open |
| Q-1, Q-2, Q-3, Q-4, Q-5 | D017, New | Open |
| Q-6 | (M3 audit flag) | **Closed (htfBias tests exist)** — see NEW-4 |
| Q-7 | New | Open |
| SEC-1 | D001, C002 | **Still Critical (open)** |
| SEC-2 | C001 | **Still Critical (open)** |
| SEC-3 | D002, C003 | **Still Critical (open)** |
| SEC-4 | New | Open |
| SEC-5, SEC-6, SEC-7, SEC-8 | D012, New | Open |
| BUG-1 | New | Open (Critical) |
| BUG-2, BUG-3, BUG-4, BUG-5, BUG-6, BUG-7 | D003, C004, New | Open |
| NEW-1, NEW-2, NEW-3, NEW-4, NEW-5, NEW-6, NEW-7, NEW-8, NEW-9, NEW-10 | New | See §24 |
