# Deep System Audit — tradzfx-v2 — 2026-07-21

**Scope:** full-stack review after the migration to progressive state architecture (`steps[]`): DB state, architecture, live runtime, backtest engine, feature pipeline, strategy specs. Per your instruction, slippage/spread/commission *modeling* in backtests is out of scope — findings about those appear only where the code is buggy in a way that corrupts correctness, not because costs are unmodeled.

**Method:** five parallel read-only code audits (progressive SQL compiler, backtest engine, feature engine + lifecycle, specs/validation/seeding, live runtime + trade pipeline) plus first-hand read-only DB forensics (7 probe suites against `tradzfx_v2`, all `SELECT`-only in read-only transactions) and PM2/log inspection.

---

## 0. URGENT — the system is DOWN right now (found during the audit)

Everything below the web/EA edge has been dead for ~7 hours at audit time (DB `now()` = 2026-07-21 13:19 UTC):

| Component | Last sign of life (UTC) | Evidence |
|---|---|---|
| Candle ingestion (majors) | 2026-07-21 **06:36** | `MAX(candles_1m.ts)` per symbol |
| Candle ingestion (XAUUSD) | 2026-07-21 **03:36** | died 3h before majors — recurring XAU-specific fragility (cf. Jul 6–7 outage) |
| Feature engine | 2026-07-21 **07:31:39** | `MAX(feature_producer_runs.finished_at)` |
| Lifecycle refresh | 2026-07-21 **06:26** (XAU only; forex pairs 2026-07-20 21:0x) | `lifecycle_refresh_state.last_processed_ts` |
| Web app (`tz-web-v2`) | 2026-07-20 **23:32** | last `logs/pm2-web-*.log` write |
| Ingestion server :3004 | dead | `curl :3004/health` = no response |
| DXY feed | 2026-07-17 **14:37** | dead 4 days, unnoticed — no alerting |

Root cause chain (from PM2 logs):
1. PM2 daemon cold-booted **2026-07-20 23:40:07** (machine/service restart) and resurrected **nothing** — `pm2 list` is empty.
2. At **00:11** the empty process list was **saved** (`~/.pm2/dump.pm2` = `[]`, verified). Every future reboot now also resurrects nothing.
3. Whatever was still running outside PM2 died in stages: web 23:32 → XAU candles 03:36 → majors 06:36 → engine 07:31.
4. nginx and PostgreSQL (Windows services) are still up — so **MT5 EAs are getting 502s from nginx and spooling bars locally** (`Common\Files\tradzfx\spool`). Bars should be recoverable via the EA's idempotent FIFO replay once ingestion is back — but the spool has a size cap (`InpSpoolMaxMB`), so every hour down increases loss risk.

**Immediate actions:**
- Bring the stack back with the mandatory ordering from your own runbook (PG → `tz-ingestion` DB-connected → web → health-poll), i.e. `ops/restart-web-v2.ps1` / `deploy.ps1`, then verify `:3004/health` shows `db:true` and the EA spools drain.
- After spool drain: `node scripts/refresh-candle-caggs.js` + targeted `backfill-historical-features.js` for the gap window (same procedure as the Jul 6–7 repair).
- **Fix the empty dump**: after everything is online, `pm2 save` — and add a watchdog (`ops/monitor-v2-health.ps1` already self-heals wedged pools; extend it to "PM2 has zero apps = page someone").
- Add alerting on `MAX(candles_1m.ts)` age per symbol. DXY was dead 4 days and XAU died 3h before everything else; both were invisible until queried.

---

## 1. Live-trading correctness — first-hand evidence from production data

These are not theoretical. Each is reproduced from `orders`, `setup_evaluations`, `live_signal`, `feature_producer_runs`, and the last minutes of the web error log.

### 1.1 Poisoned-transaction bug drops live orders (CRITICAL)
Last web log (`logs/pm2-web-error-12.log`, 2026-07-20 23:31–23:32), repeated many times:
- `[decisionGraph] Failed to persist trace: current transaction is aborted, commands ignored until end of transaction block`
- `[pipelineTrigger] No order for USDCAD/watukushay_no1: order_creation_failed: current transaction is aborted...`

An earlier statement fails inside a transaction and the code keeps issuing statements in the same poisoned transaction instead of rolling back. Result: order creation and trace persistence fail together — signals that should have traded were silently dropped. **Root cause identified in §3.5.3** (fingerprint unique-index violation aborting the transaction), compounded by the decision-graph trace persisting inside the same doomed transaction (§3.5.9).

### 1.2 Fail-open hot path: "proceeding with potentially stale features" (CRITICAL)
Same log, multiple symbols (NZDUSD, USDCAD, USDJPY):
- `[pipelineTrigger] Feature engine failed for NZDUSD: Cannot read properties of undefined (reading 'map')`
- `... — proceeding with potentially stale features`
- `Strategy variant load failed for NZDUSD/watukushay_fe: Cannot read properties of null (reading 'filter')`

The 15m trigger crashes inside the engine (unhandled `undefined.map`), logs, and **evaluates strategies anyway on stale features**. The progressive architecture's entire point — fresh, step-scoped features — is voided exactly when the engine is unhealthy. This should be fail-closed (skip the symbol) or at least hard-gated downstream.

### 1.3 Stale-signal retry loop: 12 identical doomed orders in 2 hours (HIGH)
`orders` table, XAUUSD 2026-07-03 18:59→20:59: the same `buy market` order at entry `4169.4` was placed **12+ times at ~15-minute intervals**, every one rejected `Entry drift 58.0 pips > max 2.0`. The setup never invalidated, the signal's anchored entry never refreshed, and the system re-fired it every trigger cycle. The drift guard did its job — but a state machine that re-emits a 2-hour-dead entry price every 15 minutes is exactly the "trading on old noise" failure the progressive migration was supposed to kill. Missing: an invalidation/TTL on the *emitted signal* itself (not just on feature steps).

### 1.4 83% of orders have no joinable parent signal (HIGH)
`orders o LEFT JOIN live_signal s ON s.signal_fingerprint = o.signal_fingerprint`: **24 of 29 orders match nothing**. Either fingerprints are computed differently at emission vs. order time, or most orders flow through the `setup_evaluations.order_id` path and the fingerprint join is decorative. Either way the audit/replay trail (signal_replay_*, compiled_strategy_snapshot) cannot attribute most real orders to the signal + spec version that produced them.

### 1.5 There is no live setup state machine at all — and `setup_evaluations` is not one (HIGH — reframed after the code audit)
`setup_evaluations`: 6,260 rows since Jul 8 — 4,658 `waiting` (oldest April 20; 3,030 for XAUUSD alone), 1,593 `blocked`, 9 null — with `outcome`/`outcome_r` NULL on **every** row. The code audit explains the data: **live evaluation is stateless** (§3.5.6) — each trigger runs one compiled SQL over the latest bars; no setup instances are tracked across evaluations, nothing expires, nothing transitions. The table is written by (a) the live order flow as an audit/grade record at order creation, and (b) **the backtest runner's persistent setup-eval cache** (`backtest-pit-v2.js:2133-2192`), which is where most of these rows come from — explaining the volume (6,260 rows vs 29 orders), the zero outcomes, and the immortality (`ON CONFLICT DO NOTHING` + a `context_hash` that excludes the grader version, §3.2.8). The real gaps for you: (1) the "1-step-at-a-time tracked checklist" you migrated for **does not exist in live** — it's a per-bar snapshot filter; (2) the table dual-purposes as cache and audit, so neither consumer can trust it; (3) emitted signals themselves never invalidate — §1.3's 2-hour retry loop is the direct consequence.

### 1.6 Producer-freshness gate is warn-only in production — and things ARE stale (MEDIUM)
Production log: `PRODUCER_STALE (warn-only): features_correlation@15m producer age 2027m > 10m` — a **34-hour-stale** feature traded through, plus `features_pricing@4h 44m`, `features_bias@1h 15m`. `TM_PRODUCER_STALE_ACTION` defaults to `warn` (documented), but combined with §1.2's fail-open trigger, stale features are a normal Tuesday, not an exception. Note the design tension: the progressive architecture made freshness *more* important (each step has a TTL), yet the enforcement layer still only warns.

### 1.7 Engine retry storm + unbounded ledger growth (MEDIUM)
`feature_producer_runs`: **1,621,016 `engine` rows in the last 24h** (peak hour 00:00→01:00 = 411,709 runs ≈ 114/s), **4.5M rows total since Jul 10**, no retention/pruning. When XAUUSD's anchor went stale at 07:30, the invariant error `producer invariant failed: output_anchor_stale` fired **5 times in the same second** — no backoff. Two problems: (a) runaway loop with no throttle when a producer can't advance; (b) the ledger that `assertProducerFresh` depends on grows ~400k rows/day — it will degrade the very freshness queries that protect you, and backups, within months.

### 1.8 Weekend evaluation with no market-calendar gating (LOW/MEDIUM)
`setup_evaluations` per day: Sat Jul 18 = 1,495, Sun Jul 19 = 3,036 evaluations across 8–9 symbols — the market is closed. The EA-side clock freeze bug was fixed with `TimeLocal()` scheduling, but the TS evaluation loop has no equivalent tradable-instant gating (`packages/shared/src/utils/marketCalendar.ts` exists and is used for coverage, not for the live loop). You're minting `waiting` setups off Friday's close.

### 1.9 Order flow stats (FYI)
29 orders ever: 25 rejected (17 entry-drift, 7 spread-guard, 1 retcode 10015 invalid price), 2 filled, 2 expired. `live_signal`: 11 rows total across 7 strategies; **zero signals ever from the 13 keylevel_bounce progressive variants**; `lewis_kelly_smc_ny_shorts` 1 signal (Jul 8). The progressive families are effectively not firing live — see the spec/compiler sections for why (TTL/validation and two-source-of-truth issues). Two geometry observations from the live signals themselves: the Jul 8 lewis_kelly short had **SL 0.2 pips from entry** (1.14212/1.14214) — degenerate geometry that passed validation; and the Jul 20 watukushay EURUSD "market" signal (`ts` 16:00:00) was placed 16:16:04 — a 16-minute-late market order, the mechanical cousin of the drift problem.

---

## 2. Architecture & spec drift — first-hand evidence

### 2.1 The progressive migration covers a minority of live variants (HIGH)
`strategy_families.base_spec` / `strategy_variants.overrides` (all `is_active=true`):
- **Progressive (`steps[]`)**: `keylevel_bounce` family (3 steps, 13 variants incl. v1..v8c) and `lewis_kelly_smc` (4 steps).
- **Still flat (`setup[]`)**: `10xroi` (11 active variants!), all 6 `gold_*`, `a_plus_orb_fvg`, `doyle_sd`, `five_one_scalp`, `forex_strategy_orb`, `orb_classic`, `orb_scalper`, `pb_blake_2026_smc`, `watukushay*`, `waqar_v2*`, `smart_risk_ob_ifvg*`, `scarface_5m_orb`, `xauusd_v1` — **~27 active variants still run the old "fetch everything at once" semantics** you described as the problem.

### 2.2 Two spec stores, and they disagree — the web UI reads the WRONG one (CRITICAL)
There are two stores: the **primary** (`strategy_families.base_spec` + `strategy_variants.overrides`, read by live `strategyVariantLoader` and the backtest `dbLoader`) and the **legacy fallback** `strategy_specs` (`dbLoader.ts:34-36`). The primary store is consistent between live and backtest — good. But the fallback table holds **42 rows, ALL flat `setup[]`, zero with `steps[]`** — including `keylevel_bounce_v5_shorts` at `version 5.0.0` (the migration guide documents it as `v6.0.0` progressive) and `watukushay_no1` at `1.2.0` (guide: `2.0.0`), last meaningfully touched Jul 3.

**Worse than a dead fallback:** the web dashboard and `update-spec` API read and write `strategy_specs` — `apps/web/src/app/api/strategies/detail/route.ts`, `dashboard/strategies/route.ts`, `update-spec/route.ts`. So the UI shows pre-migration flat specs for progressive families, and edits made through the UI land in a store the live path ignores — which then hits the spec-hash cache bug (§3.5.2), so even edits to the *right* store don't take effect without a restart. Nothing reconciles the two stores: a variant lookup that misses `strategy_variants` silently falls back to the pre-migration flat spec.

*Fix: re-seed `strategy_specs` from effective specs on every `db:seed` / `promote-top3-live` (or point those API routes at `strategy_families`/`strategy_variants` instead); add a YAML↔DB drift check to `db:seed:check`.*

### 2.3 Backtest runs are not self-describing (MEDIUM)
`backtest_runs` columns: `symbol, tf, start_ts, end_ts, sample_count, generated_at, variant_id, family_id, strategy_id` — **no spec version, no compiled-SQL hash, no intrabar mode, no setup profile, no engine_ver**. Given §2.2's spec drift, a persisted backtest run cannot be reproduced or even interpreted later: which version of the rules produced these 70 `backtest_results`? (The newer `compiled_strategy_snapshot` machinery — 82 rows, last Jul 20 — is the right fix; it needs to be mandatory on every persisted run.)

### 2.4 TimescaleDB background jobs: high historic failure rates (MEDIUM)
`job_stats`: `arbitrate_broker_sessions_job` **857 failures / 2,004 runs (43%)**, `refresh_canonical_htf_job` 577/1,740 (33%), cagg refresh policies 683/95/189 failures. All currently `last_run_status=Success`, so this looks like past instability — but nobody is watching `total_failures`, and a silently failing cagg refresh = sparse HTF features = backtests and live both degraded (your own preflight gate only checks feature emptiness over the window, not job health).

### 2.5 Schema hygiene (LOW)
- `features_fvg_backup`, `features_zone_clean` — scratch tables without PKs left in `public`.
- `features_push_pull` is a hypertable with 1,632 rows and `compression_enabled=false` on an otherwise-1m-candle compression setup; `compiled_strategy_snapshot` read 0 in pg_stat (stale stats — see next).
- `pg_stat_user_tables` estimates are wildly stale on hot tables (`feature_producer_runs` estimate 12,294 vs actual 4.5M; `features_htf_bias` estimate 0 vs actual 467,689) — autovacuum/analyze is not keeping up with the insert rates, which also means the planner is optimizing feature queries on garbage statistics.

---

## 3. Code-level audit findings

_(Sections 3.1–3.5 are filled in from the five deep-dive audits — progressive compiler, backtest engine, feature pipeline, specs/validation, live runtime.)_

### 3.1 Progressive SQL compiler (`compileProgressiveSQL`)

Audited against the working tree, which is **mid-migration**: `compiler.ts` has +508 uncommitted lines, the progressive YAMLs are uncommitted, and `vitest run src/compiler.test.ts` is **red (1 failed / 38 passed)** — the failing test (`compiler.test.ts:529-534`) expects a root-step `SELECT DISTINCT ON (symbol)` the compiler doesn't emit. Several bugs below are latent today and activate the moment the tree is seeded/deployed. Compile-time claims were verified by the auditor by actually compiling the seeded specs in-process.

#### 3.1.1 Fan-out DAG branch is silently DROPPED — live `lewis_kelly_smc_ny_shorts` trades without its 4h HTF bias filter (CRITICAL)
`compiler.ts:412-414` anchors entry to only the topologically-last step; each step CTE reads only its own parent (`compiler.ts:403`). With fan-out (two children of one parent), the non-last leaf CTE is **never referenced — Postgres never executes it**. Verified by compiling the active spec: steps `mtf_bias → {htf_bias, premium_pricing → supply_retest}` emit `st_htf_bias AS (...)` that nothing references — the 4h `direction='bearish'` requirement is dead code. The migration guide's own canonical fan-out example (`docs/progressive-migration-guide.md:48-55`) hits this bug. Backtest and live agree with each other but **not with the spec**. *Fix: enforce a single linear chain at seed time (error on unreachable step CTEs), or implement real merge/join semantics for fan-out.*

