# AGENTS.md — tradzfx-v2

## Project conventions

- **Package manager:** pnpm. Never use `npm` or `yarn` directly.
- **Web app:** Next.js 15 App Router. Server components by default; mark client components with `"use client"`.
- **Styling:** Tailwind CSS v4. Prefer semantic tokens (`--bg`, `--surface`, `--text`, `--brand`) over raw colors.
- **Testing:** Vitest. Run `pnpm test` before committing.
- **TypeScript:** Strict. Build with `pnpm -r build`.

## Strategy specs

- Canonical specs live in `packages/strategies/src/specs/*.yaml`.
- Each YAML is a full variant. Related variants can share a `familyId` (e.g., `keylevel_bounce_v1.yaml` sets `familyId: keylevel_bounce`).
- Standalone specs should set `familyId` equal to their `id`.
- Seed families + variants into the DB with `node scripts/seed-strategy-specs.js`.
  Seeding runs `validateSpec()` (packages/strategies/src/validate.ts) and fails
  fast on structural errors — invalid specs never reach the DB.
- **Pre-seed temporal gate:** `pnpm db:seed:check` (same as seed + `--check` flag).
  After seeding, runs `check-temporal-alignment.js --all-specs` which queries
  actual consecutive-row gaps per condition and compares against each condition's
  lookback window. Exits 1 if any condition's median gap exceeds its lookback
  window (data gaps would starve the feature). Standalone: `pnpm db:alignment`
  or `node scripts/check-temporal-alignment.js <variantId> [--all-specs]`.
  Always run `pnpm db:seed:check` before `pnpm promote-live` when adding/modifying
  specs that use new feature/tf combinations.
- Promote variants to live trading with `node scripts/promote-top3-live.js` (edit the `LIVE_VARIANTS` list as needed).
- `warmupBars` (optional, top-level): bars of signal-tf history skipped at the start of a PIT backtest so features stabilize. Defaults to 200; seed-time validation rejects values below 50.
- Per-variant backtest reports are served from `/api/strategies/variants/[variantId]/backtest` and rendered inside the strategy detail view.

### Spread unit contract (candles_1m.spread, features_spread)

### Broker identity contract

- `platform=mt5` runs on broker server `1x Trade Ltd.`. `MT5` is not broker identity.
- `platform=mt4` runs on broker `OANDA Corporation`.
- Store terminal platform and broker server separately. Do not label MT5 candles with broker `MT5`.
- Historical raw rows with `broker='MT5'` remain immutable evidence. Migration `182_broker_identity_corrections.sql`
  records this legacy label and `raw.effective_broker_identity()` maps it to `1x Trade Ltd.` for canonical reads.
  Historical `broker='MT4'` maps to `OANDA Corporation` under same evidence ledger. Never blind-update raw rows.

- `candles_1m.spread` is **pips**, always. MT5 reports spread in points; every
  writer MUST convert: pip = 10 points for 5/3/2-digit quoting, pip = 1 point
  for 4-digit quoting (e.g. USDSEK). Canonical conversion:
  `pointsToPips()` in `packages/shared/src/pairs/pipMath.ts`
  (`getPipSize(digits)` is the single source of truth); the ingestion server
  mirrors it (`scripts/ingestion-server.js`).
- `features_spread` is a **1m feature** (producer averages the last 20 valid 1m
  candles regardless of requested tf). Consumers read `@1m` only; the live
  setup engine and spread gate both do.
- Sanity ceiling: samples/rows above `baseSpreadPips * SPREAD_SANITY_MULTIPLIER`
  (10, exported from `packages/shared/src/pairs/pairCharacteristics.ts`) are
  implausible and are dropped (producer), capped (setup engine), or quarantined
  to the session model (backtest). `candles_1m` is the source of truth —
  feature rows must equal the producer function applied to current candles.
