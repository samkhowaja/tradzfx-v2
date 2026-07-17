# Pipeline Reliability Fix Plan

## Root Cause Summary

**Layer 1 — Ingestion DB timeout death spiral (immediate cause)**
- `idle_in_transaction_session_timeout` killed pool connections at 01:56 UTC
- `TM_DB_IDLE_IN_TRANSACTION_TIMEOUT` env var sets `-c idle_in_transaction_session_timeout` — if a query leaves an open transaction, PG kills the connection
- Pool's `error` handler logs the eviction but does NOT replace the connection — Node.js pg.Pool auto-replaces on `pool.on('error')` **if** the error is a client-level disconnect. `idle_in_transaction` termination arrives as a `client error` on the pool but the pool reuses dead sockets because `idleTimeoutMillis: 30000` doesn't force-recycle them fast enough
- By 06:00 UTC the pool was fully wedged: `timeout exceeded when trying to connect` on every new attempt
- Last candle ingested: 08:44 UTC. From ~08:54 UTC, scheduler's `NOW() - 10min` query stopped seeing EURUSD → pipeline halted entirely
- No alerting, no fallback

**Layer 2 — Structural endTs vs wall clock mismatch (contributing)**
- `checkAndTriggerAllActive()` uses `MAX(ts) FROM candles_1m` as `endTs` AND as bucket anchor
- If candle timestamps lag behind wall clock (batched ingestion), features compute for past time
- `stale_data` gate in `liveRunner.ts` compares feature/candle age against `Date.now()` (wall clock), not `endTs`
- Result: features look stale immediately after compute → all signals rejected as `stale_signal`/`stale_state_feature`
- Even when pipeline runs, it produces zero signals because freshness gates compare against wrong clock

---

## Systematic Fixes

### Fix 1 — Scheduler: decouple from candle freshness

**Problem:** `instrumentation.ts` skips symbols with no candles in last 10min. Once candles stall, pipeline stops entirely — even if we wanted to run with stale data and let freshness gates handle rejection.

**Fix:** Replace `NOW() - 10min` query with active-variant query. Scheduler runs for every symbol that has active live deployments, regardless of candle age.

**Files:**
- `apps/web/src/instrumentation.ts`

**Change:**
```typescript
// BEFORE:
const { rows } = await pool.query(
  `SELECT DISTINCT symbol FROM candles_1m WHERE ts >= NOW() - INTERVAL '10 minutes' ORDER BY symbol`
);

// AFTER:
const { rows } = await pool.query(
  `SELECT DISTINCT sv.symbol
   FROM strategy_variants sv
   JOIN strategy_families sf ON sf.family_id = sv.family_id
   WHERE sf.status = 'active'
     AND sv.status = 'active'
     AND (sv.live_config->>'mode' IS NULL OR sv.live_config->>'mode' != 'disabled')
   ORDER BY sv.symbol`
);
```

**Effect:** Pipeline always attempts to run for active symbols. If data is truly stale, the `stale_data`/`stale_signal` gates will still reject — but the pipeline at least tries. When ingestion recovers, no gap in pipeline execution.

**Risks:** Slight CPU overhead for symbols with stale data (rejected every ~60s). Negligible — 6 active variants x 60s = 6 rejected runs/min.

---

### Fix 2 — endTs derived from wall clock, not candle timestamp

**Problem:** Both `checkAndTriggerAllActive()` and the single-variant path use `MAX(ts) FROM candles_1m` as `endTs` for feature engine AND as bucket anchor. If candle ts lags wall clock (batched MT5 sync), the pipeline computes features and signals for the wrong time window.

**Fix:** Use `endTs = new Date()` (wall clock) always. Keep the candle `MAX(ts)` query only to detect "no data at all" (return early if zero candles). The bucket is anchored to current 15m boundary.

**Files:**
- `apps/web/src/lib/pipelineTrigger.ts`

**Change in both `checkAndTriggerAllActive` and the single-variant `checkAndTrigger`:**
```typescript
// BEFORE:
const { rows } = await pool.query(
  `SELECT ts FROM candles_1m WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
  [symbol]
);
if (rows.length === 0) return { ... reason: "no_candles" };
const latestTs = new Date(rows[0].ts);
const bucket = get15mBucket(latestTs);