#### 3.1.2 Root-step predicate is silently dropped except literal-equality pushdowns (CRITICAL)
The root branch (`compiler.ts:350-370`) applies only `extractEqualityPushdowns(step.predicate)`; `translatePredicate()` is never called for roots (children get it at :382). Verified: `keylevel_bounce` root `predicate: direction != 'neutral'` compiles to a root CTE with **no predicate at all**; same for `watukushay_no1` and `smc_ict_liquidity_fvg_allpairs_v1`. Current specs survive only by luck (downstream `autoAlignDirection` equality kills neutral rows). Any root filter like `confidence > 0.6` or `regime = 'trending'` would vanish with no error. *Fix: emit the translated root predicate into the root CTE WHERE, as the flat compiler does for its bias anchor (`compiler.ts:571-577`).*

#### 3.1.3 `structureFreshnessMinutes` ignored in progressive mode — entry events up to ~2.6 days old trigger entries (HIGH — this is your "noise from the past" problem, alive in the new architecture)
The flat compiler caps structure events (`compiler.ts:592-600`); `compileProgressiveSQL` has no such block. Entry freshness is only registry lookback **plus session/weekend padding** (`sqlBuilder.ts:164-182`): `lewis_kelly` 1m CHoCH entry window = **3,636 min (~2.5 days)**; `keylevel_bounce` 15m bos/mss window = 3,780 min (63h) — while the same spec declares `live.structureFreshnessMinutes: 120`, silently ignored (flat would cap at 2h). **A Friday BOS can trigger a Monday entry.** *Fix: port the structureFreshnessMinutes block into the progressive path; exempt entry-event features from weekend padding.*

#### 3.1.4 Chain anchor ts never advances — "progressive" currently degrades to flat semantics + per-step lookbacks (HIGH, design-semantics)
Every child CTE projects the parent's ts unchanged and stores the match ts in a dead column (`${id}_ts`, never referenced). So `ttlMinutes` measures from the **root** row, not from the parent match — and the matched child's own ts plays no causal role. Consequence: entry events can be *older* than the setup matches (entry window 63h vs zone TTL 4h passes), i.e. inverted causality. Combined with the stateless runtime (§3.5.6), the checklist is a snapshot filter, not a progression. If causal chaining is intended, each CTE should project its match ts as the new anchor. (The doc is ambiguous — decide and encode one semantics.)