- Exotic pairs with structurally wide spreads (e.g. USDSEK, median ~32p) MUST
  have a `pairCharacteristics` registry entry with a realistic `baseSpreadPips`;
  otherwise the default 2.0 makes every live setup block on spread.

### Session-scoped features (features_opening_range)

- `features_opening_range` rows are keyed by `(symbol, tf, date, session, range_minutes)`
  with `ts` = **range completion time** (session start + rangeMinutes), not the bar
  that triggered the compute. The producer (`apps/engine/src/features/openingRange.ts`)
  and all SQL joins share session start hours from `ORB_SESSION_START_HOUR_UTC`
  in `packages/shared/src/utils/time.ts` (derived from `DEFAULT_SESSION_WINDOWS`).
- Registry join policy `session_scoped` (featureRegistry.ts): consumers MUST pin the
  row to the anchor's UTC date + spec-declared session + tf-derived range length and
  require `ts <= anchor`. Implemented once in `buildOrbSessionScopedJoin()`
  (packages/strategies/src/sqlBuilder.ts) and used by the compiler, the legacy PIT
  fork, and setup/entry LATERALs.
- Any spec condition on `features_opening_range` MUST declare `session: asia|london|ny`
  (lowercase — producer case; `features_session` and spec session filters are uppercase).
  SQL generation throws on a missing/invalid session; `validateSpec()` catches it at seed time.
- After changing the producer's serialize/ts semantics, re-backfill:
  `node scripts/backfill-historical-features.js <SYMS> 5m,15m --features=features_opening_range`.

## Graphify

This repo ships with a graphify runner to visualize the codebase as a knowledge graph.

```bash
pnpm graphify
```

Generated files go to `graphify-out/` (gitignored). Curated snapshots are copied to `docs/graphify/`.

## Backtest data

Curated backtest seed reports live in `data/backtest-seed/`. Regenerate with:

```bash
node scripts/backtest-pit-v2.js ALL 90 <variantId> --persist
node scripts/run-pit-historical.js 90 data/backtest-seed/historical-pit-90d
node scripts/run-pit-walkforward.js 30 15 data/backtest-seed/walkforward-30d-15d
```

### PIT backtest runner modes

- `--mode=fast` — skip setup-engine evaluation (fast signal generation).
- `--mode=full` — run setup-engine evaluation (default).
- `--mode=deterministic` — strict setup + `close` intrabar resolution.
- `--setup-profile=strict|lenient|skip` — override setup-engine behavior.
- `--intrabar=sl_first|tp_first|close|random_walk|momentum` — override intrabar resolution.

`--mode` presets can be overridden by explicit `--setup-profile` or `--intrabar` flags.

- **Preflight quality gate:** `node scripts/backtest-pit-v2.js <SYM> <days> <variant> --preflight` prints coverage + a per-symbol **Data quality verdict** and exits **1** on `BLOCKED_SYSTEM_QUALITY` (lifecycle corruption, `candles_1m=0`, or any required dense feature/candle empty over the window). In a full run, a blocked symbol is skipped (marked result, `executed:0`) instead of reporting a misleading "0 trades". Empty required event features (sweep/structure/displacement) are `DEGRADED` (warn), not block.

## Importing candles and backfilling historical features

MT5-exported 1m CSVs can be imported into `candles_1m`:

```bash
node scripts/backfill-candles-from-mt5-csv.js <dir> --tz-offset-minutes=180 --broker=MT5
```

The backfill applies the same corrupt-bar policy as live ingest: geometrically
invalid bars (non-finite / `high<low` / negative) are rejected, and magnitude-suspect
1m bars (`(high-low)/pipSize > 1000` pips) are **kept** in `candles_1m` but flagged
`is_suspect` in `candle_quality` (PIT-preserving; downstream ATR winsorizes and the
backtest quarantines them). So `candle_quality` is populated for backfilled history
too — a retrospective scan of the existing 107k XAUUSD 1m bars found 0 suspect.