// AFTER:
const { rows } = await pool.query(
  `SELECT ts FROM candles_1m WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
  [symbol]
);
if (rows.length === 0) return { ... reason: "no_candles" };
const latestCandleTs = new Date(rows[0].ts); // for feature engine context only
const now = new Date();
const bucket = get15mBucket(now);             // bucket anchored to wall clock
const endTs = now;                            // features computed for NOW, not candle ts
```

**Why this is safe:**
- Feature engine uses `endTs` as upper bound for candle fetching, not as "current time" — `fetchCandles()` in DAGRunner queries `ts <= endTs`. Using wall clock means it sees all candles up to now, which is a superset of what candle-based endTs would see.
- Lifecycle refresh uses `asOf: latestTs` — this should remain at candle ts (don't mark zones invalidated in the future).
- Bucket anchor at wall clock prevents re-processing the same 15m window when candles don't advance.

**Risks:** None. The engine asks for `lookbackBars` count candles ending at `endTs` — wall clock ensures it sees every candle that exists. Only difference: if candle timestamps are far behind (hours), the pipeline may trigger multiple rapid buckets as 15m boundaries pass. Mitigation: `acquirePipelineBucket` deduplicates by bucket number.

---

### Fix 3 — `liveRunner.ts`: stale_data gate uses evaluation ts, not Date.now()

**Problem:** `stale_data` gate compares `Date.now() - latestTs.getTime()` against `CANDLE_MAX_AGE_MINUTES`. If pipeline runs on time but candles lag (MT5 batched ingestion), gate fires even though data is fresh relative to ingestion clock.

**Fix:** Accept an optional `evaluationTs` parameter in `runLivePipeline`. If provided, use it instead of `Date.now()` for age calculations. Default to `Date.now()` for backward compat.

**Files:**
- `packages/tradePipeline/src/liveRunner.ts`
- `apps/web/src/lib/liveRunner.ts` (pass `endTs` through)

**Change in `LiveRunOptions`:**
```typescript
export interface LiveRunOptions {
  // ... existing fields ...
  /** Timestamp of pipeline evaluation. If provided, used instead of Date.now()
   *  for stale_data and stale_signal checks. Set to the endTs used for feature
   *  computation. */
  evaluationTs?: Date;
}
```

**Change in `stale_data` check:**
```typescript
// BEFORE:
const candleAgeMinutes = (Date.now() - latestTs.getTime()) / 60_000;

// AFTER:
const now = opts.evaluationTs ?? new Date();
const candleAgeMinutes = (now.getTime() - latestTs.getTime()) / 60_000;
```

**Change in `stale_signal` check:**
```typescript
// BEFORE:
const signalAgeMinutes = (Date.now() - signal.ts.getTime()) / 60_000;

// AFTER:
const signalAgeMinutes = (now.getTime() - signal.ts.getTime()) / 60_000;
```

---

### Fix 4 — `checkFeatureFreshness`: same evaluationTs fix

**Files:**
- `packages/tradePipeline/src/liveRunner.ts`

**Change:** Pass `evaluationTs` to `checkFeatureFreshness`. The function queries `MAX(ts)` per feature table and compares against `Date.now()` — same wall-clock mismatch.

```typescript
// BEFORE (line 990 in liveRunner.ts):
const now = Date.now();

// AFTER:
const now = evaluationTs?.getTime() ?? Date.now();
```

---

### Fix 5 — `acquirePipelineBucket`: fail-open after retry, or at least warn loudly

**Problem:** On DB error, `acquirePipelineBucket` returns `false` (fail-closed). During DB flapping, this causes pipeline to silently skip every tick. The only log is `[pipelineState] Failed to acquire bucket` at `console.error` level — but nobody reads console.error continuously.

**Fix:** Add exponential backoff retry (1 attempt, 1 retry after 1s). If both fail, return `true` (permit pipeline run) but write a prominent WARNING. During a DB blip, running the pipeline with a DB warning is safer than silently stalling for hours.

**Files:**
- `packages/shared/src/utils/pipelineState.ts`

**Change:**
```typescript
export async function acquirePipelineBucket(
  pool: Pool,
  symbol: string,
  bucket: number,
  retries = 1
): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { rows } = await pool.query(/* ... same INSERT ... */);
      return rows.length > 0;
    } catch (err: any) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      console.error(
        `[pipelineState] FAILED to acquire bucket for ${symbol} after ${retries+1} attempts:`,
        err.message,
        `— returning true (fail-open) to avoid pipeline stall`
      );
      return true; // fail-open: permit run, let downstream gates handle freshness
    }
  }
  return false; // unreachable
}
```

**Risks:** During a DB outage, multiple pipeline runs may execute in parallel (no bucket lock). `live_signal` and `live_signal_rejection` tables have no UNIQUE constraint on `(symbol, strategy_id, signal_fingerprint)`. Before deploying fail-open, add a unique constraint or accept that duplicate rejection rows may appear (benign — each run produces the same signal, downstream dedup). Add migration:

```sql
-- Prevent duplicate live_signal rows when pipeline runs in parallel
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_signal_dedup 
  ON live_signal(symbol, strategy_id, signal_fingerprint) 
  WHERE signal_fingerprint IS NOT NULL;
```

---

### Fix 6 — ingestion server: pool health recovery

**Problem:** When PG kills idle-in-transaction connections, the pg.Pool does not immediately replace them. The pool enters a state where `pool.query()` hangs until `connectionTimeoutMillis` (5s) per attempt, then fails. No automatic pool drain/recreate.

**Fix:** Add a health-check endpoint on :3004 that periodically tests `SELECT 1` and logs pool stats. Add PM2 `max_restarts` and `min_uptime` to force restart on repeated failure. Add a periodic pool health check that drains and recreates if dead connections accumulate.

**Files:**
- `scripts/ingestion-server.js`
- `ecosystem.config.js`

**Change in ingestion server — add periodic `SELECT 1` probe:**
```javascript
// Every 30s, verify pool health. If SELECT 1 fails 3x consecutively,
// force the pool to drain and create a new one.
let consecutiveHealthFailures = 0;
setInterval(async () => {
  try {
    await pool.query('SELECT 1');
    consecutiveHealthFailures = 0;
  } catch (err) {
    consecutiveHealthFailures++;
    log('warn', 'ingestion health check failed', { count: consecutiveHealthFailures, error: err.message });
    if (consecutiveHealthFailures >= 3) {
      log('warn', 'forcing pool drain due to consecutive health failures');
      try { await pool.end(); } catch {}
      // Re-create pool (module-level var)
      Object.assign(module.exports, { pool: null });
      // Force reload via process.nextTick restart
      process.exit(1); // PM2 autorestart will recreate
    }
  }
}, 30_000);
```

**Change in `ecosystem.config.js` for `tz-ingestion`:**
```javascript
{
  name: 'tz-ingestion',
  script: 'scripts/ingestion-server.js',
  // ... existing ...
  autorestart: true,
  max_restarts: 20,
  min_uptime: 10000,
  restart_delay: 5000,
}
```

---

### Fix 7 — pipeline health monitoring (dashboard-visible)

**Add a health endpoint** that reports per-symbol pipeline state:

```sql
CREATE OR REPLACE VIEW pipeline_health AS
SELECT
  sv.symbol,
  sv.variant_id,
  sv.status AS variant_status,
  COALESCE(pts.updated_at, '1970-01-01'::timestamptz) AS last_pipeline_run,
  EXTRACT(EPOCH FROM NOW() - COALESCE(pts.updated_at, '1970-01-01'::timestamptz)) / 60 AS minutes_since_run,
  CASE
    WHEN lr.rejection_ts IS NOT NULL THEN lr.rejection_ts
    ELSE NULL
  END AS last_rejection_ts,
  lr.reason AS last_rejection_reason,
  CASE
    WHEN EXTRACT(EPOCH FROM NOW() - COALESCE(pts.updated_at, '1970-01-01'::timestamptz)) > 30 * 60 THEN 'stale'
    WHEN EXTRACT(EPOCH FROM NOW() - COALESCE(pts.updated_at, '1970-01-01'::timestamptz)) > 15 * 60 THEN 'warning'
    ELSE 'healthy'
  END AS status
FROM strategy_variants sv
LEFT JOIN strategy_families sf ON sf.family_id = sv.family_id
LEFT JOIN pipeline_trigger_state pts ON pts.symbol = sv.symbol
LEFT JOIN LATERAL (
  SELECT ts AS rejection_ts, reason
  FROM live_signal_rejection
  WHERE symbol = sv.symbol
    AND strategy_id = sv.variant_id
  ORDER BY ts DESC
  LIMIT 1
) lr ON true
WHERE sf.status = 'active' AND sv.status = 'active';
```

**Add endpoint:** `GET /api/v2/pipeline/health` that queries this view and returns JSON.

**Add alert integration** in `ops/monitor-v2-health.ps1`: check `minutes_since_run` for each active symbol and emit alert if >30min.

**Files:**
- New migration for view
- `apps/web/src/app/api/v2/pipeline/health/route.ts`
- `ops/monitor-v2-health.ps1`

---

### Fix 8 — add DB pool keepalive

**Problem:** No keepalive on DB pool connections. If a firewall/load balancer drops idle connections, they silently die and aren't replaced until used.

**Fix:** Add `keepAlive: true` and `keepAliveInitialDelayMillis: 10000` to both pools.

**Files:**
- `packages/shared/src/utils/db.ts`
- `scripts/ingestion-server.js`

**Change:**
```typescript
// In getPool():
const config: PoolConfig = {
  // ... existing ...
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

// In ingestion-server.js:
const pool = new Pool({
  // ... existing ...
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});
```

---

## Implementation Order

| # | Fix | Effort | Impact | Dependency |
|---|-----|--------|--------|------------|
| 1 | Scheduler: use active variants not candle age | 15min | **Critical** — without this, pipeline never starts after ingestion stall | None |
| 2 | endTs from wall clock | 30min | **Critical** — fixes stale rejections when candles lag | None |
| 3 | evaluationTs in liveRunner | 30min | **Critical** — fixes false-positive stale_data/signal | Fix 2 (pass endTs) |
| 4 | checkFeatureFreshness evaluationTs | 15min | **Critical** — fixes false-positive feature freshness | Fix 3 (same param) |
| 5 | acquirePipelineBucket fail-open + retry | 15min | **Critical** — prevents DB blip from stalling pipeline | None |
| 6 | Ingestion pool health recovery | 45min | **High** — prevents 6h death spiral | None |
| 7 | Pipeline health monitoring | 1h | **High** — provides visibility into stalls | None |
| 8 | DB pool keepalive | 10min | **Medium** — prevents silent connection drops | None |

## Deployment Sequence

1. **Apply Fixes 1-5** (pipeline logic, no infra changes) — deploy web app restart
2. **Apply Fix 6** (ingestion server changes) — restart `tz-ingestion` PM2 process
3. **Apply Fix 8** — restart both web + ingestion
4. **Apply Fix 7** — deploy new API endpoint + run migration
5. **Verify**: observe `pipeline_health` view showing `healthy` for all active symbols within 15min

## Rollout Guard

Before Fix 5 (fail-open), confirm that `live_signal_rejection` deduplication works at DB level. Check existing schema:

```sql
SELECT conname, conrelid::regclass FROM pg_constraint 
WHERE conname LIKE '%live_signal%' OR conname LIKE '%live_order%';
```

If no unique constraint on `(symbol, strategy_id, signal_fingerprint)`, add one before deploying fail-open to prevent signal duplication during DB flapping.

## Acceptance Criteria

After all fixes deployed and running for 24h:
- [ ] 100% of 15m buckets claimed for every active symbol (±1 bucket tolerance for timing)
- [ ] Zero cascading DB timeout failures (ingestion pool recovers without restart)
- [ ] Scheduler runs even when candles are stale (logs show pipeline attempt, not silent skip)
- [ ] Live signals produced within 15m of ingestion recovery (no manual restart needed)
- [ ] Pipeline health view shows no status=stale for >15min during normal operation
- [ ] `ops/monitor-v2-health.ps1` reports green at every poll cycle