#### 3.1.5 Backtester crashes on any progressive spec (HIGH)
`scripts/backtest-pit-v2.js:747`: `spec.setup.filter((c) => c.required)` — unguarded; DB-loaded progressive specs have no `setup` key (`dbLoader.ts:44-46` doesn't normalize). `backtest-pit-v2.js EURUSD 30 keylevel_bounce_v1` throws before compiling. **You currently cannot PIT-backtest the progressive specs with the main runner.** *Fix: `(spec.setup ?? [])`.*

#### 3.1.6 Compile-time/runtime bombs that fire on first use (HIGH, latent)
- Progressive + `signalSource: fvg` or `orb` → throws `spec.setup is not iterable` (`compiler.ts:1001, 1183`; verified against seeded `smc_ict_liquidity_fvg_allpairs_v1`).
- Progressive + `filters.timeWindows` → **syntactically invalid SQL** (filter interpolated into the SELECT list, `compiler.ts:364`). Related: `EXTRACT(HOUR FROM ts)`/`ts::time` without `AT TIME ZONE 'UTC'` — correct only while the DB session TZ is UTC.
- Progressive + `signalSource: generic` → runtime "column does not exist" (`signal_direction` projected only by the flat path).
- Multi-parent `dependsOn: [a,b]` silently uses only `a` (`compiler.ts:374`); two roots → second root's CTE dead; validator doesn't enforce exactly-one-root (`validate.ts:297-300`).
- `session_scoped` join policy not honored in progressive steps — validated (`session:` required) but unused; a `features_opening_range` step would match stale ranges from prior days.
- `autoAlignDirection` hazards: no check that the step's feature has a `direction` column → runtime SQL error if forgotten (doc's Rule-3 table omits `features_order_block`); a `features_direction_state` parent stores `'buy'/'sell'` vs children `'bullish'/'bearish'` → alignment never matches, **silently zero rows** (flat compiler normalizes, progressive doesn't); NULL parent direction silently discards rows.
- Hybrid-spec trap: `watukushay_no1` inherits flat `setup[]` (incl. an **rsi** condition) from base and overrides `steps[]`; auto-detect takes progressive, so the rsi condition silently vanishes from SQL while `validateSpec` still validates the flat array — false comfort.

#### 3.1.7 Equality pushdown lowercases string literals (MEDIUM — silent starvation landmine)
`sqlBuilder.ts:52`/`compiler.ts:122`: `reference_symbol = 'DXY'` compiles to `'dxy'`; producers store uppercase `'DXY'` (same hazard for `session = 'NY'`). Currently latent (the DXY condition is `required:false`; session conditions use `IN (...)` which the regex misses) — one spec edit away from a silently dead strategy. *Fix: don't lowercase quoted literals.*

#### 3.1.8 Lower-severity compiler gaps
- `rankLimit`/`rankOrderBy` validated but **never compiled** — in-group pick is arbitrary (harmless today because only parent columns are projected; non-determinism waiting for the first consumer of matched-row payload).
- Root CTE has no dedup — rooting at a non-unique feature (e.g. `features_moving_average`, multiple periods per ts) would multiply the whole chain into duplicate signals. The red unit test shows dedup was intended.
- `effectiveLookback` regex can't parse `"N days"` intervals → `min(ttl, lookback)` degrades to `ttl`, admitting staler rows than the registry bound.
- `ProgressiveStep.required` ignored — all steps compile as required; optional steps are impossible.
- `opts.debug` ignored by `compileProgressiveSQL` → backtest `--debug` on progressive specs returns signal SQL instead of stage counts.
- Unescaped interpolation of `opts.symbol`/`spec.id` (trusted today; keep everything else parameterized like `signalTtlMinutes`).
- Live root scan has no symbol filter inside the CTE — wasteful per evaluation.
- `trustStoredLifecycle`: dead option, confirmed independently (see §3.5.7).

#### Verified solid (compiler)
- **No look-ahead within the chain**: child LATERALs are two-sided — `feature.ts <= parent.ts` AND `ts >= parent.ts - effectiveLookback`; root bounded `[from,to]` in PIT mode.
- TTL default when omitted = registry lookback + session padding (not unlimited).
- Direction inheritance survives no-direction intermediate steps (pricing/MA with `autoAlignDirection:false` still carry direction downstream — verified in compiled SQL).
- No cartesian signal multiplication (each child CTE `DISTINCT ON (parent.symbol, parent.ts)`; entry dedups per `(symbol, ts)`).
- Entry cannot be in the future of setup (`ts <= lastStep.ts` via registry policy).
- PIT `is_fresh` stripping works in progressive mode (test-covered); RC-1 level-freshness and RC-2 pricing filters preserved; `buildOrbSessionScopedJoin` correct (and used by the flat path); topological sort + cycle/dangling validation correct.

### 3.2 Backtest engine (PIT correctness)

Audited: `packages/analyzerBacktest/**`, `scripts/backtest-pit-v2.js`, `run-pit-historical.js`, `run-pit-walkforward.js`. Findings 1 and 2 re-verified first-hand against the code during write-up.

#### 3.2.1 Market fills happen INSIDE the signal bar — one full signal-TF bar of entry look-ahead (CRITICAL)
`backtest-pit-v2.js:878,887`: the simulator fills at the first 1m candle with `ts > signal.ts` and books `Number(first.o)`. But feature/signal rows are keyed by **bucket START** of the completed bar (`dag/runner.ts:879`, `candleSource.ts:112`; live confirms: the row `ts=10:00` exists at ~10:15, `pipelineTrigger.ts:388-390`). So a 15m signal fills at **10:01 open — 14 minutes before the signal exists** (59 min on 1h, 3h59 on 4h), and SL/TP are evaluated over bars 10:01–10:14 that *formed* the signal. The code comment shows the intent was correct ("signal is known only after its timestamped bar closes"); the implementation treats `ts` as bar-close when it is bar-open. 1m strategies are unaffected; **every 5m+ TF variant's entries, and a slice of its exits, are not live-reproducible** — direction of bias varies per trade, so it doesn't wash out. *Fix: fill at the first 1m candle with `ts >= signal.ts + TF_MS[signalTf]` (thread the signal tf into `simulateTrade`).*

#### 3.2.2 Limit/stop entries crash the whole run (HIGH — verified)
`backtest-pit-v2.js:963` references `slippagePrice`/`commissionPrice` — **the only occurrence in the file**; undeclared → `ReferenceError` on the first limit/stop fill, exit 1. Any spec with `entryConfig.type: limit|stop` (`a_plus_orb_fvg_5m`, `keylevel_bounce_v1_limit`) dies mid-run. Related: the test block `backtest-pit-v2.test.js:294-353` still asserts the old cost contract — stale/red. *Fix: delete the cost terms (cost model was intentionally stripped) and update the stale tests.*

#### 3.2.3 analyzerBacktest intrabar modes are direction-asymmetric — default flatters SHORTS (HIGH — verified)
`packages/analyzerBacktest/src/outcomeTracker.ts:60-61`: `"pessimistic"` resolves a both-hit bar as `tp` for **shorts**; `"optimistic"` as `sl` for shorts. Default mode is `"pessimistic"` (:99) and the PM2 nightly calibration passes no override → tight-bracket short scalps that hit both levels in one bar book **wins**. Tests only cover the long side. This feeds walk-forward + nightly calibration reports. *Fix: `optimistic → "tp"`, `pessimistic → "sl"` unconditionally.* (The seeded PIT reports use the *other* simulator — `backtest-pit-v2.js` — which is `sl_first` and conservative; verified.)

#### 3.2.4 No gap modeling on exits; gap-past-bracket entries are deleted from the stats (HIGH)
Exits always book at exactly SL or TP (`:910`, `:1017`, `:1062`) — a Monday gap through the stop still books −1R. Worse: if the fill bar's **open** is already outside the bracket, the trade is returned `outcome:"invalid"` (`:888-890`) and excluded from win/loss/netR — the worst tail losses (news, weekend gaps) are systematically excised. Largest on XAUUSD. *Fix: exit at `min/max(open, sl)` on gap-through; treat bracket-violating fills as immediate losses at the open.*

#### 3.2.5 Timeout trades score 0R and vanish from all metrics (HIGH)
`{outcome:"timeout", r:0}` (`:914, 1100-1111`); stats run over decisive trades only. A signal that goes nowhere costs nothing — but live it floats to SL/TP or closes at market with real PnL. Material for `timeoutBars: 8–16` specs (watukushay, orb_scalper_1m, scarface, orb_classic — these are 1m bars = 8–16 *minutes*). Seeded doyle_sd reports show 3–5 timeouts/symbol dropped. *Fix: close at last bar's close on timeout and include the R.*

#### 3.2.6 Persistence: re-runs double-count; the variant API ignores run boundaries and `heat_dropped`; audit fields are fabricated (HIGH)
`persistTrades` uses `ON CONFLICT DO NOTHING` but `backtest_results.id` is BIGSERIAL with no natural key → **every `--persist` re-run inserts a full duplicate set**; the variant report API selects across all runs with no `run_id` filter and doesn't filter `heat_dropped` → headline metrics double-count and include heat-dropped trades. Persisted rows also hardcode `grade:"A"`, `confidence:0`, NULL `htf_state`/`session_name` (→ `byGrade`/`bySession` reports meaningless), and `exit_ts` is synthetic `ts + bars_held*60s` (lands inside weekends; consumed by the DB heat post-pass). *Fix: unique key `(run_id, symbol, ts, direction)` or delete-by-run before insert; pin latest run + `heat_dropped=false` in the API; persist the real exit ts.*

#### 3.2.7 Runs are not self-describing (MEDIUM-HIGH — confirms §2.3)
`backtest_runs` stores no mode/profile/intrabar/spec-version/engine_ver; the `tf` column is actually the bias tf. Seeded artifacts in `data/backtest-seed/` predate the mode fields → the geometry checks in force for them are unknowable from the artifact. *Fix: `config_jsonb` on every persisted run.*

#### 3.2.8 Persistent setup-eval cache makes results depend on prior DB state; fail-open degrades full→fast silently (MEDIUM-HIGH)
`backtest-pit-v2.js:2133-2192`: setup evaluations are cached in `setup_evaluations` keyed by `context_hash` — which **doesn't include the setup-engine/grader code version**. A grader bug fix doesn't invalidate cached grades; `ON CONFLICT DO NOTHING` makes a poisoned row immortal (this is also what populates most of the 6,260 `setup_evaluations` rows — see §1.5). And `:2252-2257`: if `evaluateSetupBatch` throws, the catch is debug-log-only and signals proceed **ungraded** — `--mode=full` silently becomes `--mode=fast` while reporting `setupProfile:"strict"`. *Fix: engine version in the hash; batch failure fatal or loudly marked.*

#### 3.2.9 Volatility gate reads TODAY's ATR distribution for historical trades (MEDIUM — look-ahead in full mode)
`getVolProfile` (`:1402-1407`) picks the latest `market_volatility_profile` row with no as-of bound → historical trades gated on percentile ceilings from the current regime. (The direction-state relax path is properly as-of.) *Fix: as-of column + `computed_ts <= signalTs`.*

#### 3.2.10 Other backtest findings (MEDIUM/LOW)
- **Preflight has no contiguity check**: raw `COUNT(*)` ≥ 50% density floor — a 3-day mid-window hole still passes READY and silently emits fewer signals. Empty required event features (sweep/structure) are DEGRADED-only → "no signals" reads as strategy-flat, not data-missing.
- **Lifecycle PIT depends on historical scan coverage the gate can't verify**: if parts of the window were never lifecycle-scanned (e.g. backfilled with `ZONE_BACKFILL_SKIP_OUTCOMES=1` and never rescanned), dead zones look valid → more signals than live, no warning.
- **R normalized by planned risk while fills deviate**: reported R ≠ realized currency risk when the fill gaps from the authored price. Report `r_realized` too.
- **Warmup**: floor is 50 bars ("reduced from 200") contradicting the documented 200; `computeWarmupTs` is wall-clock — a window starting before a weekend burns ~2 days of warmup on zero bars.
- **Session-TZ-dependent SQL casts**: `EXTRACT(HOUR FROM ts)`, `ts::time`, `EXTRACT(DOW FROM ts)` use the session TimeZone, not UTC — fine only while the pool runs UTC (unverified).
- Reporting nits: `noFills: NaN` in summary.csv; walk-forward "Total Net R" double-counts overlapping windows; `maxDrawdownPct` stuck at 0 when peak equity ≤ 0; "Sharpe" is actually a t-stat (√n scaling); `profitFactor: Infinity` → `null` in JSON; Monte Carlo uses unseeded `Math.random()` → variant API returns different numbers per call.
- analyzerBacktest fills at the entry-zone **midpoint** with no check price ever traded there (feeds nightly calibration only, but treat those absolute numbers with care).

#### Verified solid (backtest)
- Compiled PIT signal SQL is clean: every LATERAL bounds `feature.ts <= anchor.ts` (+ lookback floor); lifecycle via as-of `invalidated_at/mitigated_at > anchor` windows (the RC-1 fix is in place); ORB session rows pinned date+session+completion; `is_fresh` stripped in PIT; no `NOW()` in PIT mode.
- Seeded reports use conservative `sl_first` intrabar + strict setup profile (verified: no spec overrides `intrabarAssumption`).
- Suspect-candle quarantine real and counted; preflight hard-block path works as documented; deterministic seeded RNG for random_walk/momentum; non-decisive outcomes refused at persist; geometry validation fail-closed; uniform UTC in JS paths.
- mode=full runs the *same* `evaluateSetupBatch` live uses, PIT-bounded via `asOf` — setup parity is structural.

### 3.3 Feature engine + zone lifecycle

#### 3.3.1 Pivot confirmation lag leaks the future into every structure/zone/iFVG/OB row the backtest reads (CRITICAL — re-verified first-hand)
`features_pivot` requires `lookback` bars **after** the pivot to confirm it (`apps/engine/src/features/pivot.ts:52-58`: `i < candles.length - lookback`, checks `candles[i + j]`) but persists the row with **`ts` = the pivot bar** (`pivot.ts:118-125` — verified). Consumers join with plain `ts <= anchor` (`sqlBuilder.ts:278-286`; registry declares `createdAt: "ts"`). The leak propagates into every pivot-derived stored row:
- **structure**: a BOS/CHoCH `ts` is the break candle, but detection needs a *later confirmed pivot* — lead ≥ lookback bars: 8 bars on 15m (2h), 10 on 1h (10h), **20 bars on 1d (~20 trading days early)**.
- **zone (supply/demand)**: requires a "nearby pivot" with `|p.ts − ts| ≤ 10 bars` — future pivots accepted — plus that pivot's own lag. (FVG zones are clean: 3-bar pattern, `ts=c3.ts`.)
- **order_block**: `ts` = OB candle, knowable only after the structure event that itself needs confirmation.
- **ifvg**: `ts` = formation bar, but emitted only after fill ≥50% **and** a confirmation close — typically tens of bars later.

141 spec conditions read these tables directly. The PIT backtester reads them via compiled SQL, so **backtests see events/levels hours-to-days before they were knowable — systematically inflated results for every structure/zone/iFVG/OB strategy**. Live is unaffected (rows only exist after detection). This is the deepest hole in the system: it flatters exactly the metrics you use to promote variants. *Fix: persist `detected_ts` (confirmation bar) alongside formation `ts`; compiler joins on `detected_ts <= anchor` while displaying formation ts. Cheaper interim: `ts <= anchor - lookback*bar` lag for pivot/structure in `buildPitLateral`.*

#### 3.3.2 Wall-clock attributes on formation-ts rows are not anchor-guarded (CRITICAL, second-order PIT leak)
The compiler's freshness predicate guards only `mitigated_at`/`invalidated_at`. Everything else on the row is read as-of-last-compute: `quality_score`, `rank_score`, `age_bars`, `departure_candles` (computed against the **end of the candle buffer**, `zone.ts:158,165,232`), and `tapped`/`fill_pct`/`touch_count` (last writer wins). Active specs predicate on these (`keylevel_bounce_v3`: `tapped = true AND fill_pct < 0.95 AND quality_score > 0.05`; also fib_golden_swapzone, doyle_sd, forex_strategy_orb). In backtests, a zone tapped/filled **after** the anchor reads as tapped/filled/high-quality **at** the anchor → ghost retest entries and phantom quality filters. `structure.confirmed`/`confirmation_ts` similarly use up to 5 future bars. *Fix: in PIT mode derive tapped/fill/quality from candles as-of anchor, or exclude these columns from PIT-compiled predicates.*

#### 3.3.3 Zone lifecycle cursor never re-scans open zones — late invalidations are missed (HIGH)
`117_zone_lifecycle_open_only.sql:88`: candidates require `z.ts > v_from_ts` (formation newer than the checkpoint), and the cursor advances every call. Once the cursor passes a zone's formation ts, **that zone is never re-examined** — a breach after its first scan never sets `invalidated_at`; `is_fresh` stays true forever. Migration 146 fixed exactly this for order blocks and says so in its header; zone/sweep/structure functions still have the defect. Today's mitigations (engine re-upserts in-window zones every 15m; cron rescans 2d) cap exposure for short-lookback specs, but anything between the engine window and the weekly 30d rescan is stale, and `assertProducerFresh` reports the cursor as fresh while old open zones rot — monitoring is blind to it. *Fix: mirror 146 — rescan the full open set (`invalidated_at IS NULL`) each call with `IS DISTINCT FROM`; use the checkpoint only to bound new-zone inserts.*

#### 3.3.4 Two writers, two conflicting `mitigated_at`/`fill_pct` semantics on the same rows (HIGH)
Engine (TS): `mitigated_at` = first ≥50% penetration; `fill_pct` = max penetration over the buffer. SQL 117: `mitigated_at` = **first wick touch**; `fill_pct` computed only first-touch → LEAST(as_of, ts+5d). Both write the same rows. Consequences: zone eligibility (`mitigated_at <= anchor` exclusion) **flip-flops between runs** depending on last writer; `fill_pct` can *decrease* (monotonicity broken); live vs backtest read different definitions depending on write order. *Fix: one canonical semantics (146's contract) implemented identically in `computeZoneLifecycle` and `refresh_zone_lifecycle`; one owner per column.*

#### 3.3.5 `trustStoredLifecycle` is a dead option — confirmed by three independent audits (MEDIUM)
Declared, passed by every caller, documented in AGENTS.md SK-55 with "do NOT align them" — **and never read anywhere in `packages/strategies/src`**. Live and PIT compile identical freshness semantics; the real divergence is `mode` (is_fresh stripping). Behavior is currently right *incidentally*; the documented mechanism doesn't exist. Fix the flag or the docs before someone reasons from the docs (e.g. assuming `fill_pct` is PIT-recomputed — it isn't, §3.3.2).

#### 3.3.6 Lifecycle SQL scans raw `candles_1m` (all brokers) while engine/146 read `market.candles_1m_canonical` (MEDIUM)
`117:109,126,134` (also 045/052/031) scan `candles_1m` with no broker filter. Post-096 that table is broker-namespaced, and legacy `'default'` rows already duplicate MT5 rows — lifecycle can touch/invalidate on a different broker's prices than the strategy traded. Latent while only MT5 writes; a landmine the day MT4 goes primary. *Fix: switch all lifecycle LATERALs to the canonical view.*

#### 3.3.7 Duplicate migration numbers — the no-op lifecycle functions win (MEDIUM)
`096×2`, `097×2`, `108×2`. Alphabetical versioning means `108_missing_feature_lifecycle.sql` sorts **after** `108_add_missing_feature_lifecycle.sql` and redefines `refresh_atr_lifecycle`/`refresh_spread_lifecycle`/etc. as `RETURN 0` no-ops. The cron calls them every iteration, ledgers `done, rows_updated=0`, and treats them as healthy. *Fix: renumber duplicates, make the runner fail on duplicate numeric prefixes, restore the real bodies.*

#### 3.3.8 Sunday tradable session is dropped from feature computation (MEDIUM)
`filterWeekdayCandles` removes **all** Sunday bars, but the project's own calendar treats Sun 21:00–24:00 UTC as tradable (FX week open). Effects: Asia-open bars never enter ATR/zones/bias; Monday 00:00's ATR true-range bridges Friday→Monday across the dropped session (inflated TR); Sunday-evening zones/FVGs invisible; live trading Sunday evening runs on stale features. Internally inconsistent with coverage math that counts those bars as expected. *Fix: replace the day-of-week filter with `isTradableInstant(ts, symbol)`.*

#### 3.3.9 Gap-spanning lookbacks produce unflagged feature values (MEDIUM)
With a 39h hole (Jul 6–7 class), `getRecentCandles` detects the gap and falls back to a rollup that **omits the missing buckets** (`candleSource.ts:448-457`) — ATR/EMA/bias then compute over a window that silently bridges the hole; `is_valid` stays true; gates and ATR-stops consume regime-mixing garbage. *Fix: carry `gapMinutes` through; flag dense features computed across gaps > N×bar.*

#### 3.3.10 Other findings (LOW/MEDIUM)
- **Trigger outages leave permanent dense-feature holes**: missed 15m buckets are never recomputed after web downtime (only the current edge is computed) — needs bounded catch-up anchors; also the scheduler only touches symbols with active variants.
- **`features_opening_range` onEvent gate compares incompatible timebases** (row ts = completion time vs candle ts) — a run landing inside the range window can persist a ~1-minute partial range that ORB entries then trade for ~30 min.
- **25s lifecycle race is safe but unobserved**: no data loss (single atomic statement), but a wedged lifecycle stacks overlapping runs every 15m with no guard, and timeouts are a `console.warn` only.
- Runner early-return skips `flush()` — staged rows linger into the next run's anchors.
- `features_direction_state.confidence` is degenerate (0–100 clamped to ≤1 → always ~1.0) — dead column, units bug.
- `assertProducerFresh` fail-open on DB error + wall-clock age reads stale on weekends — a trap if `TM_PRODUCER_STALE_ACTION=block` is flipped (false-blocks Monday open).
- Sparse producers can silently die (done + 0 rows is "healthy" for sparse features) — add a weekly sparse-emission canary.
- Concurrent engine instances can deadlock on overlapping `INSERT … ON CONFLICT` batches (error lands correctly in the ledger; feature skips a cycle).
- MSS strength grading fabricates a breakCandle on lookup miss → NaN → always "weak" (cosmetic unless specs predicate on strength).

#### Verified solid (feature engine)
- Ledger truthfulness (`computePersistOutcome` done/error with real rowCounts; dense postflight invariant; `assertProducerFresh` blocks on latest non-done).
- Cache key includes `engine_ver` + content + deps + reference-symbol candles.
- Lifecycle functions are single atomic statements; no resurrection of invalidated rows; invalidation stamped on the breaching bar itself; boundary operators match TS↔SQL exactly.
- Dense producers (ATR/bias/htf_bias/direction_state) are PIT-pure at compute time.
- Trigger scheduling is wall-clock/DB-based — no `TimeCurrent` freeze class.
- Migration runner's destructive guard + per-file transaction behave as documented.

### 3.4 Specs, validation, seeding

Inventory (61 YAMLs, compile-swept through real `compileStrategy`, live+pit): **progressive** = keylevel_bounce family (base + 13 variants) and lewis_kelly_smc_ny_shorts; **flat** = everything else (doyle_sd and orb_classic — the two other LIVE variants — are flat and compile clean). 59/61 compile; the two failures below.

#### 3.4.1 Active variants that cannot run at all (CRITICAL ×3)
- **`keylevel_bounce_v4` (active) cannot compile**: its `htf_bias` step has **no `predicate`** (`keylevel_bounce_v4.yaml:17-21`); `compiler.ts:382` calls `translatePredicate(undefined)` → throw, live AND pit. `validateProgressiveSpec` never checks predicate presence, so it seeded clean. Any evaluation of this variant crashes its pipeline slot.
- **Stub variants seed `null` overrides that delete inherited steps/entry/risk at runtime**: `seed-strategy-specs.js:93-96` emits `key:null` for base keys absent in a variant; `strategyVariantLoader.ts:25-29` assigns null verbatim (null = delete), while seed-side validation treats null as keep. Verified by verbatim simulation: **`keylevel_bounce_v1` (active)** hydrates to `{filters:null, steps:null, entry:null, risk:null, …}` → no steps → flat path → `spec.setup.filter` throw; **`watukushay_fe` (active)** identical via `{setup:null}`. The migration guide's inheritance promise is **false** for stub variants. This is also a second, independent cause of the production log's `Strategy variant load failed … null.filter` errors (§1.2).

**Fix refinement (post-publication):** The report initially said "loader: skip nulls" — but 26 YAML files deliberately use `zonePips: null` / `entryZonePips: null` (leaf-level nulls are meaningful — `"auto"`). Blunt null-skipping in the loader would break those specs' inheritance semantics. The correct fix is narrower: stop the **seeder** from *emitting* `steps: null` / `setup: null` for keys a variant simply does not override (`seed-strategy-specs.js:93-96`), while keeping explicit YAML `null` values meaningful. Same root cause, different patch surface.
- **Multi-variant families with no canonical base file collapse all variants to the alphabetically-first YAML** (`seed-strategy-specs.js:126,161-172,289-292`): `smc_ict_liquidity_reversal` (ifvg/ob hydrate to the **fvg** spec), `fib_golden` (avwap/swapzone → 50ema), and **`five_one_scalp` — v1 is active and the live runner evaluates the `staged_v1` spec under v1's name**. Wrong strategy traded under the right name.

#### 3.4.2 Root-predicate drop: LIVE `watukushay_no1` can emit `bias_direction='neutral'` signals (CRITICAL — same root cause as §3.1.2, seen from the spec side)
watukushay_no1's chain is `bias → ma_fast → ma_slow` with MA steps `autoAlignDirection:false` and empty `entry[]` — nothing downstream kills neutral rows. With the root `direction != 'neutral'` dropped by the compiler, **neutral-bias bars anchor the whole chain** → signals with `bias_direction='neutral'` → `side=NULL` (`compiler.ts:1330-1334`; `bias_direction IS NOT NULL` passes 'neutral'). Phantom signals consume rate-limit slots and contaminate backtests; execution drops null-side orders downstream (exact drop point unconfirmed; the 2 live watukushay signals checked in §1.9 have real sides). Related spec smell: the MA steps' `predicate: ma_type='sma' AND period=15 AND value > 0` is a tautology — an SMA of prices is always > 0 — so the chain filters nothing beyond bias; if fast/slow alignment was intended, it isn't expressed (cross detection lives only in the signal select).

#### 3.4.3 The pre-seed gates are blind to progressive specs (HIGH)
- **Temporal-alignment gate** (`check-temporal-alignment.js`): `extractConditions` reads only `setup`/`entry` — **`steps[]` are never checked** (for watukushay_no1 it checks the stale base flat setup); a condition with **zero rows in 90d passes** (`NO_DATA` → exit 0); seed invokes it as `--all-specs --symbol=XAUUSD` so forex-only specs are checked against XAUUSD data; `lookbackBars || 96` ignores registry per-tf defaults (structure@15m runtime default is 16 bars — 6× more lenient). A spec can pass `pnpm db:seed:check` while its features starve — the gate's stated purpose.
- **Capability gate** validates raw YAML, not effective merged specs, and ignores steps — thin variants get zero checks; watukushay_no1's actual surfaces (moving_average@1h, bias@1h) are never gated.
- **No DB↔YAML reconciler**: seed only deletes `%_default` rows; a removed YAML leaves its variant active in the DB indefinitely; any bare `pnpm db:seed` re-activates ~40 variants and **undoes `promote-top3-live`'s deactivations**; `experimental:true` specs seed **active** (paper-mode gated, but generating signals) despite a comment claiming the opposite.

#### 3.4.4 `promote-top3-live.js` has no evidence guard and isn't atomic (HIGH)
Seeds without `--check` (temporal gate skipped, contra your own AGENTS.md workflow); never queries `backtest_results` before promotion (a never-backtested or failed variant can be promoted by editing `LIVE_VARIANTS`); two separate UPDATEs with no transaction (crash between → old+new simultaneously live); no row-count check (typo'd id silently no-ops); forces `live.mode=live` regardless of `experimental`.

#### 3.4.5 Entry conditions got no TTLs in the migration — windows up to ~83h (HIGH — the migration fixed steps but not entries)
Entries are bounded only by registry lookback **+ session/weekend padding** (`sqlBuilder.ts:164-182`): keylevel's `structure_break` (structure@15m) accepts a BOS up to **~63h** old; `zone_retest` up to ~83h; lewis 1m CHoCH similar order. A Friday event satisfies a Monday entry. `entry.dependsOn` is accepted by the validator but **ignored by the compiler** (all entries anchor to the last step). Same root cause as §3.1.3 — flagged from both sides because it's the exact "old noise as trading angle" you wanted gone. *Fix: support `ttlMinutes` on entries; make validate reject unknown entry fields.*

#### 3.4.6 Validation gaps that let broken specs seed clean (MEDIUM)
All confirmed absent from `validate.ts`: step `predicate` presence (→ 3.4.1a); `tf` validity against the TF table (typo → silently matches zero rows); predicate **column names** vs the feature registry (typo → runtime SQL error); `autoAlignDirection` vs the registry's direction-column contract (forgetting `false` on pricing/MA/indicator → runtime SQL error); both-`setup`-and-`steps` ambiguity (compiler prefers steps; the stale setup is what the gates check instead — the watukushay_no1 trap); multi-root specs (guide says "exactly one root"; code requires ≥1 — second root's CTE is dead); variant `timeframes` column ignores steps (keylevel variants persist `[15m]`, missing the 1h bias tf).

#### 3.4.7 Smaller items
- Guide vs compiler drift: the guide says `features_bias.direction` is unresolvable in progressive — the compiler actually maps it to the parent alias and the smc specs rely on it.
- TTL outliers: keylevel_v4 `htf_bias@4h` has **no TTL** → falls back to ~83h window (moot while it can't compile); smc `value_location`/`liquidity_sweep` ttl=120 on 15m/5m (looser than guidance).
- Session-window mismatch: the temporal gate uses session ends 6/11/15/20; validator/sqlBuilder use 7/12/16/21.
- `tpOffsetPips: -2` on v8/v8b/v8c — negative-offset sign convention unverified (TP could land 2 pips *beyond* the pivot); all three share `version: 9.0.0`.
- Naming traps: keylevel entry id `zone_retest` actually queries `features_zone`; `orb_classic` uses `predicate: "1 = 1"` (deliberate).
- `smc_ict_liquidity_fvg_allpairs_v1` throws at compile (§3.1.6) — and per 3.4.1c the whole smc family hydrates into that throwing spec (dormant/experimental today).

#### Verified solid (specs/validation)
- 59/61 effective specs compile live+pit; DAG validation (dangling refs, cycles, TTL positive, rankLimit⇒rankOrderBy, unknown features, session field) runs on merged effective specs at seed.
- `autoAlignDirection:false` correctly set on every pricing/MA step in all progressive specs; no TTL below one bar of its tf; keylevel (30/240) and lewis (480/30/240) TTLs match the guide; lewis chain is causal.
- Every effective spec resolves sane sl/tp/minRR/timeoutBars; no inverted geometry; direction literals and `fill_pct` scale consistent everywhere.
- doyle_sd / orb_classic (2 of 3 live variants) are flat, compile clean, and their cross-references are legal in the flat compiler.

### 3.5 Live runtime + trade pipeline

Full static audit of `packages/setupEngine`, `packages/tradePipeline`, `apps/web` trading routes, EA bridge contract. Findings ordered by severity.

#### 3.5.1 Ingestion outages are invisible to every staleness guard — the data clock references itself (CRITICAL)
`runStrategyPipeline(symbol, latestCandleTs, ..., latestCandleTs)` passes the **data clock** as `evaluationTs` (`apps/web/src/lib/pipelineTrigger.ts:431`); `runLivePipeline` then sets `now = evaluationTs` (`packages/tradePipeline/src/liveRunner.ts:423`) and the stale-data breaker compares `MAX(candles_1m_canonical.ts WHERE ts <= now)` **against `now` itself** (`liveRunner.ts:443-448, 1017-1034`) — age is ≈0 by construction. Feature freshness is measured against the same frozen clock (`liveRunner.ts:472, 1115-1135`), and the producer ledger stays green because the inline engine keeps completing runs against the frozen edge while `assertProducerFresh` checks wall-clock `finished_at` (`packages/shared/src/db/producerRuns.ts:142-143`). **Net:** if ingestion stalls (Jul 6–7 precedent), live trading keeps evaluating frozen data and can keep creating orders — dedup-throttled to one per cooldown per strategy — on hours-old signals. The only backstop is post-fill bad-RR auto-close (`api/mt5/fills/route.ts:110-127`). *Fix: a wall-clock guard at `runLivePipeline` step 0 — block when `Date.now() - dataClockMaxTs > 2× trigger interval` — independent of `evaluationTs`.*

#### 3.5.2 Spec-hash cache bug: editing a spec keeps trading the OLD compiled SQL (CRITICAL for your tuning workflow)
`computeSpecHash` = `JSON.stringify(spec, Object.keys(spec).sort())` (`pipelineTrigger.ts:82-84`). An array *replacer* whitelists top-level key names **at every nesting level**, so `steps[].predicate`, `tf`, `ttlMinutes`, `dependsOn`, gate params — none top-level — are stripped from the hash. Verified empirically by the auditor: changing a predicate + TTL yields an identical hash. Both cache layers key on it: the in-process map (evicted only at 100 entries/restart, `pipelineTrigger.ts:104-108`) and Redis `tm:compiled:<hash>` (1h TTL). So after `promote-top3-live.js` or a manual spec edit, live silently trades the previous compiled SQL — indefinitely in-process. `liveRunner.hashSpec` already hashes the full payload correctly (`liveRunner.ts:251-253`). *Fix: hash `JSON.stringify(spec)` in full.*

#### 3.5.3 Eternal fingerprint unique index — root cause of the poisoned-transaction order drops (HIGH, explains §1.1 and §1.4)
`idx_live_signal_dedup` = `UNIQUE(symbol, strategy_id, signal_fingerprint)` with **no time component** (migration 121); fingerprint = `symbol|strategy|side|entry|SL|TP` to 10dp (`liveRunner.ts:239-249`). Two distinct failure modes flow from it:
- A second **legitimate** identical signal (same fixed-pip geometry, hours/days later) violates the index → 23505 → aborts the whole transaction → the order fails as `order_creation_failed: current transaction is aborted` (`liveRunner.ts:893-920`) and subsequent decision-graph persists fail identically. This is almost certainly the exact error chain seen in the production log (§1.1).
- The legitimate dedup path (`ON CONFLICT (deployment_id, symbol, ts, strategy_id, side) DO NOTHING`, `liveRunner.ts:293-306`) silently **skips** the signal insert while the order proceeds — producing orders with no `live_signal` row, which is what §1.4 measured (24/29).
*Fix: add a time bucket to the dedup index (e.g. `date_trunc('hour', ts)`) or catch 23505 on this index and treat as dedup-reject, not abort.*

#### 3.5.4 Small-account anti-stacking caps ignore open positions (HIGH)
`ACTIVE_STATUSES = ["pending", "sent", "acked"]` (`packages/shared/src/smallAccountPositionManager.ts:66`) — but `'acked'` never exists as a status (`markOrderAcked` keeps `'sent'`, `orderService.ts:283-290`) and **`'filled'` is missing**. The per-symbol and total position caps (`smallAccountPositionManager.ts:188-203`) therefore stop counting an order the moment it fills — the "one position per symbol, no stacking/martingale" protection is void for the entire life of an open trade. liveRunner's own heat/family gates use the correct `["pending","sent","filled"]` (`liveRunner.ts:697-699`). *Fix: one-line — `["pending","sent","filled"]`.*

#### 3.5.5 Mixed live/paper poll: batch-level `mode` can execute paper orders with real money (HIGH)
`GET /api/mt5/signals` collapses each poll to one mode: `hasLive ? "live" : hasPaper ? "paper"` (`api/mt5/signals/route.ts:152`); the per-signal payload has **no** `trade_mode`, and the EA applies the batch mode to every signal (`tradzfxExecutionBridge_v4_22.mq5:1287-1293,1371`). One live + one paper signal in the same poll → the paper strategy's order executes with real money. *Fix: per-signal `tradeMode` in `EaSignal`; EA executes per-signal.*

#### 3.5.6 Live evaluation is STATELESS and reverse-anchored — this reframes your "progressive state" mental model (HIGH — design gap)
The compiled progressive chain is enforced per query, not across time: `child.ts <= parent.ts` per step (`compiler.ts:511-512`) and entries anchor `ts <= lastStep.ts` (`compiler.ts:414`) — so the **entry event must be the oldest element and the root bias bar the newest**; `signal.ts` = root ts. A setup fires only when a *fresh root bar* arrives after all downstream pieces already exist. There are **no setup instances tracked across evaluations**; `setup_evaluations` is an audit/grade record, never consulted as state. Consequences:
- The "1-step-at-a-time checklist within the trade's lifecycle" you described is enforced only as a *snapshot filter*, not as a stateful progression (bias at 10:00 tracked while waiting for zone at 10:30 does not exist).
- Each new root bar can re-qualify the same old zone/entry events → the same setup re-fires repeatedly, throttled only by the fingerprint cooldown (and only when prices are byte-identical). This is the mechanism behind §1.3's 12-retry loop.
- Since there's no state, there's no invalidation of an emitted setup — §1.5's immortal `waiting` rows.

#### 3.5.7 `trustStoredLifecycle` is a dead compile option; real trust window is up to ~6h (MEDIUM)
The option is declared and passed everywhere but **never consumed** in `packages/strategies/src` — actual live/PIT divergence comes from `mode` (PIT strips `is_fresh`; both modes get `(invalidated_at IS NULL OR invalidated_at > asOf)` windows, `sqlBuilder.ts:212-236`). AGENTS.md's description is spiritually true but mechanically wrong. Separately: the stored lifecycle that live trusts is maintained by (a) a 25s-capped inline nudge with errors swallowed and (b) `tz-refresh-lifecycle` whose **shipped default interval is 6h** (`refresh-lifecycle-cron.js:18`) — AGENTS.md's "15–30 min" is guidance, not the default. Worst case: live trusts a zone as fresh ~6h after price invalidated it — a genuine live/backtest divergence (backtest recomputes lifecycle PIT-correctly). *Fix: default `REFRESH_LIFECYCLE_INTERVAL_MS=900000`; remove or wire the compile option; flip `TM_PRODUCER_STALE_ACTION=block`.*

#### 3.5.8 Gate fail-open inventory (MEDIUM — protections that silently vanish on error)
- Freshness batch query error → warn and **continue as OK** (`liveRunner.ts:1136-1138`); ledger missing/error → `fresh: true` (`producerRuns.ts:138-140, 161-163`).
- Portfolio heat: correlation query error → weight 0 — and the module-level `corrCache` (`portfolioHeatGate.ts:42`) **caches that 0 forever**; `clearCorrelationCache` is never called. One transient DB error permanently disables correlation protection in a long-lived web process.
- `evaluateSetup` throw is swallowed → order proceeds (`liveRunner.ts:784-786`).
- Unknown gate name in a spec → `console.warn` + skip (`liveRunner.ts:647-649`): a typo'd gate silently vanishes.
- Spread gate with `maxSpreadPips` undefined → `NaN` comparison → always pass (`spreadGate.ts:32-34`).
- Volatility gate: missing/errored profile row → no ceiling → pass (`volatilityGate.ts:164-176`).
Fail-closed (verified): spread/session/ATR data missing, quality no-snapshot, live orders with dead terminal, any gate **throw** → rollback.

#### 3.5.9 Other live findings (MEDIUM/LOW)
- **Daily loss/win gates undercount swing trades:** `recentOrders` fetched with `created_at >= now-24h` but counted by `closedAt >= startOfUTCDay` (`liveRunner.ts:665-673`, `dailyLossGate.ts:26-32`) — a trade opened >24h ago that closes today is invisible to the daily-loss breaker.
- **Account-wide gates race across symbols:** per-symbol `risk_state FOR UPDATE` mutex, but `maxPositionsTotal`/daily-loss/consecutive-loss/portfolio-heat are account-wide reads (`smallAccountPositionManager.ts:197-249`) — two concurrent symbol pipelines can jointly exceed caps.
- **No opposite-direction guard:** two families can hold simultaneous buy+sell on one symbol (accidental hedge); only intra-family dedup exists (`familyPositionGate.ts:33-43`).
- **Decision traces rolled back on every rejection:** the `DecisionGraph` persists inside the same transaction that rejections roll back (`liveRunner.ts:632, 879-880`) — per-gate forensic attribution for rejects is destroyed. Persist post-rollback via the pool.
- **Position commands lost if the poll response is lost:** marked `sent` during the poll, never redelivered (`positionCommandService.ts:99, 261-272`) — a `CLOSE_POSITION(BAD_FILL)` can expire undelivered, leaving a bad-fill position open.
- **Backtest doesn't model live-only reject layers** (quality engine, fingerprint cooldown, correlation heat) → backtest systematically overstates executed trades vs live (one-directional divergence).
- **Debug compiles diverge:** `dry-run-live.ts`/`debug-gate.js` compile without `dataClockTable` → `NOW()` fallback — their verdicts can disagree with production.
- Gate features anchored at `signal.ts`, not order time: spread/session/vol can be up to `signalTtlMinutes` (default 15) stale at placement.
- Profit-lot sizing uses account-global realized P&L across all strategies — one strategy's profit inflates another's size.
- `structureFreshnessMinutes` is applied only by the flat compiler, not progressive (`compiler.ts:592-600`) — flat/progressive divergence.
- Bare `is_fresh` (without `= true`) in a predicate would survive PIT stripping — latent look-ahead leak; all current specs use `is_fresh = true` (grep-verified, but add a validator rule).
- `appendSignalCandidate` does sync `appendFileSync` on the hot path per run — minor event-loop stall.
- Clock mixing: `expires_at` computed on web clock, enforced with DB `NOW()` — fine on one host, skew risk if separated.
- Partial fills not modeled server-side (single `fill_price`).

#### Verified solid (live path)
- Signal→order atomicity: `live_signal` + `orders` + `live_order` in ONE transaction — no orphan signals on failure.
- Order state machine enforced in SQL (`status IN (...)` in UPDATE WHERE) with row locks; EA poll uses `FOR UPDATE SKIP LOCKED` — an order can never be delivered twice.
- Fill/close idempotency via deterministic keys + `ON CONFLICT DO NOTHING` + duplicate-ticket short-circuit; bogus 0/0 closes rejected.
- Live orders refused when the terminal is offline (`orderService.ts:98-114`).
- Signal risk-geometry validation before gate work; `pctToColumn` strictness validated at gate construction.
- Backtester and live share gate factory code and the same compiler — SQL parity is structural, not forked.
- Spread gate is unit-correct against the pips contract.

---

## 4. Prioritized remediation list

> **Numbering note:** the execution plan in **§7** supersedes this section's numbering. It uses the revised tiers agreed after review (Tier 1 = items 1–14 incl. the two promoted items, Tier 2 = 15–23 with entry-freshness ahead of the state-machine item and the state machine refined to forward-causal chaining, Tier 3 = 24–28), and adds files/tests/acceptance per item. Treat §7 as authoritative for implementation; §6 covers architecture-wide systemic principles behind the same fixes.

Ordered by (trading impact × effort). §-refs point into this report.
**NOTE:** Every item below prescribes a SYSTEMIC fix, not a one-liner.
Cross-reference §6 for the architectural principles each fix instantiates.

### Tier 0 — today, before the next trading session (ops)
1. **Restore the stack** (§0): runbook ordering (PG → `tz-ingestion` DB-connected → web → health-poll), verify `:3004/health`, watch EA spools drain, then `refresh-candle-caggs.js` + targeted feature backfill for the 03:36→restart gap (XAU from 03:36, majors from 06:36). **`pm2 save` once green** — your dump file is currently an empty list, so the next reboot repeats this.
2. **Alert on data-edge age**: `MAX(candles_1m.ts)` per symbol older than ~10 min (wall clock, market hours) → page. DXY was dead 4 days, XAU died 3h early, the whole stack died ~7h — all invisible today.

### Tier 1 — correctness bugs actively costing you trades or truth (this week)
3. **Fill look-ahead in the backtester** (§3.2.1): fill at `ts >= signal.ts + TF_MS[tf]`. Systemic fix: **(A)** thread the signal tf through `simulateTrade`; **(B)** encode `signalTf` derivation as a reusable utility (`deriveSignalTf(spec)`) that works for both flat and progressive specs so the rule is defined once; **(C)** add a compile-time assertion that every spec with a non-1m signal tf cannot backtest without this delay — the compiler itself rejects specs that would produce zero-latency fills on non-1m TFs. After fixing, **re-run every seeded backtest** — expect uniformly degraded numbers; believe those.
4. **Pivot-confirmation look-ahead** (§3.3.1): **(A)** add `detected_ts` column to the pivot feature output (the confirmation bar's ts, not the formation bar); **(B)** add `detected_ts` to every pivot-derived table (`features_structure`, `features_zone`, `features_order_block`, `features_sweep`) — one-time schema migration; **(C)** change the registry contracts so the compiler's PIT LATERAL joins on `detected_ts <= anchor` instead of `ts <= anchor`; **(D)** produce the interim `ts - lookback*bar` lag via a registry fallback function that fires a deprecation warning for any spec joining on the old column. **Same class:** §3.3.2 wall-clock `tapped`/`fill_pct`/`quality_score` — derive as-of anchor in PIT mode or exclude from PIT predicates.
5. **Compiler eats spec rules silently** (§3.1.1 + §3.1.2 + §3.4.2): **(A)** emit the root predicate into the root CTE via `translatePredicate()` (not just `extractEqualityPushdowns()`) — one `if (rootPredicate) ctes[0] += ' WHERE ...'`; **(B)** enforce single-linear-chain at seed-time via a validator that errors on unreachable CTEs (fan-out branches that nothing references); **(C)** add a `compile-time SQL diff` step to `pnpm db:seed:check` — for every compiled spec, extract the WHERE clauses and compare them against an intent manifest parsed from the spec's predicates. This turns silent drops into hard seed failures. **Then re-seed and diff every spec.**
6. **Broken active variants** (§3.4.1): **(A)** add `predicate PRESENT` to `validateProgressiveSpec`; **(B)** stop the **seeder** from emitting `steps: null` / `setup: null` for keys a variant doesn't override (preserve explicit YAML nulls — they're meaningful); **(C)** require a `<familyId>.yaml` canonical file for all multi-variant families at seed-time — the seed script itself enforces this before it writes any DB rows.
7. **Web dashboard reads/writes the wrong spec store** (§2.2): the UI and `update-spec` API land edits in `strategy_specs` (pre-migration flat specs for progressive families), which the live path ignores. Fix: re-seed `strategy_specs` from effective specs on every `db:seed` / `promote-top3-live`, or point those API routes at `strategy_families`/`strategy_variants` instead.
8. **Seed-time "hydrate + compile" smoke test** (§3.4 class): five findings — v4 won't compile, stub variants null-deleted, fvg/orb `signalSource` throws, timeWindows invalid SQL, smc family collapse — are the *same class*: a spec that seeds clean but can't compile. Running `compileStrategy()` on every effective spec inside `pnpm db:seed:check` kills the whole class for ~20 lines of code. **Single highest-leverage item in the report.**
9. **Spec-hash cache bug** (§3.5.2): **(A)** hash the full `JSON.stringify(spec)` (no replacer) — one line; **(B)** add a Redis-backed `version` counter for the spec in the DB (`strategy_variants.config_hash`), bumped on YAML re-seed, so the process-level cache also evicts on spec change without TTLs; **(C)** log a warning when the cache returns a hit whose `dataClockTable`/mode mismatch the current runtime.
10. **Fingerprint unique index aborts transactions** (§3.5.3 = §1.1 + §1.4): **(A)** add `date_trunc('hour', ts)` to `idx_live_signal_dedup` so re-fires days later don't collide; **(B)** wrap the UNIQUE-violation catch in the pool helper (`catch (23505) → `) as a shared utility so every INSERT that might collide uses it; **(C)** add a `PG_SAFE_UNIQUE` helper that surfaces the conflict as a boolean return, not an abort.
11. **Position caps ignore filled trades** (§3.5.4): **(A)** `ACTIVE_STATUSES = ["pending","sent","filled"]` — one line; **(B)** move this constant to `packages/shared/src/order/constants.ts` as the **single source of truth** re-imported by every gate and the position manager; **(C)** add a unit test that every gate and the small-account manager import the same constant — enforcing the fix at compile time.
12. **Mixed live/paper batch mode** (§3.5.5): **(A)** add a `tradeMode` field to the per-signal `EaSignal` serialization; **(B)** change the EA to read per-signal `tradeMode` instead of the batch-level mode; **(C)** remove the batch-level mode collapse in `api/mt5/signals/route.ts` — if live+paper signals coexist, emit both with their own `tradeMode`. **⚠ Sequencing: (B) is bottlenecked on EA recompile/redeploy. Ship the interim server guard (never mix modes in one poll) first — do (C) + a poll-level mode consistency check before touching the EA.**
13. **Wall-clock staleness guard** (§3.5.1): **(A)** add a wall-clock independent guard at `runLivePipeline` step 0 — block when `Date.now() - dataClockMaxTs > 2× trigger interval`; **(B)** gate this against the market calendar (`isTradableInstant` + per-symbol daily breaks via `DAILY_BREAKS_BY_SYMBOL`) to avoid false blocks on weekends and metals pauses; **(C)** make the max-age a per-spec `freshness.maxDataAgeMinutes` setting with a safe global default. **⚠ Must use `isTradableInstant` or it pages you every weekend and false-blocks Sunday's Asia open.** This is the **only** staleness measure that can't false-negative against a frozen data clock.
14. **Backtester crashes** (§3.1.5 `spec.setup ?? []`; §3.2.2 delete `slippagePrice`/`commissionPrice`): **(A)** guard every `spec.setup` access with `?? []`; **(B)** delete the cost terms; **(C)** add a `scripts/backtest-smoke-test.js` that runs each active variant for 1 day and asserts exit code 0 — wired into the CI gate so no future commit can ship a backtester crash.

### Tier 2 — make the architecture match your intent (next 2 weeks)
15. **Step branching and entry TTL** (§3.1.3 + §3.1.4 + §3.4.5 + §3.5.6): **(A)** implement `ttlMinutes` on entry conditions and validate it at seed — no entry without an explicit TTL; **(B)** port `structureFreshnessMinutes` into the progressive path as a shared helper that covers ALL event-type features, not just structure; **(C)** exempt entry events from session/weekend padding (the 63–83h windows are a padding artifact, not intent); **(D)** add a `spec.compileSettings.chainSemantics: "snapshot" | "progressive"` flag that encodes the chain semantics decision — today it's `"snapshot"` (each trigger re-runs the full filter). Leave `"progressive"` (true stateful progression) as a future lane marker.
16. **Decide and encode chain semantics** (§3.5.6): **Don't build the full state machine yet.** The gaps §1.3 (retry loop) and §1.5 (immortal waiting) are fixed by entry TTLs + the fingerprint fix (§10), not by a state machine. There's an 80/20 I'd do first: keep it stateless and make the chain **forward-causal** instead of reverse-anchored — require `entry.ts >= zone.ts >= root.ts` and stamp the signal at the entry event. That gives ordered progression, kills inverted causality and the 63–83h entry windows naturally, and preserves live/backtest parity for free (both still just run the compiler). The full state machine (persisted setup instances, per-stage expiry) only earns its cost if you want cross-bar memory and per-stage tracking UI; and if you build it, you must implement it twice (live + backtest) or you've created a brand-new parity gap. Either way, expect all progressive specs' signal timing to change → re-backtest.
17. **Lifecycle correctness**: **(A)** rescan the full open-zone set each refresh like migration 146 does for order blocks (§3.3.3); **(B)** unify `mitigated_at`/`fill_pct` semantics between the TS engine and SQL 117 (§3.3.4) by making the SQL functions call the same `computeZoneLifecycle` JS; **(C)** point lifecycle SQL at `market.candles_1m_canonical` (§3.3.6) by changing the FROM clause in every lifecycle function; **(D)** renumber duplicate migrations and make the runner fail on duplicate numeric prefixes (§3.3.7); **(E)** ship `REFRESH_LIFECYCLE_INTERVAL_MS=900000` (15 min) as the default and **remove the env-var fallback** so a missing config defaults to 15m, not 6h.
18. **Gates that fail open** (§3.5.8): **(A)** add a `TTL` or `clearCorrelationCache` to the module-level `corrCache` so a transient error doesn't poison it forever; **(B)** unknown-gate-name → hard error at seed (not warn+skip); **(C)** `evaluateSetup` throw → block the order, not let it proceed ungraded; **(D)** spread-gate NaN path → block; **(E)** write a `gate-fail-closed.test.ts` that injects a DB error for each gate type and asserts the trade is blocked. **⚠ Do NOT flip `TM_PRODUCER_STALE_ACTION=block` until the fail-open-on-DB-error paths (freshness batch query, ledger missing/error → `fresh: true`) and the weekend false-block trap are fixed** — in `block` mode those become a self-inflicted Monday-morning outage.
19. **Seed/promote hygiene** (§3.4.3/§3.4.4): **(A)** gates run on effective merged specs and include `steps[]` — `collectCapabilityMatrix` must accept a spec, not just setup[]; **(B)** `NO_DATA` on a required condition = FAIL (not pass); **(C)** per-symbol checks from `filters.symbols`; **(D)** promote wrapped in a transaction + requires a passing backtest row for that variant; **(E)** bare `db:seed` must not undo promote deactivations — enforce via a `promoted_at` timestamp on `strategy_variants` that seed refuses to downgrade; **(F)** `experimental` → seeds as inactive by default.
20. **Backtest honesty** (§3.2.3–3.2.10, §3.3.8): **(A)** timeouts close at last bar's close and count in netR (not 0R vanished); **(B)** gap-through-bracket fills book immediate losses at the open (not excised); **(C)** analyzerBacktest `"pessimistic"` mode must have symmetric TP-first semantics for both directions (not flatter shorts); **(D)** each persisted run gets a `config_jsonb` with mode/profile/intrabar/spec-version/engine_ver + a `UNIQUE(run_id, symbol, ts, direction)` key to stop double-counting; **(E)** setup-eval cache hash includes the grader version; **(F)** volatility profile gated as-of `computed_ts <= signalTs`; **(G)** uses `isTradableInstant` for weekend-aware warmup; **(H)** every `EXTRACT`/`ts::time` cast pins `AT TIME ZONE 'UTC'`. **⚠ Fix ALL the backtest flattering channels in one harness release** (fill timing, `detected_ts`, timeouts, gap-through, shorts asymmetry), re-baseline seeded reports once, and explicitly document that the drop is expected. Otherwise someone "re-tunes" specs to recover phantom performance == overfitting to the buggy harness.
21. **Data/model fixes** (§3.3.8–3.3.10, §1.8): **(A)** replace `filterWeekdayCandles` with `isTradableInstant(ts, symbol)` so Sunday 21:00+ is included in feature computation; **(B)** carry `gapMinutes` through the rollup path and flag dense features computed across gaps > N×bar as degraded; **(C)** bounded catch-up anchors after trigger outages; **(D)** market-calendar gating for the evaluation loop.
22. **Finish the migration or declare scope** (§2.1): convert or retire ~27 active variants that still run flat semantics. Add a lint rule: `pnpm lint:specs` that fails on any `setup[]`-only family not on an explicit exemption list.
23. **Dead option** (§3.3.5): delete `trustStoredLifecycle` from every call site and correct AGENTS.md SK-55 — three audits independently tripped over this.

### Tier 3 — operational hardening (month)
24. **Ledger retention** (§1.7): add a `prune_feature_producer_runs` SQL function + cron that retains 14d; add an error-storm circuit breaker (n errors/second over threshold → cool-off for that feature); vaccuum/analyze hot tables weekly. **Note: the "1.6M rows/day" was mostly an anomaly window** (305–411k runs/hour between 23:00–01:00; steady state is ~4k/h from the inline trigger). Investigate what caused that burst before sizing retention around it, though 14-day pruning is right regardless.
25. **Forensics**: persist decision-graph traces using a **separate pool** from the order transaction so a rollback doesn't erase the trace; add `sent`-unacked redelivery for position commands (re-poll unacked after timeout); make `orders ↔ live_signal` join total by adding an `order`-side FK that the transaction always populates.
26. **Account-wide race** (§3.5.9): add a `scope='account'` advisory lock row for portfolio-wide gates; add opposite-direction guard per symbol.
27. **TZ hygiene**: verify the actual pool session TZ first (`SHOW timezone` at startup) — if it's already UTC everywhere (likely), this drops to a code comment rather than a fix. If not: `SET timezone = 'UTC'` on every pool constructor with a startup assertion.
28. **Hygiene**: drop scratch tables; fix the red `compiler.test.ts`; Timescale job-failure alerting.

## 5. What is verified solid

Credit where due — these were explicitly checked and are correct:

- **Compiled PIT signal SQL**: every feature LATERAL bounds `feature.ts <= anchor.ts` with a lookback floor (no intra-chain look-ahead); lifecycle via as-of `invalidated_at/mitigated_at > anchor` windows; ORB session rows pinned date+session+completion; `is_fresh` stripped in PIT; no `NOW()` in PIT mode; deterministic seeded RNG.
- **Live/backtest structural parity**: same compiler, same gate factories, same `evaluateSetupBatch` — divergence comes from specific bugs (§3.2.1, §3.3.1, §3.5.2), not forked logic.
- **Signal→order atomicity & EA delivery**: one transaction for signal+order+live_order; `FOR UPDATE SKIP LOCKED` poll; deterministic fill/close idempotency keys; terminal-offline refusal; order state machine enforced in SQL.
- **Seeded reports are conservative where it matters**: `sl_first` intrabar + strict setup profile; suspect-candle quarantine; preflight hard-blocks corrupted symbols with a marked result instead of fake "0 trades".
- **Producer ledger truthfulness** (SK-62 fix works), cache keys include `engine_ver`, lifecycle functions are atomic with no resurrection and breach-bar-accurate `invalidated_at`, dense producers (ATR/bias/htf_bias/direction_state) are PIT-pure at compute time.
- **Spread/pip unit contract** end-to-end (gate, ingestion, backfill) — per your instruction we did not audit cost *modeling*, but the units machinery is consistent.
- **Destructive-migration guard**, market-calendar coverage math (weekends/breaks), EA-side wall-clock scheduling fix, ingest spool design (it's why tonight's outage is recoverable).
- **Spec DAG validation** (cycles/dangling/session/TTL) and direction-inheritance mechanics through no-direction intermediate steps; 59/61 effective specs compile.

---

## 6. Architecture-wide remediation: systemic principles & global fixes

The preceding audit identified **six recurring anti-patterns** that independent teams would each discover independently, and one giant class of problems (your shared-feature-config concern) that no individual feature fix can address. This section lays out the **one-time architectural changes** that eliminate entire classes of bugs rather than fixing them one at a time.

---

### 6.0 The shared-feature-config problem — how changes to one strategy's knobs silently break others

**Confirmed: YES, this is real.** Every feature producer (`pivot.ts`, `structure.ts`, `zone.ts`, `ifvg.ts`, `sweep.ts`, `orderBlock.ts`, `candlePattern.ts`, `bollinger.ts`, `keltner.ts`, `movingAverage.ts`) has **globally-scoped configuration** — hardcoded constants or `process.env` variables that apply to every strategy that reads from that feature table. There is no per-strategy isolation layer.

**The three contamination mechanisms:**

| # | Mechanism | Example | Impact |
|---|---|---|---|
| 1 | **Global producer parameters** | `pivot.ts` has `TF_LOOKBACK = {1m:3, 5m:5, 15m:8, ...}` | This is the ONLY pivot detector. Tighten for scalpers → swing strategies see fewer, later pivots. Loosen for swing → scalpers drown in micro-pivots. Both live at the same time. |
| 2 | **Global registry defaults** | `featureRegistry.ts` has `features_zone.defaultLookbackBarsByTf[15m] = 96` | Every spec without explicit `lookbackBars` inherits 96 bars (~24h). One strategy needing 48h and another needing 12h cannot coexist through defaults. |
| 3 | **Per-column output is PIT-fragile** | `features_zone.quality_score`, `tapped`, `fill_pct` are last-writer-wins wall-clock values | Any consumer joining as-of a timestamp before the last write sees the latest score, not the score at the anchor. Multiple strategies with different join policies collide on the same row. |

#### 6.0.1 Systemic fix — Strategy-scoped feature parameters

**Design principle:** *The same feature row can legitimately be "too noisy" for one strategy and "too sparse" for another. The producer owns the canonical truth; the consumer owns the interpretive lens.*

**Implementation — add `featureOverrides` to the spec YAML:**

```yaml
# In any strategy spec; optional section
featureOverrides:
  features_zone:
    # Override per-condition at query time — no producer changes
    conditions:
      - minQualityScore: 0.25    # stricter than global 0.15
        maxAgeBars: 20            # wider than global 10
        maxZonePerBar: 3          # fewer candidates
  features_pivot:
    lookback: 5                   # tighter per-TF pivot detection
    # ^ Means "only see pivots at this lookback, not the producer's 8"
  features_ifvg:
    minFillPct: 0.3               # looser than global 0.5
    minConfirmations: 1           # faster entry than global 2
```

The override is enforced **at query time** in `buildProgressivePitLateral` / `buildPitLateral` — additional WHERE clauses filter the feature rows the strategy sees. **The producer is unchanged.** This is correct because:
- It's zero-risk: existing specs with no `featureOverrides` behave identically.
- It's deployable per-strategy: a new variant can tighten/loosen without a redeploy.
- It's auditable: the compiled SQL shows exactly what filters applied.

**When a query-time filter is NOT enough** (e.g., pivot detection lookback changes the *existence* of rows, not just which ones survive a WHERE clause), the correct fix is to **produce multiple pivot sets** keyed by a `pivot_lookback` parameter in the feature table, or compute pivots at the max needed lookback and let consumers filter by requiring `pivot_lookback <= consumerLookback`. The latter preserves the single-writer contract.

#### 6.0.2 Fix — Registry defaults become per-strategy, not per-table

The `FEATURE_REGISTRY` gets a new optional field:

```typescript
interface FeatureContract {
  // ... existing fields ...
  /**
   * When a strategy spec omits `lookbackBars` for a condition, fall back to
   * the strategy-level default (from spec.featureDefaults?.lookbackBars) before
   * falling back to the registry default. This lets a strategy author say
   * "all my zone lookbacks are 48" without repeating it per condition.
   */
  strategyDefault?: (spec: StrategySpec) => Record<TimeFrame, number> | undefined;
}
```

And `validate.ts` gains a rule:

```
RULE: Every condition must have EITHER explicit `lookbackBars` or `ttlMinutes`.
Violation = seed failure.
```

This eliminates silent coupling through registry defaults. Every strategy author consciously chooses windows.

---

### 6.1 Systemic fix — PIT look-ahead in stored features (§3.3.1, §3.3.2)

**Root cause:** The feature engine persists rows with `ts = formation bar`, but the row is only knowable after a confirmation bar (pivot detection needs `lookback` bars after; structure confirmation needs up to 5 bars; iFVG fill% needs future candles). The compiler then joins on `ts <= anchor`, reading rows that didn't exist at the anchor.

**The ONE fix that eliminates the entire class:**

1. **Add `detected_ts` to the pivot output schema** — the timestamp of the **confirmation bar** (the last bar the engine needed to see before it could emit the row). For pivots: `ts` = candidate bar, `detected_ts` = candidate bar + lookback bars. For structure: `ts` = break bar, `detected_ts` = confirmation bar. For iFVG: `ts` = formation bar (c1), `detected_ts` = fill bar. For zone: `ts` = impulse bar, `detected_ts` = bar after the nearby pivot. For sweep: `ts` = sweep bar, `detected_ts` = same (sweep is immediate).

2. **Change the compiler's LATERAL joins** from `AND f.ts <= anchor.ts` to `AND f.detected_ts <= anchor.ts`. This is a **one-line change** in `sqlBuilder.ts` and `buildProgressivePitLateral`.

3. **Change the feature registry** so `createdAt` for pivot-derived features references `detected_ts` instead of `ts`. Feature contracts get a new field:

```typescript
interface FeatureContract {
  // ... existing fields ...
  detectedAtColumn?: string;  // default: ts (no leak = same)
  // For pivot-based features: "detected_ts"
}
```

4. **Add a `PIT_VALIDATION_TS` column** to pivot-derived feature tables as `detected_ts` (nullable so historical rows can be backfilled). Seed-time: the `buildLookbackInterval` function automatically falls back to `detected_ts IS NOT NULL AND detected_ts <= anchor` when the column exists, else `ts <= anchor`.

**Why this is systemic (not a band-aid):**
- Every pivot-derived feature ever created or future automatically gets PIT-correct joins.
- The single `detectedAtColumn` in the registry means no feature author can forget.
- Backward-compatible: existing rows with `detected_ts = NULL` fall back to `ts` (current behavior, for the migration window).

---

### 6.2 Systemic fix — Compiler must never drop spec rules (§3.1.1, §3.1.2, §3.4.2)

**Root cause:** `compileProgressiveSQL` has two bugs that make it possible to write a spec whose predicates are silently ignored. One (`extractEqualityPushdowns` only, not `translatePredicate`) lets root predicates vanish. The other (fan-out branch dead code) lets half a strategy vanish.

**The ONE fix that eliminates the entire class:**

**Replace `compileProgressiveSQL`'s ad-hoc predicate handling with the flat compiler's predicate translation, then add a structural validator:**

```typescript
// In compileProgressiveSQL — root step handling:
const rootCte = `${alias} AS (
  SELECT DISTINCT ON (symbol) symbol, ts, direction${cols}
  FROM ${step.feature}
  WHERE tf = '${step.tf}'
    ${timeFilter}
    ${symbolFilter}
    -- USE translatePredicate, NOT just equality pushdowns:
    ${step.predicate ? `AND (${translatePredicate(step.predicate, alias, "setup", biasAliases)})` : ""}
  ORDER BY symbol, ts DESC
)`;
```

**And at seed-time in `validate.ts`:**

```typescript
function validateProgressiveStructure(spec: StrategySpec): string[] {
  const errors: string[] = [];
  const steps = spec.steps ?? [];
  
  // 1. Every step must have a predicate
  for (const step of steps) {
    if (!step.predicate) {
      errors.push(`Step '${step.id}' has no predicate`);
    }
  }
  
  // 2. No fan-out: every step (except root) must have exactly one parent,
  //    and every step (except leaves) must have exactly one child
  const childCounts = new Map<string, number>();
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      childCounts.set(dep, (childCounts.get(dep) ?? 0) + 1);
    }
  }
  const roots = steps.filter(s => !s.dependsOn || s.dependsOn.length === 0);
  if (roots.length !== 1) {
    errors.push(`Must have exactly one root step; found ${roots.length}`);
  }
  for (const [parentId, count] of childCounts) {
    if (count > 1) {
      errors.push(`Step '${parentId}' has ${count} children — fan-out is not supported`);
    }
  }
  
  // 3. Require ttlMinutes on every step
  for (const step of steps) {
    if (!step.ttlMinutes) {
      errors.push(`Step '${step.id}' has no ttlMinutes — required for progressive semantics`);
    }
  }
  
  // 4. Validate bias-direction features align with direction column contracts
  // (prevents autoAlignDirection on features_zone which has no direction column)
  
  return errors;
}
```

**Why this is systemic:**
- `translatePredicate` handles `features_bias.direction` references, `IN` lists, `IS NULL`, `NOT`, and every predicate form the flat compiler already supports. No custom parser needed.
- The structural validator catches fan-out, missing predicates, missing TTLs, and direction mismatches at seed-time — before any SQL is compiled or any backtest runs.
- A hybrid spec (both `setup[]` and `steps[]`) is now a hard error: the validator enforces exactly one or the other. No more silent RSI-vanishing trap.

---

### 6.3 Systemic fix — Spec-hash cache must encode the full spec (§3.5.2)

**Root cause:** `JSON.stringify(spec, Object.keys(spec).sort())` uses an array as a JSON.stringify repeater, which whitelists only first-level keys. Nested fields (`steps[].predicate`, `ttlMinutes`, gate params) are invisible to the hash.

**The ONE fix:**

```typescript
// Simple: no repeater means everything is hashed
function computeSpecHash(spec: StrategySpec): string {
  return crypto.createHash("sha256")
    .update(JSON.stringify(spec))  // <-- no (repeater, sort) argument
    .digest("hex");
}
```

**Layered defense — versioned cache keys:**

Add a `compiled_strategy_snapshot` table with a `version` counter that increments on every seed of that strategy variant. The cache keys become `tm:compiled:<variantId>:<snapshotVersion>`. This:
- Survives process restarts (Redis persists across restarts).
- Evicts immediately on re-seed (version bump).
- Doesn't need TTL-based cache invalidation.
- Can be manually invalidated by bumping the version in the DB.

**Also add a load-time invariant check:**
After loading a cached compiled SQL, re-compute the spec hash and compare. Log a loud warning if they differ — this catches bugs where the hash computation and the spec content drift apart.

---

### 6.4 Systemic fix — All temporal uniqueness constraints must include a time dimension (§3.5.3)

**Root cause:** `UNIQUE(symbol, strategy_id, signal_fingerprint)` has no time bucket, so a byte-identical signal days later violates it. The violation aborts the transaction, killing the order AND the decision trace.

**Architectural rule (encode as a lintable convention):**

```
Every UNIQUE constraint on a table with a `ts` column MUST include either
  date_trunc('hour', ts)   — for dedup/deduplication boundaries
  or the exact `ts` itself — for event-level uniqueness
  or a `validity_range` tsrange — for temporal validity
```

**Implementation in one migration:**

```sql
-- Fix the dedup index
DROP INDEX IF EXISTS idx_live_signal_dedup;
CREATE UNIQUE INDEX idx_live_signal_dedup 
  ON live_signal(symbol, strategy_id, signal_fingerprint, date_trunc('hour', ts));
```

**Add a migration lint rule** that scans `CREATE UNIQUE INDEX` on tables with `ts` columns and warns if no time component is present.

**For the poisoned transaction pattern specifically**, add a shared utility:

```typescript
// packages/shared/src/db/uniqueInsert.ts
export async function insertOrIgnore<T extends Pool>(pool: T, sql: string, params: unknown[]): Promise<{ inserted: boolean; row: any }> {
  try {
    const result = await pool.query(sql, params);
    return { inserted: result.rowCount > 0, row: result.rows[0] };
  } catch (err: any) {
    // 23505 = unique violation; treat as dedup, don't abort
    if (err.code === '23505') return { inserted: false, row: null };
    throw err; // re-throw everything else
  }
}
```

Every hot-path INSERT that could collide uses this wrapper. The transaction is never aborted by a dedup collision.

---

### 6.5 Systemic fix — A single shared constant set for order statuses (§3.5.4, §1.1, §1.3, §1.4)

**Root cause:** `ACTIVE_STATUSES` is defined independently in `smallAccountPositionManager.ts` (`["pending","sent","acked"]`) and used with different semantics than `liveRunner.ts` (`["pending","sent","filled"]`). Neither definition includes `"filled"`. The correct set is `["pending","sent","filled"]` — "acked" never exists.

**Systemic fix — one location, one import, one test:**

```typescript
// packages/shared/src/order/constants.ts
export const ACTIVE_ORDER_STATUSES = ["pending", "sent", "filled"] as const;
export type ActiveOrderStatus = (typeof ACTIVE_ORDER_STATUSES)[number];

/** Statuses that count toward position limits */
export const POSITION_COUNTING_STATUSES = ["filled"] as const;

/** Statuses that a live pipeline order transitions through */
export const ORDER_LIFECYCLE = ["pending", "sent", "filled", "expired", "rejected"] as const;
```

Every consumer:
- `smallAccountPositionManager.ts` imports `ACTIVE_ORDER_STATUSES`
- `liveRunner.ts` imports `ACTIVE_ORDER_STATUSES`
- `portfolioHeatGate.ts` imports `ACTIVE_ORDER_STATUSES`
- `familyPositionGate.ts` imports `ACTIVE_ORDER_STATUSES`
- `dailyLossGate.ts` imports `ORDER_LIFECYCLE`

**Add an integration test** that proves every file uses the shared import:
```typescript
// scripts/audit-order-constants.test.ts
// Reads all source files, greps for "ACTIVE_STATUSES" or "['pending','sent'"
// and fails if any inline definition exists.
```

---

### 6.6 Systemic fix — Data clock must have an independent wall-clock staleness guard (§3.5.1, §1.2)

**Root cause:** The data clock (`MAX(candles_1m_canonical.ts)`) is used as both the time reference AND the staleness measurement. When ingestion stalls, the clock stops. Staleness = `MAX(feature.ts WHERE <= clock)` vs `clock` ≈ 0. Every guard self-references to green.

**Systemic fix — stratified staleness with three independent layers:**

```
Layer 1 — Wall clock vs data clock (CRITICAL, missing today):
  Time since last candle arrival, measured by wall clock.
  Block when: wallClock - dataClockMaxTs > 2 × trigger interval (≈30 min).
  Exception: market closed (via isTradableInstant).

Layer 2 — Producer ledger freshness (EXISTS today, warn-only):
  assertProducerFresh checks finished_at against wall clock.
  Block when: TM_PRODUCER_STALE_ACTION=block (currently warn).
  
Layer 3 — Inline feature engine health (EXISTS today, fail-open bug):
  If engine crashes → skip symbol, don't evaluate stale features.
```

**Implementation for Layer 1 — the only truly independent measure:**

```typescript
// In runLivePipeline, first statement:
const dataAgeMinutes = (Date.now() - evaluationTs.getTime()) / 60000;
const maxAgeMinutes = spec.freshness?.maxDataAgeMinutes ?? 15;
const marketOpen = isTradableInstant(new Date(), symbol);

if (marketOpen && dataAgeMinutes > maxAgeMinutes) {
  // Log: wall clock says data is X minutes old. Market is open. Block.
  await recordProducerRun({
    table: 'live_pipeline',
    status: 'blocked_data_stale',
    rows_inserted: 0,
    detail: `Data age ${dataAgeMinutes.toFixed(1)}m > max ${maxAgeMinutes}m`
  });
  return { blocked: true, reason: 'data_stale' };
}
```

**This is the ONLY staleness guard that can't be tricked by a frozen data clock.** Layers 2 and 3 are still needed, but they serve different purposes (producer health, engine health) — Layer 1 is the circuit breaker.

---

### 6.7 Six architectural rules to prevent entire bug classes

These rules, encoded as automated checks in `validate.ts`, `seed-strategy-specs.js`, and the CI gate, prevent the class of bugs the audit found from recurring.

| # | Rule | What it prevents | Enforced at |
|---|---|---|---|
| 1 | **Every DB uniqueness constraint on a table with `ts` must include a time dimension** | Poisoned transactions from dedup collisions (§3.5.3) | Migration lint + code review |
| 2 | **Every feature config knob must be overridable per strategy at query time** | Cross-strategy contamination through global producer parameters (§6.0) | Spec validation + compile-time check |
| 3 | **Every compiled SQL expression must be tested against an intent manifest** | Spec rules silently dropped by the compiler (§3.1.1, §3.1.2) | `pnpm db:seed:check` — compare WHERE clauses vs spec predicates |
| 4 | **Every persisted backtest run must be self-describing** | Unreproducible backtests, double-counting, unknown mode/profile (§3.2.6, §3.2.7) | `backtest_runs.config_jsonb` is required |
| 5 | **Every gate must be fail-closed by default** | Silent degradation on DB error, unknown gate name, NaN comparison, engine crash (§3.5.8) | Seed-time validation + integration test |
| 6 | **Every separate code path must produce the same semantic result for the same spec intent** | Flat/progressive divergence (structureFreshnessMinutes, signal_direction, entry TTLs) | CI test that compiles the same spec via both paths and diffs the WHERE clauses |

These six rules, automated in the CI pipeline, are the long-term answer to "how do we stop finding these same bugs in every audit."

---

## 7. Developer implementation plan

Numbering follows the revised tiers (mapping to §4 in parentheses). Effort: **S** <2h, **M** ≤½ day, **L** 1–3 days, **XL** >3 days. Every item lists: change → files → tests → acceptance.

### 7.0 Execution rules (apply to all items)

1. **#8 (smoke test) lands in the first code PR** — it makes every later spec/compiler change verifiable.
2. **Sequencing constraints, non-negotiable:**
   - ⚠ **#16** depends on #5, #14, #15 (compiler must stop dropping rules and entries must have TTLs before chain semantics change).
   - ⚠ **#20** ships as **one** harness release together with #3 and #4A; re-baseline all seeded reports once, and document that the drop is expected — do not re-tune specs to recover phantom performance.
   - ⚠ **#18's `TM_PRODUCER_STALE_ACTION=block` flip is the LAST step of #18**, after #13 and the weekend trap (§3.3.10) are fixed — otherwise it's a Monday-morning self-DoS.
   - ⚠ **#12** is EA-bottlenecked: the server-side one-mode-per-poll guard ships first; the per-signal `tradeMode` EA change follows the EA recompile/deploy runbook.
   - ⚠ **#13 and #2** must use `isTradableInstant` + `DAILY_BREAKS_BY_SYMBOL` (`packages/shared/src/utils/marketCalendar.ts`) — no weekend paging, no XAU 21:00 false blocks.
   - ⚠ **#24**: investigate the 23:00–01:00 burst (peak 411k runs/h — steady state is ~4k/h) before sizing retention.
   - ⚠ **#27**: verify the actual pool session TZ first; if UTC everywhere, this item collapses to a code comment.
3. Re-**`pm2 save`** after every PM2 topology change (#1 does this once; keep doing it).
4. **TF-specificity rules (apply to all spec/compiler work — from the pivot/structure TF analysis):**
   - **HTF pivots/structure are context, never entry triggers.** Confirmation needs `lookback` bars *after* the event (`pivot.ts:30-37`: 1m=3 … 1d=20), so the freshest knowable structure is inherently ≥2h stale on 15m, ≥10h on 1h, ≥2.5d on 4h, ≥~20 trading days on 1d. After #4B this becomes visible in backtests — write specs accordingly (HTF → bias/zones; LTF → entries) and treat any `entry` condition on structure/pivot ≥4h as a design smell at review.
   - **Validator additions (fold into #6):** `ttlMinutes >= 2 × tf minutes` per step; entry tf must exist in the feature's produced-tf set for the spec's symbols (e.g. DXY has 9/10 symbol coverage in several features — a spec depending on the missing one starves silently).
   - **Entry freshness is expressed in bars of the entry tf** (fold into #15): prefer per-entry `ttlMinutes` = N × tf minutes; deprecate minutes-based `structureFreshnessMinutes` in progressive mode (120 min = 120 bars on 1m vs 8 bars on 15m — inconsistent by construction).
   - **Warmup accounts for the slowest feature tf in the spec** (fold into #20): bias@1h long-EMAs and pivot 2×lookback need far more wall-clock history than 200 signal-tf bars; preflight should warn when HTF features are unstable/missing near the window start.
   - **Entry thresholds are TF-locked:** structure event selectivity is not TF-normalized in the data (~0.27 events/pivot on 15m vs ~0.70 on 1h; 5m emits ~16× more events than 15m over comparable spans). Porting a spec across TFs requires re-validation on the new tf's event rate — never assume thresholds transfer.

---

### 7.1 Tier 1 (items 1–14)

**#1 — Restore stack, make it stick (§0; old T0-1). Ops, no code. Effort S.**
Runbook order: PG reachable → `tz-ingestion` online + DB-connected → build → `tz-web-v2` → poll `/api/health` for `database.connected` → `tz-refresh-lifecycle`. Verify: `curl :3004/health` = `{db:true, spoolFiles:0}` after drain; `MAX(candles_1m.ts)` lag < 5 min per active symbol; engine rows appearing in `feature_producer_runs`; `lifecycle_refresh_state` advancing. Then `refresh-candle-caggs.js` + `backfill-historical-features.js` for the gap (XAU from 03:36, majors from 06:36, 2026-07-21). Finish with **`pm2 save`** (dump was `[]`) and record the expected app list in `ops/`. Acceptance: all of the above green; `cat ~/.pm2/dump.pm2` lists every app.

**#2 — Data-edge alerting (§0; old T0-2). Effort M.**
Extend `ops/monitor-v2-health.ps1` (or a new `ops/watch-data-edge.ps1`): per symbol with an active variant, query `MAX(candles_1m.ts)`; alert if the data edge is older than 10 min **while `isTradableInstant(now, symbol)`** (reuse the TS calendar via a small node helper — do not re-implement); also alert on `:3004/health` failure and `MAX(feature_producer_runs.finished_at)` age > 20 min. Tests: simulated stall fires; Saturday produces silence; XAU 21:00 daily break produces silence. Acceptance: kill ingestion for 15 min on a weekday → alert arrives; weekend = no pages.

**#3 — Backtest fill look-ahead (§3.2.1; old 3). Effort M.**
`scripts/backtest-pit-v2.js`: thread the signal tf into `simulateTrade`/`simulateBidCandleMarketTrade`; change the fill anchor at `:878/:887` (and the limit/stop anchor `:937`) to the first 1m candle with `ts >= signal.ts + TF_MS[signalTf]` (import tf minutes from `packages/shared/src/utils/timeBucket.ts`). Tests: synthetic 15m signal at `ts=10:00` must fill ≥ `10:15` open; 1m signal unchanged. Acceptance: re-run one seeded variant; fills shift to bar close; unit tests green. Note: live fills up to one trigger interval later than bar close (§1.9) — accepted residual optimism; document it in the runner header.

**#4 — Feature detection-time look-ahead (§3.3.1 + §3.3.2; old 4). Two phases.**
- **#4A interim (Effort M, ships in the #20 harness release):** in `packages/strategies/src/sqlBuilder.ts::buildPitLateral`, for `features_pivot` and `features_structure` only (fixed lag), add `ts <= anchor - lookback*tf` using the producer's `lookbackFor(tf)` (`apps/engine/src/features/pivot.ts:41-44`). Do **not** apply to ifvg/zone — their lag is variable; they wait for #4B.
- **#4B proper (Effort XL, own PR):** migration adding `detected_ts` to `features_pivot`/`features_structure`/`features_zone`/`features_ifvg`/`features_order_block`; producers populate it (pivot: pivot bar + lookback bars; structure: confirming-pivot detection; zone: its pivot's `detected_ts`; ifvg: confirmation-close bar; OB: structure `detected_ts`); `featureRegistry.ts` `validityColumns` gains `detectedAt`; compiler joins event/level features on `detected_ts <= anchor` in **both** modes (no-op live — rows only exist post-detection); deterministic re-derivation backfill for history. Tests: a structure event with `formation ts < anchor < detected_ts` is not returned by compiled SQL; `ts <= anchor` display semantics unchanged. Acceptance: backtest signal counts on a known window shift as expected; `ifvg_inv_after_ts` CHECK still passes (`detected_ts >= ts`).

**#5 — Compiler stops eating spec rules (§3.1.1 + §3.1.2; old 5). Effort M.**
`packages/strategies/src/compiler.ts`: emit `translatePredicate(step.predicate)` into the root CTE `WHERE` (`:350-370`, mirroring the flat anchor `:571-577`). Fan-out: in `validate.ts` add a reachability check — every step must lie on the chain to the single entry-anchoring terminal step; seed errors on unreachable CTEs (until merge semantics exist). Rewrite `lewis_kelly_smc_ny_shorts.yaml` as a linear chain `mtf_bias → htf_bias → premium_pricing → supply_retest`. Fix the red `compiler.test.ts:529-534` (implement root `DISTINCT ON (symbol)` or correct the test — decide per §3.1.8). Tests: compiled keylevel SQL contains the `direction != 'neutral'` filter; compiled lewis SQL references `st_htf_bias` from the entry path; seed rejects a fan-out fixture. Acceptance: `pnpm --filter @tm/strategies test` green; diff compiled SQL vs spec intent for all progressive specs.

**#6 — Unbreak active variants (§3.4.1; old 6). Effort M.**
- `keylevel_bounce_v4.yaml:17-21`: add a real `predicate` to the `htf_bias` step (e.g. `direction != 'neutral'`) and a TTL (~480).
- `scripts/seed-strategy-specs.js::computeOverrides` (`:93-96`): stop emitting `key: null` for absent keys — absence = inherit. **Do not** blanket-skip nulls in `strategyVariantLoader.ts`: leaf-level nulls (`zonePips: null`, 26 YAMLs) are intentional values.
- Multi-spec families: seed **errors** when a family has multiple YAMLs and no canonical `<familyId>.yaml`; add canonical bases (or rename) for `smc_ict_liquidity_reversal`, `fib_golden`, `five_one_scalp`; fix `five_one_scalp_v1` (active) to hydrate from the intended spec, or deactivate it.
- `validate.ts`: require non-empty `predicate` on steps; validate `tf` against the TF table; enforce exactly one root.
Tests: hydrate + compile `keylevel_bounce_v1`, `watukushay_fe`, `five_one_scalp_v1` (this is also #8's fixture set). Acceptance: all three compile; seed fails loudly on a missing-canonical fixture.

**#7 — Dashboard reads/writes the right spec store (§2.2; promoted). Effort M. Depends on #9.**
`apps/web/src/app/api/strategies/{detail,dashboard/strategies,update-spec}/route.ts`: move reads to `strategy_families.base_spec` + `strategy_variants.overrides` (same merge as `strategyVariantLoader.ts`); make `update-spec` write to that store **and** invalidate the compiled-spec cache (in-process + Redis `tm:compiled:*`) on write. Keep `strategy_specs` as a derived read model: re-sync it from effective specs at the end of `seed-strategy-specs.js` and `promote-top3-live.js` (or drop it once nothing reads it — re-grep then). Acceptance: edit a TTL via the UI → dashboard shows it → next live trigger logs a fresh compile with the new TTL; `strategy_specs` shows `steps[]` for keylevel/lewis after re-seed.

**#8 — Seed-time hydrate + compile smoke test (§3.4.1 class; promoted). Effort S–M. First code PR.**
In `scripts/seed-strategy-specs.js` (always, and as the last `--check` gate): for every **effective** spec (base merged with variant overrides using the loader's exact merge), run `compileStrategy(spec, {mode:'live'})` and `{mode:'pit'}`; any throw = seed failure with spec id + error. Reuse the merge helper — don't duplicate merge logic (import from `packages/strategies` or extract one). Tests: fixtures reproducing the five historical failures (no-predicate step, stub-variant nulls, progressive+fvg signalSource, progressive+timeWindows, missing canonical base) each fail with a clear message. Acceptance: current tree fails on `keylevel_bounce_v4` + `smc_ict_liquidity_fvg_allpairs_v1` until #5/#6 land; then 61/61 pass.

**#9 — Spec-hash cache (§3.5.2; old 7). Effort S.**
`apps/web/src/lib/pipelineTrigger.ts:82-84`: `computeSpecHash = sha256(JSON.stringify(spec))` (full payload; DB-loaded jsonb has stable key order). Keep the 100-entry in-process cap + 1h Redis TTL. Tests: two specs differing only in a nested `ttlMinutes` hash differently (regression test for the replacer bug). Acceptance: DB spec edit → next trigger logs a new hash and compiles fresh (no restart).

**#10 — Fingerprint dedup stops aborting transactions (§3.5.3 = §1.1 + §1.4; old 8). Effort M.**
Minimal: in `packages/tradePipeline/src/liveRunner.ts` signal-insert path (`:293-306`), catch `23505` on `idx_live_signal_dedup` → treat as dedup-reject (structured rejection row), never let it abort the transaction. Better (same PR): migration replacing the index with `UNIQUE(symbol, strategy_id, signal_fingerprint, (date_trunc('hour', ts)))`. Note `findRecentDuplicate` (`:255-273`) already enforces the 30-min cooldown, so the index is belt-and-braces. Tests: identical signal re-fired 2h later → second order created or clean dedup-reject; zero `order_creation_failed: current transaction is aborted` in logs; every order joins a `live_signal` row (§1.4 metric → 0 orphans). Acceptance: chaos test passes; §1.4 query returns 0.

**#11 — Position caps count open trades (§3.5.4; old 9). Effort S.**
`packages/shared/src/smallAccountPositionManager.ts:66`: `ACTIVE_STATUSES = ["pending", "sent", "filled"]`. Tests: a `filled` order counts against per-symbol and total caps; a second (esp. opposite-direction) order on the same symbol is blocked while the first is open. Acceptance: unit tests green; no other consumer references `'acked'` (grep).

**#12 — Paper orders can never execute as live (§3.5.5; old 10). Two parts.**
- **#12a server guard (Effort S, ships first):** `apps/web/src/app/api/mt5/signals/route.ts` — never return mixed modes in one poll: live signals first; paper only when the poll has no live. Add a loud log line when a paper signal is deferred by this rule.
- **#12b per-signal mode (Effort M + EA release):** add `tradeMode` to `EaSignal`; EA `tradzfxExecutionBridge_v4_22.mq5:1287-1293,1371` executes per-signal mode instead of batch mode; recompile, deploy per `mt5-ea/DEPLOYMENT.md`, keep `.ex5` rollback. ⚠ EA recompile is the bottleneck — #12a must already be live. Acceptance: mixed poll contains one mode; after EA deploy, a paper strategy's order paper-fills even when a live sibling exists.

**#13 — Wall-clock staleness guard (§3.5.1; old 11). Effort M. ⚠ calendar-aware.**
`packages/tradePipeline/src/liveRunner.ts` (`runLivePipeline` step 0, near `:423`): block with `BLOCKED_DATA_STALE_WALLCLOCK` when `Date.now() - dataClockMaxTs > 2× trigger interval` **and** the last expected tradable bar (`isTradableInstant`/`tradableBarStarts` + `DAILY_BREAKS_BY_SYMBOL`) is older than that threshold — never on weekends, daily breaks, or holiday-consistent closures. Do not reuse `evaluationTs`. Tests: frozen candles at Wednesday 14:00 → block; Saturday → no block; XAU 21:00 break → no block. Acceptance: kill ingestion on a weekday → pipeline blocks with the new reason (visible in `live_signal_rejection`), not silent stale trading.

**#14 — Backtester crash fixes (§3.1.5 + §3.2.2; old 12). Effort S.**
`scripts/backtest-pit-v2.js:747`: `(spec.setup ?? [])`. `:963`: delete the `slippagePrice`/`commissionPrice` terms (cost model intentionally stripped) — and update or delete the stale cost-contract tests (`backtest-pit-v2.test.js:294-353`). Acceptance: `backtest-pit-v2.js EURUSD 30 keylevel_bounce_v1` (progressive) runs end-to-end; `a_plus_orb_fvg_5m` (limit entries) completes; test suite green.

---

### 7.2 Tier 2 (items 15–23)

**#15 — Entry freshness / TTLs (§3.1.3 + §3.4.5; old 14). Effort M.**
Spec schema: `entry[].ttlMinutes`; compiler subtracts it from the padded lookback for entry LATERALs (mirroring the step logic `compiler.ts:509`); port the flat `structureFreshnessMinutes` block (`compiler.ts:592-600`) into `compileProgressiveSQL`; exempt entry-event features from session/weekend padding. Set sane values per spec (keylevel `structure_break` ≈ 60–120, lewis `ltf_choch` ≈ 30–60). `validate.ts`: reject unknown entry fields (incl. the no-op `dependsOn` on entries). Acceptance: compiled keylevel entry window ≈ TTL (not 63h); a Friday BOS cannot satisfy a Monday entry (weekend-window test).

**#16 — Forward-causal chaining (§3.1.4 + §3.5.6; old 13, refined — replaces the full state machine). Effort XL. Prereq: #5, #14, #15.**
Invert the CTE chain: anchor at the evaluation edge with **entry events newest**, walk backward requiring `parent.ts <= child.ts AND parent.ts >= child.ts - ttl`; each step CTE projects its match ts as the next anchor (no more dead `${id}_ts`); `signal.ts = entry ts`; `DISTINCT ON` picks order `ts DESC`; direction still enforced against the root alias. **Explicitly out of scope:** persisted setup instances / cross-evaluation state — the forward-causal chain delivers ordered progression, kills inverted causality and the §1.3 re-fire loop, and keeps live/backtest parity for free (both run the compiler). Only revisit a persisted state machine if per-stage tracking UX is later required — and then it must be implemented twice (live + PIT) to preserve parity. Tests: entry older than its zone cannot fire; zone older than its bias cannot fire (beyond TTL); same SQL in live and PIT modes. Acceptance: all progressive specs re-compiled, re-backtested, and timing-shifted as expected; `docs/progressive-migration-guide.md` updated to the new semantics.

**#17 — Lifecycle correctness bundle (§3.3.3–§3.3.7; old 15). Effort L. ⚠ changes zone eligibility → re-backtest affected families.**
(a) `refresh_zone_lifecycle`: rescan the full open set (`invalidated_at IS NULL`) each call with `IS DISTINCT FROM`, checkpoint bounds only new-zone inserts — mirror migration 146's pattern; same for sweep/structure functions (045). (b) Unify `mitigated_at`/`fill_pct`: adopt 146's contract (first touch / ≥50% mitigation / close-beyond invalidation) in **both** `packages/shared/src/lifecycle.ts` and a 117-successor migration; one owner per column. (c) Lifecycle SQL → `market.candles_1m_canonical` (117/045/052/031 successors). (d) Renumber duplicate migrations (096/097/108), restore the real `108_add_missing_feature_lifecycle.sql` bodies, make `migrationRunner.ts` fail on duplicate numeric prefixes. (e) `REFRESH_LIFECYCLE_INTERVAL_MS` default → `900000` in `scripts/refresh-lifecycle-cron.js:18` + AGENTS.md. Tests: zone breached after its first scan gets `invalidated_at` set next refresh; engine vs SQL writers produce identical lifecycle fields on a fixture. Acceptance: stale-open-zone query (§2 probe D3 variant) returns 0; re-backtested zone families recorded.

**#18 — Gates fail closed, then flip the switch (§3.5.8 + §1.6; old 16). Effort L. ⚠ block-flip LAST, after #13 + weekend trap (§3.3.10).**
`portfolioHeatGate.ts`: `corrCache` gets a TTL and is not populated on error (`:42,121,138`). `liveRunner.ts`: unknown gate name → throw at seed validation + structured rejection at runtime (`:647-649`); `evaluateSetup` throw → block, not proceed (`:784-786`); freshness batch query error → treat as stale (`:1136-1138`). `spreadGate.ts:32-34`: undefined `maxSpreadPips` → fail closed with config error. `volatilityGate.ts`: missing profile row → documented default that actually binds. Fix the weekend trap: `assertProducerFresh` age computed over tradable time (`producerRuns.ts:138-140`, `liveRunner.ts:1169,1187`). Only then set `TM_PRODUCER_STALE_ACTION=block` in the deployed env. Tests: per-gate DB-error injection → documented behavior; Monday-open simulation doesn't false-block. Acceptance: 48h in block mode with zero false blocks and at least one logged true block.

**#19 — Seed/promote hygiene (§3.4.3 + §3.4.4; old 17). Effort M.**
`check-temporal-alignment.js`: build conditions from effective specs incl. `steps[]`; `NO_DATA` on a required condition = FAIL; loop per symbol from `filters.symbols` (not hardcoded XAUUSD); registry-aware default lookbacks. `seed-strategy-specs.js`: capability gate on effective specs (`:348`); honor `experimental` → inactive; never reset `is_active` for promote-managed variants on a bare seed; add YAML↔DB drift report to `--check`. `promote-top3-live.js`: wrap in a transaction; assert `UPDATE … RETURNING` count; require a passing backtest row (post-#20 harness) for each `LIVE_VARIANTS` entry; run with seed `--check`. Acceptance: removing a YAML archives/deactivates its variant; a spec with a starving required feature fails `--check`; promote of a never-backtested variant refuses.

**#20 — Backtest honesty, single harness release + re-baseline (§3.2.3–§3.2.10; old 18). Effort L. ⚠ ship #3 + #4A inside the same release.**
Timeouts close at the last bar's close and count (`backtest-pit-v2.js:914,1100-1111`); **make the time-stop an explicit per-spec policy, not a harness accident**: immediacy-thesis specs (scalps/ORB) keep small timeouts; bracket-thesis specs (e.g. keylevel_bounce — SL/TP *is* the thesis) set timeout ≥ window (hold to SL/TP, mark-to-market at the edge); re-express `timeoutBars` in **signal-tf bars or minutes** — today it's 1m simulation bars, so `480` = 8h, an units trap for swing specs (live positions have no time exit, only pending orders expire via `expires_at`; the harness should mirror exactly that asymmetry); gap-through-bracket fills book an immediate loss at the open (`:888-890`) and exits use `min/max(open, sl/tp)` (`:910`); `outcomeTracker.ts:60-61` direction-symmetric modes + short-side tests; `backtest_runs.config_jsonb` (spec id+version+hash, mode, profile, intrabar, window) + unique key `(run_id, symbol, ts, direction)` on `backtest_results` (or delete-by-run before insert); variant API pins latest `run_id` + `heat_dropped=false` (`apps/web/.../variants/[variantId]/backtest/route.ts:24-48`); persist real `exit_ts`, real grade/confidence/session; setup-eval cache hash += setup-engine version (`:2133-2192`) and `evaluateSetupBatch` failure = fatal (`:2252-2257`); vol profile as-of (`:1402-1407`); warmup floor 200, bar-anchored (`:68,200-205`). Acceptance: regenerated `data/backtest-seed/` + a changelog note stating expected degradation; summary numbers reconcile with the API view; no duplicate rows on re-`--persist`; every spec's timeout policy is visible in its YAML and justified in one line (immediacy vs bracket).

**#21 — Data/model correctness (§3.3.8–§3.3.10 + §1.8; old 19). Effort L.**
`marketCalendar.ts::filterWeekdayCandles` → `isTradableInstant(ts, symbol)` (keep Sunday 21:00+ bars); re-backfill features whose values change around week open. `candleSource.ts:448-457`: carry `gapMinutes` through `getRecentCandles`; set a quality flag on dense features spanning gaps > N×bar; volatility gate distrusts flagged rows. `pipelineTrigger.ts`/`instrumentation.ts`: bounded catch-up anchors for missed 15m buckets after downtime; scheduler covers universe symbols without active variants; market-calendar gating for the evaluation loop (wire `TM_FEATURE_ALLOW_WEEKEND` properly). Acceptance: Sunday-evening features exist and match a manual recompute; a simulated 2h web outage self-heals its feature holes on restart.

**#22 — Migration scope decision (§2.1; old 20). Effort M (decision) + L per converted family.**
Produce the convert/retire list for the ~27 flat active variants: convert what you actually trade (candidates: `doyle_sd`, `orb_classic` — live and flat — plus the gold family you run), consciously retire the rest via the promote script (never a bare seed). Each conversion: steps + TTLs + entry TTLs per the guide, then #8's smoke test + a post-#20 backtest before activation. Acceptance: every active variant is either progressive or explicitly documented as intentionally flat.

**#23 — Kill the dead option (§3.3.5; old 21). Effort S.**
Remove `trustStoredLifecycle` from `CompileOptions` + all callers (or implement it — recommendation: remove); rewrite AGENTS.md SK-55 to describe the real `mode`-based mechanism (`stripIsFresh` + as-of validity windows). Acceptance: grep shows no remaining references except the corrected doc.

---

### 7.3 Tier 3 (items 24–28)

**#24 — Ledger retention + storm backoff (§1.7; old 22). Effort M. ⚠ burst forensics first.**
First identify the 2026-07-20 23:00–01:00 burst (peak 411k runs/h vs ~4k/h steady) — check PM2/log history for a manual backfill or a scheduler loop. Then: 14-day retention on `feature_producer_runs` (cron `DELETE` or Timescale retention policy); runner-level backoff/aggregation when a producer invariant fails repeatedly (no 5-errors/second storms); `ANALYZE` hot tables + autovacuum tuning for the insert rate. Acceptance: table size bounded; a forced invariant failure produces ≤1 error row/minute; `pg_stat` estimates track reality within ~10%.

**#25 — Forensics that survive failure (§3.5.9 + §1.4; old 23). Effort M.**
Persist decision-graph traces **after** rollback via the pool (not the doomed tx) — `liveRunner.ts:632`, `decisionGraph.ts:108-139`. Redeliver `sent`-but-unacked position commands until `completed`/expired (`positionCommandService.ts:99,261-272`) — a `CLOSE_POSITION(BAD_FILL)` must not expire undelivered. Alert when an order lacks a joinable `live_signal` (should be 0 after #10). Acceptance: a rejected order still yields a full per-gate trace; a dropped poll response still results in command delivery.

**#26 — Account-wide race + opposite-direction guard (§3.5.9; old 24). Effort M. Depends on #11.**
`risk_state` gains a `scope='account'` lock row taken before account-wide gates (`liveRunner.ts:590-597`, `smallAccountPositionManager.ts:197-249`); add an explicit opposite-side check against `activeOrders` per symbol. Acceptance: two concurrent symbol pipelines cannot jointly exceed `maxPositionsTotal`; simultaneous buy+sell on one symbol is impossible.

**#27 — TZ hygiene (§3.1.6 + §3.2.10; old 25). Effort S. ⚠ verify first.**
Log `current_setting('TimeZone')` at startup for each pool (web, engine, scripts). If UTC everywhere → add a code comment and close. If not: `SET timezone = 'UTC'` at pool connect, and pin `AT TIME ZONE 'UTC'` in the compiled casts (`compiler.ts:99,1069-1070`, `backtest-pit-v2.js:697`). Acceptance: one documented answer for "what TZ does compiled SQL see".

**#28 — Hygiene (§2.4 + §2.5 + §3.1.8; old 26). Effort S.**
Drop `features_fvg_backup` / `features_zone_clean` (confirm no readers first); fix/close the red `compiler.test.ts` root-dedup question (with #5); alert on `timescaledb_information.job_stats.total_failures` deltas. Acceptance: `pnpm db:lint-migrations` + full test suite green; scratch tables gone.

---

### 7.4 Suggested PR batching

| PR | Items | Notes |
|---|---|---|
| **PR-0 ops** | #1, #2 | No code review depth; do today. `pm2 save` at the end. |
| **PR-1 "truth pack"** | #8, #9, #10, #11, #14 | The one-liners + smoke test. Single reviewable unit; #8's fixtures prove the five historical failure classes are now caught. |
| **PR-2 staleness guards** | #13, #12a | Small but needs the market-calendar tests; #12a unblocks EA work. |
| **PR-3 compiler + variants** | #5, #6, #7 | Green compiler suite; dashboard shows truth afterwards. |
| **PR-4 backtest honesty** | #3, #4A, #20 | ⚠ ONE harness release; regenerate `data/backtest-seed/`; changelog with expected degradation. |
| **PR-5 detected_ts** | #4B | Migration + producers + registry + backfill; largest single change, independent of PR-4's harness (rebase either way). |
| **PR-6 forward-causal** | #15, #16 | The semantic change; requires full progressive re-backtest on the PR-4 harness. |
| **PR-7 lifecycle** | #17 | Includes re-backtest of zone families. |
| **PR-8 fail-closed gates** | #18 | Ends with `TM_PRODUCER_STALE_ACTION=block` in env. |
| **PR-9 seed/promote** | #19, #23 | Governance. |
| **PR-10 data/model** | #21 | Includes Sunday-session re-backfill. |
| **PR-11 scope** | #22 | Strategy decision + conversions. |
| **PR-12 hardening** | #24–#28 | Ops-grade; schedule around trading hours. |

*Audit artifacts: read-only probe suites in `temp/_probe/probe1-7.js` (re-runnable, all enforce read-only transactions); five sub-audit logs retained in the session task store. Nothing in the DB or repo was modified except this report and the probe scripts.*