The HTF candle tables (`candles_5m/15m/1h/4h/1d_*`) are TimescaleDB continuous
aggregates over `candles_1m`. After importing new 1m history, refresh the caggs
over the full range so historical HTF buckets materialize (otherwise HTF
features such as bias/pricing/structure at 5m/15m/1h are sparse for backtest
windows):

```bash
node scripts/refresh-candle-caggs.js            # full candles_1m range
# or: node scripts/refresh-candle-caggs.js 2026-01-01 2026-07-09
```

Then run a full historical feature backfill:

```bash
# Fast backfill for the PIT backtester. Skips zone outcome recording during
# the run; outcomes can be backfilled separately if needed.
export ZONE_BACKFILL_SKIP_OUTCOMES=1
node scripts/backfill-historical-features.js [SYMBOL1,SYMBOL2,...] [tf1,tf2,...]
```

Defaults:
- Symbols: every symbol present in `candles_1m`.
- Timeframes: `1d,4h,1h,5m` (processed high-to-low so HTF bias finds context).
  Pass a comma-separated list as the second positional argument to override,
  e.g. `1d,4h,1h,15m,5m`.
- Features: the closure needed by the PIT backtester (`features_correlation` and
  `features_spread` are excluded because they need DXY / only the latest row).

Run `pnpm db:migrate` before backfilling; migration `080_lifecycle_pk_fix.sql`
fixes the `lifecycle_refresh_state` primary key that earlier migrations left as
`(symbol)` instead of `(symbol, table_name)`.

## Lifecycle refresh

Zone lifecycle/outcomes are refreshed by the PM2 app `tz-refresh-lifecycle`
(`scripts/refresh-lifecycle-cron.js`), which runs
`node scripts/refresh-lifecycle.js ALL 2 5000` every 6h (env-tunable via
`REFRESH_LIFECYCLE_INTERVAL_MS`, `REFRESH_LIFECYCLE_LOOKBACK_DAYS`,
`REFRESH_LIFECYCLE_LIMIT`). A full rescan (`ALL 30 10000`, deletes
`lifecycle_refresh_state`) is a manual/weekly op.

## Live feature pipeline & lifecycle (operational)

- **Worker is off by default** (`TM_DISABLE_FEATURE_JOBS=true`). The only live
  compute on the hot path is the inline `runFeatureEngine()` on the 15m trigger
  (`apps/web/src/lib/pipelineTrigger.ts`). The inline lifecycle call is a
  **non-blocking 25s `Promise.race`** so the 60s web pool can never freeze on
  lifecycle; correctness is owned by scheduled maintenance, not the inline call.
- **Lifecycle is scheduled maintenance.** Run `node scripts/refresh-lifecycle.js
  <SYMBOL> [lookbackDays=2] [limit=2000]` for every active symbol on a 15–30 min
  cadence (PM2 / Task Scheduler). It uses a maintenance pool
  (`statement_timeout=0`) and advances `lifecycle_refresh_state` per table
  (`features_zone`, `features_ifvg`, `features_order_block`, ...). Migration
  `104_lifecycle_lateral_bound.sql` bounds the zone touch/retest scan to a 5-day
  forward horizon (death-spiral fix, SK-24/26); the function now completes and
  the cursor advances every call.
- **Producer ledger:** every engine flush and lifecycle run writes a row to
  `feature_producer_runs` (migration 103) via `packages/shared/src/db/producerRuns.ts`
  (`startProducerRun` / `finishProducerRun` / `assertProducerFresh`). Use it to
  answer "is producer X for symbol Y fresh?" and to catch silent stalls.
- **Producer-freshness gate:** `packages/tradePipeline/src/gates/producerFreshness.ts`
  (`createProducerFreshnessGate`) is wired into `liveRunner`. Default action is
  **`warn`**; flip to hard block with `TM_PRODUCER_STALE_ACTION=block` only after
  the §7 acceptance boxes are green. Per-feature max-age defaults: level 30m,
  state 10m, distribution 24h; sparse event tables are never blocked.
- **Scoped recompute (data-clock anchored, SK-66 guarded):** `node scripts/recompute-feature-recent.js
  [symbol] [feature] [hours] [tfs] [lookbackBars] [--recompute-deps] [--htf-safe] [--use-cache]`
  recomputes one feature over a trailing window anchored to each tf's `MAX(ts)` (the
  data clock lags wall clock by hours). **Leaf** features (no DAG deps, e.g.
  `features_atr`) default to `skipCache:true` (needed when an `input_hash` covers o/h/l/c
  only, e.g. ATR v1.1.0 → v1.2.0); pass `--use-cache` to read the cache instead.
  **Derived** features (anything with DAG deps, e.g. `features_direction_state`,
  `features_bias`) are REFUSED by default — a `skipCache` recompute rewrites the full
  dependency closure and a short trailing lookback starves HTF context. The guard also
  aborts any run that would persist rows for a feature other than the requested one.
  The exact 2026-07-10 poisoning command now exits 2 before touching the DB.
- **Feature cache key includes engine_ver (SK-57 RESOLVED):** `feature_cache` is keyed by
  `(feature_name, input_hash)` and `input_hash` is now built by `buildCacheInputHash()` in
  `apps/engine/src/dag/runner.ts` as `${engine_ver}:${content}:${symbol}:${tf}:${ts}`. Previously the
  version was omitted, so identical inputs across an engine bump collided and the cache returned
  the PRE-bump output, short-circuiting compute+persist of the corrected row (the real reason ATR
  v1.1.0 → v1.2.0 needed a manual `skipCache:true` recompute). With the version in the key, a bump
  is an automatic cache miss → recompute → persist of the new `engine_ver` row. Pre-fix state:
  88,424 cache rows, 0 versioned; new keys read `1.2.0:<content>:XAUUSD:1h:<ts>` (ATR is v1.2.0).
  Old unversioned rows are simply orphaned (harmless).
- **Producer-run ledger tells the truth (SK-62 RESOLVED):** a batch `INSERT` is atomic, but
  `DAGRunner.insertRows` used to log a failed insert and STILL record `status='done'` with
  `rows_inserted = attempted` — a fully-rejected batch looked healthy ("done masks per-row
  rejections"). It now uses `computePersistOutcome()` (apps/engine/src/dag/runner.ts): on throw,
  `status='error'`, `rows_inserted=0`, `rows_rejected=attempted`; on success, real `rowCount` is
  used and `rows_rejected = attempted - inserted`. The run also writes `quality_json`
  `{rows_seen, rows_attempted, rows_deduped, rows_inserted, rows_rejected}`. (assertProducerFresh
  filters `status='done'`, so a rejected batch now reads as stale instead of healthy.)
- **Volatility percentile rejects typos (SK-62 RESOLVED):** `pctToColumn()` in
  `packages/tradePipeline/src/gates/volatilityGate.ts` now THROWS on unknown percentiles instead
  of silently coercing to `p95`, and `createVolatilityGate()` validates every configured percentile
  once at load (`maxAtrPercentile`, `minAtrPercentile`, `session*Percentile`,
  `regimeRelax.relaxToPercentile`). This killed the `NY: 0.98` no-op. The four live occurrences
  (families `orb_classic`, `smart_risk_ob_ifvg_1m`, `watukushay` base_spec + `watukushay_no1`
  override, and their YAML seeds) were corrected `0.98 → 0.95` — **behavior-identical** (0.98 was
  coercing to p95 anyway); verified all four still construct under the strict gate and resolve
  NY→p95, re-scan of strategy_families/strategy_variants is clean.
- **Destructive-migration guard (SK-51 RESOLVED):** `migrationRunner.ts` now refuses any
  migration containing `TRUNCATE` / `DROP TABLE` / `DROP COLUMN` / `DELETE`-without-`WHERE` on a
  protected table (orders, trades, signals, setup_evaluations, backtest_results/runs,
  strategy_families/variants/specs, feature_producer_runs, candle_quality,
  market_volatility_profile, lifecycle_refresh_state, and all `candles_*`/`features_*`) that
  actually holds data. Empty/missing tables pass (fresh bootstrap not blocked); live data requires
  `TM_ALLOW_DESTRUCTIVE=1` after a backup. Classifier = exported pure `findDestructive()`; tested
  (blocked-with-data / allowed-empty / allowed-with-override / benign-unaffected). Verified it flags
  the real `075`/`077` migrations.
- **Candle coverage + source (SK-10 + SK-08 CLOSED):** candle coverage is now
  market-calendar-aware (FX 24/5: Sun 21:00 UTC → Fri 21:00 UTC, matching the `candles_1d_ny`
  boundary). `packages/shared/src/utils/marketCalendar.ts` adds `isTradableInstant`,
  `expectedTradableBars`, `tradableBarStarts`, `gapInfo`; `candleSource.ts` uses them so
  weekends/closed hours are NOT gaps and `getCandles` no longer false-falls-back over a normal
  week. The rollup path now carries `tick_count` (per-bucket 1m fullness), and `getLatestCandle`
  selects `tick_count` on 5m/15m/1h/4h. Migration `106_candle_coverage_market_calendar.sql`
  (ADD COLUMN, non-destructive) adds `expected_tradable_bars/gap_count/largest_gap_minutes/source`;
  `recordCandleCoverage` persists them. `scripts/check-candle-coverage.js XAUUSD 90` shows real
  tradable coverage (5m/15m/1h ≈92% → rollup; 1d cagg). The engine hot path
  `apps/engine/src/dag/runner.ts::fetchCandles` now routes through `getRecentCandles` (count-based,
  gap-tolerant) **by default** — parity-verified byte-identical (incl. `tick_count`) to the old
  direct query on a complete window; legacy path kept behind `TM_ENGINE_CANDLE_SOURCE=0` as a kill
  switch. Per-symbol daily breaks ARE modelled (`DAILY_BREAKS_BY_SYMBOL`; XAUUSD halts 21:00 UTC — verified:
  2 bars in 30 days at 21:00); `isTradableInstant(ts, symbol)` threads the symbol through coverage/gap math so
  metals stop false-flagging the daily pause (XAU 1m coverage 91.9% -> 99.0% after break fix + the Jul 6-7 repair).
  Holidays deliberately NOT modelled: the 1xTrade feed streams metals 24/5 through US holidays
  (verified 2026-07-11 — Memorial Day, Juneteenth, Jul-3 all have full 1,440-bar days from the
  broker; 90d XAUUSD 1m coverage gaps=0), so holiday hours are genuinely tradable and excluding
  them would mask real gaps. If a future broker's feed closes for holidays, layer a date-keyed
  calendar behind `isTradableInstant` (no call-site changes). 1d UTC-vs-NY truth = SK-11 (closed).
- **XAUUSD Jul 6-7 2026 outage (REPAIRED):** a DB/web admin-kill during a Jul 6 restart dropped ingestion
  ~39h (`terminating connection due to administrator command` → `ECONNREFUSED` on `/api/mt5/*`). Repaired by
  re-exporting XAUUSD M1 from the MT5 terminal (1xTrade) + idempotent re-import
  (`node scripts/backfill-candles-from-mt5-csv.js <dir> --tz-offset-minutes=180 --broker=MT5`, UPSERT), then
  `refresh-candle-caggs.js` + `backfill-historical-features.js XAUUSD … --start/--end`. Note: the importer reads
  `process.env` (no dotenv) — run with `.env.local` loaded. Open reliability follow-up: ingest must survive a
  DB/web restart (EA spool/retry + restart ordering) so this can't recur.

- **Canonical daily (SK-11 CLOSED, by design, non-destructive):** there are two daily tables on purpose.
  `candles_1d_utc` (UTC midnight) is the CANONICAL daily for every feature / the engine / coverage
  (`CANDLE_TABLE_BY_TF[1d]`, `candleSource` 1d). `candles_1d_ny` (NY close, bucketed 21:00 UTC) is a
  maintained auxiliary continuous aggregate read by the web export API (`apps/web/.../candles/export/route.ts`
  `1d_ny`) — it is NOT orphaned, so do not drop it. The 21:00 UTC hour is the NY day boundary. Both caggs
  have active daily refresh policies. Contract comments added in `timeBucket.ts` + `candleSource.ts`.
- **`trustStoredLifecycle` asymmetry is intentional (SK-55 CLOSED, by design):** live paths
  (`pipelineTrigger.ts:100`, `dry-run-live.ts`, `debug-gate.js`) compile with `trustStoredLifecycle: true`
  (trust current `is_fresh`/`invalidated_at` for fast live decisions); the backtester
  (`backtest-pit-v2.js:903`) compiles with `false` (recompute lifecycle PIT-correctly, because stored
  `is_fresh` is wall-clock and would leak future state — SK-20). Do NOT "align" them: making the
  backtest trust stored breaks PIT; making live recompute breaks the current-state read.
- **Backfilling DERIVED features (SK-66):** do NOT use `recompute-feature-recent.js`.
  Repair upstream deps with `backfill-historical-features.js <SYM> <tf>
  --features=<leaf-closure> --start/--end` (lookbackBars:500, full context), then
  backfill the derived feature read-only. For `features_direction_state` (derived from
  `features_bias`+`features_htf_bias`), use `node scripts/reconcile-direction-state.js
  [symbol] [tf]`, which joins existing bias+htf_bias rows with the engine's
  `reconcileDirection` and writes only `features_direction_state` (verifies inputs
  untouched). The only override to `recompute-feature-recent.js` for a derived feature is
  `--recompute-deps` together with an HTF-safe lookback (`--lookback >= 500` or
  `--htf-safe`) — DANGEROUS, recomputes upstream rows.
- **SK-61 RESOLVED (2026-07-10):** the engine iFVG producer previously emitted rows
  with `ts = last candle` (anchor), so already-invalidated FVGs had
  `invalidated_at < ts` and were rejected by the `ifvg_inv_after_ts` CHECK (101),
  freezing `features_ifvg`. The registry contract is `createdAt = "ts"`, so
  `apps/engine/src/features/ifvg.ts` (v1.4.1) now sets `ts = originating_zone_ts`
  (formation), matching `features_zone`/`features_order_block` and the lifecycle/
  CHECK semantics. `liveRunner` no longer groups iFVGs by snapshot ts. Result:
  `features_ifvg` advances again, 0 scars, lifecycle cursor <2h.
- **Direction Arbiter (`features_direction_state`):** single reconciled,
  regime-classified direction per (symbol, tf, ts) from `features_bias` +
  `features_htf_bias` (SK-27..33). Specs/gates can predicate on `direction`,
  `regime`, `agreement`, `htf_state` uniformly. The compiler anchor projects
  `regime`/`state` and maps bare `regime`/`state`/`agreement`/`score` (fixes the
  bare-`state` SK-30 bug). Register new features in `apps/engine/src/index.ts`
  + `featureWorker.ts`, add a `featureRegistry.ts` contract, and a migration.
  **Completeness (2026-07-10):** XAUUSD `1h` (= the only live consumer, `watukushay_no1`
  `regimeRelax`) and XAUUSD `15m` are reconciled to 100% within the trailing-90d window and
  fresh at the data edge (`reconcile-direction-state.js`, read-only w.r.t. bias/htf_bias,
  `readOnlyOK` verified). No active strategy currently keys on `15m`/`4h`/`5m`/`1d` or any forex
  pair, so those are intentionally empty — backfill on demand with
  `scripts/reconcile-direction-state.js <SYM> <tf>` (window = trailing 90d of the 1m clock).
- **Feature-table rule (SK-63):** the runner sets every un-emitted, non-special
  column to `NULL` on persist, so feature tables must contain only columns the
  feature emits (or nullable columns) — a `NOT NULL created_at … DEFAULT now()`
  will violate NOT NULL because the default is never applied.

## Ingest resilience (MT5 bars must survive outages)

Bar ingestion is layered so a DB/web/nginx outage of any length loses no bars
(see `docs/ingest-resilience.md` for the full runbook):

- **nginx** (`conf/nginx.conf`): `= /api/ingest/mt5/bars`, `= /api/ingest` and
  `= /api/ingest/heartbeat` are exact-matched to the standalone ingestion
  server on **port 3004** in EVERY server block, so a web restart never drops
  bars. Keep these exact matches when adding vhosts.
- **Ingestion server** (`scripts/ingestion-server.js`, PM2 `tz-ingestion`):
  on a transient DB error it spools the batch to `logs/ingest-spool/*.jsonl`
  and returns `200 {spooled:true}` (the EA advances; a drain loop replays FIFO
  once the DB is back). Validation errors are 400 and never spooled.
  `GET :3004/health` reports `{db, spoolFiles, spoolBytes}`.
- **EA** (`mt5-ea/tradzfxManager_v5_0_1.mq5`): on send failure it appends the
  batch to `Common\Files\tradzfx\spool\<SYMBOL>.jsonl` (survives terminal
  restarts) and replays FIFO on reconnect. Inputs: `InpSpoolEnabled`,
  `InpSpoolMaxMB`. Replays are idempotent (`PRIMARY KEY (symbol, broker, ts)`).
  All periodic scheduling (OnTimer gates, per-symbol sync gate, server
  watchdog) runs on `TimeLocal()` — never `TimeCurrent()`, which freezes at the
  last quote when the market is closed and previously silenced the EA all
  weekend. `TimeCurrent()` is only for market-time math (bar windows, order
  expiry, server offset).
- **MT4 manager** (`mt5-ea/tradzfxManager_MT4_v5_0_1.mq4`): same spool +
  wall-clock scheduling ported 2026-07-11 (compiled 0/0, deployed to terminal
  50CA3DFB... with `.ex4.pre-spool.bak` rollback). The deployed instance runs
  `InpMode=verify` (heartbeats/config/status only); the spool and candle sync
  activate only if it is promoted to `InpMode=primary`. Its clock fix is live
  — heartbeats resumed the same day after silence since Fri 16:58.
- **Restart ordering is mandatory** (learned from the Jul 6-7 ~39h outage):
  `ops/restart-web-v2.ps1` / `deploy.ps1` gate on (1) PostgreSQL reachable,
  (2) `tz-ingestion` online + DB-connected, then build, restart web, and poll
  `/api/health` for `database.connected` (NOT `status==ok`, which is
  `degraded` on weekends by design). Repo scripts must **never** restart or
  terminate Postgres (native Windows service, managed out-of-repo).
- `ops/monitor-v2-health.ps1` self-heals: if PG is up but an app pool is
  wedged (`database.connected=false`), it recycles `tz-ingestion` +
  `tz-web-v2` once per 10-minute cooldown.
- After a long outage + spool drain, refresh the caggs and recompute
  historical features for the affected window (same procedure as the
  Jul 6-7 repair in `docs/ingest-resilience.md`).

## What not to commit

- `node_modules/`, `.next/`, `dist/`, `*.tsbuildinfo`
- `logs/`, `backups/`, `downloads/`, `reports/`, `data/`
- `.env` files
- `graphify-out/` (curated snapshots go to `docs/graphify/`)
