# tradzfx-v2 Current-State Audit

Audit date: 2026-07-04  
Auditor: Codex  
Workspace: `C:\tradzfx-v2`  
Scope: Next.js web/API, feature engine, strategy compiler/specs, live execution, MT5/MT4 bridge surfaces, PostgreSQL/TimescaleDB migrations, market data ingestion, risk controls, backtesting, tests/build.

## Executive Summary

`tradzfx-v2` is a serious and increasingly production-aware automated FX platform. The strongest parts are the modular feature engine, declarative strategy families/variants, current risk-based order sizing, explicit order state machine, EA event idempotency, PIT-oriented backtest work, and broad unit coverage across feature math and execution helpers.

The platform is not yet safe to expose beyond a trusted private network or trade meaningful live capital unattended. The highest remaining risks are:

1. Shared-key EA authentication is still fragmented and fail-open in several routes. `/api/ingest/mt5/register` returns the global API key to any caller with an account number.
2. Dashboard and strategy mutation APIs have no route-level auth. They expose P&L/positions and can mutate strategies/variants.
3. SQL generation still interpolates strategy/spec-controlled strings in the live compiler and risk compiler.
4. Candle ingestion still builds a raw `VALUES` SQL string from payload data.
5. Destructive migrations `075` and `077` still truncate live/audit/backtest tables.
6. Feature computation and live strategy evaluation still run inside the web request path on 15m boundaries.
7. Strategy mutation routes allow unvalidated overrides that can feed directly into the compiler.
8. No automated backup/PITR/restore procedure is present.

Important improvements since the older `COMPREHENSIVE_AUDIT_REPORT.md`:

1. Risk-based lot sizing is no longer unconditionally overridden by fixed micro lots. `packages/tradePipeline/src/orderExecutor.ts` now uses `% risk` sizing unless `useGradeLotSizing` is enabled or risk config is missing.
2. Sweep detection now supports an `inducement` mode for sweep followed by CHoCH/MSS confirmation, aligning better with ICT sequencing.
3. Order state transitions have been largely made atomic with guarded `UPDATE ... WHERE status IN (...) RETURNING`.
4. EA fill/close routes now have idempotency-key support.
5. The synchronous continuous-aggregate refresh inside `/api/ingest` appears removed.
6. `pnpm test` and `pnpm -r build` pass.

Overall current grade: `B / B-` for private, actively supervised paper/live experimentation; `C` for externally exposed or unattended live capital. The architecture is promising, but security and operational safety are not yet commensurate with the trading blast radius.

## Verification Performed

Commands run:

```powershell
pnpm test
pnpm -r build
```

Results:

1. `pnpm test` passed. This included the PIT SQL sanitization tests, package Vitest suites, engine feature tests, trade pipeline tests, and web idempotency tests.
2. `pnpm -r build` passed. Next.js emitted warnings for synchronous `setState` inside effects, missing hook dependencies, unused variables/imports, and use of raw `<img>`, but no build-blocking errors.

Limitations:

1. I did not run live DB `EXPLAIN ANALYZE` against production-size data.
2. I did not inspect broker-side MT5 runtime behavior beyond source-level bridge/API review.
3. I did not verify current production environment variables, network exposure, firewall rules, backups, or running PM2 processes.

## Critical Findings

### C001 - EA Authentication Is Shared-Key, Inconsistent, and Sometimes Fail-Open

Evidence:

- `apps/web/src/app/api/ingest/route.ts:77-83` falls back to `""` for `EXPECTED_API_KEY`.
- `apps/web/src/app/api/mt5/signals/route.ts:12-18`, `fills/route.ts:22-28`, `closes/route.ts:16-22`, and other MT5 routes duplicate the same global shared-key check.
- `apps/web/src/app/api/candles/export/route.ts:21-24` explicitly allows access when no key is configured.
- `apps/web/src/app/api/ingest/mt5/register/route.ts:11-65` returns the configured global API key to any caller that supplies an `accountNumber`.
- `apps/web/src/lib/positionCommandService.ts:46-75` resolves terminal identity from spoofable request headers, not from cryptographic identity.

Impact:

An attacker with network access can obtain or reuse a single global key, spoof terminal headers, poll signals/commands, report fills/closes, backfill candle data, or poison terminal state. If the global key is accidentally unset, several routes authorize empty-key calls.

Recommendation:

Make auth a shared route utility. Require non-empty server secret at startup. Replace global EA key with per-terminal credentials stored hashed in DB. Sign each EA request with HMAC over method, path, timestamp, nonce, and body. Store nonces or use a bounded replay window. Disable open registration or protect it with a bootstrap secret.

### C002 - Unauthenticated Dashboard and Strategy Mutation APIs

Evidence:

- `apps/web/src/app/api/dashboard/positions/route.ts:4` exposes filled positions without auth.
- `apps/web/src/app/api/analytics/route.ts:4` exposes performance, P&L, pair/session/day stats without auth.
- `apps/web/src/app/api/strategies/update-spec/route.ts:4-17` updates `strategy_specs` without auth.
- `apps/web/src/app/api/strategies/[familyId]/variants/route.ts:4-27` creates variants without auth.
- `apps/web/src/app/api/strategies/variants/[variantId]/route.ts:4-37` patches variant overrides and activation without auth.

Impact:

Anyone who can reach the web server can read account/performance data and mutate strategy definitions. Because active variants are loaded by `pipelineTrigger`, this can become remote strategy manipulation.

Recommendation:

Add auth middleware for every non-EA route. Treat strategy mutation routes as admin-only. Add audit logs for all strategy changes, including old/new JSON, user, timestamp, and source IP.

### C003 - Live Strategy Compiler Still Uses String-Built SQL

Evidence:

- `packages/strategies/src/compiler.ts:72-84` injects `symbol` and `spec.id` into `latestSignalSQL`.
- `packages/strategies/src/compiler.ts:141-153` injects feature table names/timeframes into LATERAL SQL.
- `packages/strategies/src/compiler.ts:194-202` injects timeframe and lookback hours.
- `packages/strategies/src/compiler.ts:553-611` injects moving-average config into joins.
- `packages/strategies/src/compiler.ts:614-693` translates raw predicate text via regex replacement and returns SQL.
- `packages/strategies/src/riskCompiler.ts` emits SQL fragments from risk expressions and strategy config.

Mitigating evidence:

- `scripts/backtest-pit-v2.test.js` now tests PIT SQL sanitization.
- Canonical YAML specs are local files and DB variants are expected to be trusted.

Impact:

The live compiler remains unsafe if strategy specs/overrides can be created through unauthenticated APIs or imported from an untrusted source. This becomes critical when combined with C002.

Recommendation:

Whitelist `feature`, `tf`, `groupBy`, risk tokens, `signalSourceConfig` values, and predicate identifiers before compilation. Replace raw predicate strings with a typed AST. Parameterize values. Make DB-loaded variants pass schema validation before activation.

### C004 - Candle Ingest Uses Raw `VALUES` SQL From Payload

Evidence:

- `apps/web/src/app/api/ingest/route.ts:123-133` builds a comma-joined SQL `VALUES` string from normalized bar values and broker text.

Impact:

Symbol is sanitized and broker quotes are escaped, but numeric OHLC/spread values are trusted as numbers after JSON parse and interpolated directly. JSON allows values to be non-finite only poorly, but TypeScript types do not enforce runtime shape. This is still an avoidable injection/data-corruption surface and can break queries with `NaN`/`Infinity` style inputs depending on parser behavior.

Recommendation:

Validate the payload with Zod or equivalent and insert with parameterized arrays/unnest or generated placeholders. Enforce `h >= max(o,c,l)`, `l <= min(o,c,h)`, finite numeric values, reasonable spread/digits, sorted timestamps, and batch-size limits.

### C005 - Destructive Migrations Remain in the Main Migration Stream

Evidence:

- `infra/migrations/075_strategy_families_and_variants.sql:44-48` truncates strategy specs, orders, setup evaluations, backtest results, live signal/order/fill/audit tables.
- `infra/migrations/077_truncate_strategies_fresh_start.sql:6-13` truncates strategy families/variants/specs, orders, backtests, live deployments, traces, rejections, and fills.

Impact:

Running migrations against a DB that has not already applied these files destroys historical trading/audit data. This is unacceptable for a trading system.

Recommendation:

Remove destructive statements from migrations. Replace with explicit admin scripts requiring a backup path, environment confirmation, and target DB printout. Add migration lint rules blocking `TRUNCATE` and broad `DROP` unless annotated and excluded from production.

## High Findings

### H001 - Feature Engine and Live Pipeline Still Run Inside Web Ingest Path

Evidence:

- `apps/web/src/app/api/ingest/route.ts:145` awaits `checkAndTriggerAllActive(cleanSymbol)`.
- `apps/web/src/lib/pipelineTrigger.ts:172-211` instantiates `DAGRunner` and computes feature runs.
- `apps/web/src/lib/pipelineTrigger.ts:403-465` runs feature engine and then strategy pipelines during the ingest-triggered path.

Impact:

On 15m boundaries, the EA ingest request can trigger feature computation, lifecycle refresh, strategy compilation/load, gate evaluation, and order creation. Latency spikes can cause EA timeouts, retry storms, duplicate ingest pressure, and poor separation of concerns.

Recommendation:

Make `/api/ingest` only validate/write candles and enqueue work. Move feature computation and strategy evaluation into `apps/engine` or a dedicated worker process. Keep `feature_jobs` and `pipeline_trigger_state` as the coordination primitives.

### H002 - Strategy Activation/Override Validation Is Too Weak

Evidence:

- `apps/web/src/lib/strategyVariantLoader.ts:15-30` deep-merges arbitrary overrides.
- `apps/web/src/lib/strategyVariantLoader.ts:64-79` builds runtime specs from DB without schema validation.
- Variant mutation routes accept `overrides`, `symbols`, `timeframes`, and `isActive` without validating allowed features, timeframes, risk expressions, or predicates.

Impact:

Bad overrides can break compilation, produce nonsensical trades, or exploit compiler interpolation. This is both a reliability issue and a security issue.

Recommendation:

Introduce a strict `StrategySpec` schema. Validate before DB write and again before activation. Add a dry-run compile endpoint that uses a read-only DB role and returns diagnostics.

### H003 - Terminal Scoping Is Improved but Not Enforced End-to-End

Evidence:

- `apps/web/src/lib/orderService.ts:93-110` checks that any terminal has heartbeated recently before live orders; it does not check an intended terminal/account.
- `apps/web/src/app/api/mt5/signals/route.ts:76-101` marks pending orders sent to the polling terminal, but `getPendingOrders` is not pre-filtered by terminal/account/symbol ownership beyond optional symbol list.
- `apps/web/src/lib/positionCommandService.ts:46-75` terminal identity is resolved from headers.

Impact:

In a multi-terminal setup, one terminal can poll or be assigned orders that should belong elsewhere if symbols overlap or headers are spoofed. Risk/P&L scoping can drift.

Recommendation:

Bind live deployments/orders to a terminal/account at creation. Filter signals by terminal identity and allowed symbols. Use per-terminal auth to make identity trustworthy.

### H004 - Backup and Recovery Are Not Institutional-Grade

Evidence:

- Docker volume is configured in `infra/docker-compose.yml`, but no automated backup/PITR job or tested restore flow is present in repo docs/scripts.
- Existing `backups/` appears manual and is excluded from commits.

Impact:

Database loss, migration mistakes, or disk corruption can erase candles, features, fills, audit traces, and backtest evidence.

Recommendation:

Define RPO/RTO. Add scheduled `pg_dump` plus WAL archiving/PITR if live capital is involved. Test restore into a clean DB monthly. Back up before migrations automatically.

### H005 - Market Data Validation Is Minimal

Evidence:

- `apps/web/src/app/api/ingest/route.ts:88-94` only checks `symbol`, `bars` array, and non-empty length.
- There is no explicit OHLC consistency validation, monotonic timestamp validation, weekend/holiday labeling, duplicate-source detection, or broker clock-drift rejection.

Impact:

Bad candles can poison features, strategy decisions, and backtests. A single malformed bar can create false sweeps, fake BOS/CHoCH, wrong ATR, and invalid stop/target distances.

Recommendation:

Add strict runtime schema validation, OHLC invariants, max batch size, max future/past timestamp tolerance, optional server-side broker clock drift checks, and dead-letter logging for rejected bars.

### H006 - Risk Controls Are Conservative but Incomplete

Evidence:

- `packages/shared/src/smallAccountPositionManager.ts` controls max positions, daily loss, cooldown, consecutive losses.
- It scopes daily P&L by `terminalKeyId` only if passed; otherwise global.
- It does not convert currencies, estimate margin, or cap currency exposure/correlation.
- `packages/tradePipeline/src/gates/portfolioHeatGate.ts` counts positions, not exposure/correlation.

Impact:

The system can still stack correlated USD exposure, over-concentrate by currency leg, or ignore cross-account/currency normalization.

Recommendation:

Add currency-leg exposure limits, account currency conversion, margin/leverage checks, pair-correlation caps, per-family risk budgets, and daily max loss based on equity/balance snapshots per terminal.

## Medium Findings

### M001 - Entry Grader Still Excludes Tapped Zones

Evidence:

- `packages/setupEngine/src/graders/entryQuality.ts:31-43` filters `zones` with `.filter((z) => !z.tapped)`.

Impact:

This blocks valid retest/mitigation entry models and can under-detect SMC continuation entries. It is conservative, but it misses real setups.

Recommendation:

Separate `first_touch`, `mitigated`, `invalidated`, `retest_count`, and `fill_pct`. Score retest zones lower than fresh zones instead of excluding all tapped zones.

### M002 - Feature Worker Processes One Job by Running Many Features

Evidence:

- `apps/engine/src/worker/featureWorker.ts:39-62` defines many default features.
- `apps/engine/src/worker/featureWorker.ts:93-103` runs `DAGRunner` with the full `requestedFeatures` default for each claimed job, even though the job has a `feature_name`.

Impact:

The queue granularity says `(symbol, tf, ts, feature_name)`, but execution recomputes a broad feature set per job. This can multiply work and make queue size misleading.

Recommendation:

Either change jobs to one `(symbol, tf, ts)` bundle or honor `job.feature_name` plus dependencies. Add job coalescing by bucket.

### M003 - Redis Fail-Open Can Hide Operational Degradation

Evidence:

- `packages/shared/src/utils/redis.ts:33-59` returns `null` permanently after first connection failure until process restart/reset.

Impact:

Redis outages silently shift load to PostgreSQL and remove compiled-strategy cache benefits. Operators may not know degradation occurred.

Recommendation:

Add backoff retry, health metric, and alerting. Do not permanently disable Redis after one startup failure.

### M004 - Build Warnings Indicate UI/Frontend Debt

Evidence:

- `pnpm -r build` passed, but Next reported React hook warnings in analytics, journal, dashboard page, signals, strategy command center, KlineChart dependencies, and unused imports/vars.

Impact:

Not trading-critical, but it points to avoidable render churn and stale-effect risk in operational dashboards.

Recommendation:

Clean warnings before treating dashboard as a high-confidence operational cockpit.

### M005 - No DB-Level State Constraints for Key Tables

Evidence:

- `orders.status` has an application state machine in `apps/web/src/lib/orderService.ts`, but the base table definition in `infra/migrations/001_schema.sql` uses plain `TEXT`.
- `position_commands.status` is also application-enforced.

Impact:

Manual SQL, bugs, or future scripts can write invalid statuses that application code does not expect.

Recommendation:

Add DB `CHECK` constraints or enums for `orders.status`, `orders.side`, `entry_type`, `trade_mode`, `position_commands.status`, and command types.

## Algorithmic and SMC/ICT Review

Strengths:

1. Feature coverage is broad: pivots, structure, sweep, zone, FVG/iFVG, order blocks, liquidity pools, bias/HTF bias, pricing/OTE, session, opening range, candle patterns, moving averages, spread, correlation.
2. Sweep logic now supports both `post_structure` and `inducement`, a meaningful improvement for ICT sequencing.
3. Risk compiler supports level-based targets/stops and minimum-RR guards.
4. Feature tests cover many SMC primitives.
5. Live execution has spread, volatility, rate limit, daily loss/win, portfolio heat, and family-position gates.

Weaknesses:

1. Tapped-zone exclusion still limits retest models.
2. Pivot/structure detection remains heuristic and may not fully separate internal vs external structure across volatility regimes.
3. DXY-style correlation is not sufficient for non-USD crosses or full currency-basket exposure.
4. There is no economic calendar/news filter.
5. There is no explicit SMT divergence, breaker/rejection/propulsion block model, balanced price range, liquidity void model, or PO3/Judas session model.
6. Spread/slippage are modeled, but live broker execution quality still depends on EA-side behavior and post-fill bad-fill closure.
7. Backtest/live divergence can still occur from bounded live lookbacks, lifecycle skip choices, latency, and route-path feature refresh timing.

Trading recommendation:

Keep live mode tiny until security, auth, backups, and validation are fixed. For strategy development, prioritize fewer, better-validated variants over many hand-authored variants. Require out-of-sample, walk-forward, Monte Carlo, and per-pair/session breakdown before promoting any family.

## Database Audit

Strengths:

1. Composite primary keys are common on feature tables.
2. Timescale hypertables/continuous aggregates are configured for candles.
3. Feature lifecycle columns and PIT indexes have been added in later migrations.
4. `feature_jobs` uses atomic `FOR UPDATE SKIP LOCKED` claiming.
5. `processed_ea_events` provides idempotency for EA callbacks.

Risks:

1. Destructive migrations remain in main migration stream.
2. No automated backups/PITR/restore evidence.
3. No retention policy for raw candles/features beyond compression.
4. DB constraints are incomplete for status/type columns.
5. Some hot paths still do sequential per-feature freshness queries in live execution.
6. Unauthenticated mutation routes can put unsafe JSON into strategy tables.
7. Migration repair mode can mark migrations applied without executing them; useful for recovery but dangerous operationally.

Recommended DB changes:

1. Add production migration guardrails and backups.
2. Add CHECK constraints/enums.
3. Add retention policies with explicit data retention requirements.
4. Use read-only DB roles for dashboard read APIs and compile/dry-run flows.
5. Add audit tables/triggers for strategy variant/spec changes.

## Market Data Audit

Strengths:

1. MT5 V1/V2 payload normalization exists.
2. Spread is converted from MT5 points to pips.
3. Symbols are normalized.
4. Higher timeframe tables/caggs exist.
5. Feature freshness gates can detect stale downstream data.

Risks:

1. Ingest payload validation is insufficient.
2. Raw SQL insert construction remains.
3. No explicit missing-candle detection/repair loop in ingest.
4. No broker clock-drift rejection.
5. No holiday/weekend session calendar.
6. No multi-broker reconciliation or outlier filtering.
7. Optional spread means some strategy/gate decisions can degrade if EA does not send it.

Recommended market-data changes:

1. Validate and parameterize ingest.
2. Add candle gap table/status and backfill queue.
3. Add outlier detection against ATR/range/spread thresholds.
4. Track broker server time vs server receive time.
5. Add economic calendar/news metadata for strategy gates.

## Architecture Audit

Strengths:

1. Monorepo package boundaries are logical.
2. Feature engine is modular and DAG-based.
3. Strategy families/variants are a good direction.
4. Execution state is explicit and auditable.
5. Tests pass across all core packages.

Weaknesses:

1. Web app is still doing ingestion, compute orchestration, strategy evaluation, and dashboard APIs.
2. Auth is duplicated across routes rather than centralized.
3. Console logging remains the main observability mechanism.
4. `packages/shared` contains both low-level helpers and application-level trading concerns.
5. Build artifacts and operational clutter exist in the tree.

Recommended architecture:

1. Keep Next.js as dashboard/API gateway only.
2. Move live engine and feature workers to dedicated services.
3. Add a durable queue or make PostgreSQL queue semantics explicit and monitored.
4. Centralize auth, validation, logging, and error envelopes.
5. Add metrics for ingest latency, feature latency, strategy latency, order lifecycle, stale features, rejected signals, and EA heartbeat status.

## Priority Remediation Plan

Phase 1 - Stop the biggest blast-radius risks:

1. Centralize auth and reject empty API keys.
2. Disable or protect `/api/ingest/mt5/register`.
3. Add auth/admin controls for all dashboard and strategy mutation APIs.
4. Parameterize `/api/ingest` candle inserts.
5. Remove `TRUNCATE` from migrations `075` and `077`.
6. Add DB backups before any migration.

Phase 2 - Make strategy mutation safe:

1. Add strict strategy schema validation.
2. Validate specs/overrides before insert/update/activation.
3. Replace predicate strings with AST or whitelist parser.
4. Add read-only dry-run compile tests for every active variant.
5. Add audit logs for all strategy changes.

Phase 3 - Decouple runtime:

1. Move feature computation out of ingest route.
2. Run engine worker independently.
3. Have ingest enqueue work and return quickly.
4. Monitor queue lag and feature freshness.

Phase 4 - Trading robustness:

1. Add currency/correlation exposure gates.
2. Add margin/leverage checks.
3. Add news calendar gating.
4. Improve zone lifecycle/retest modeling.
5. Standardize backtest/live execution assumptions.

Phase 5 - Institutional operations:

1. Automated backups and restore tests.
2. Structured logs and metrics.
3. Deployment/process-name cleanup.
4. Retention/compression policies.
5. Incident runbooks for EA disconnect, DB outage, Redis outage, and broker rejection storms.

## Final Verdict

This codebase has moved in the right direction since the older audit: several trading-logic and execution-integrity issues have been fixed or reduced. The current blockers are now mostly security, validation, operational safety, and service isolation.

The app is suitable for continued paper trading and very small supervised live testing on a private network. It is not yet suitable for unattended live capital or internet-exposed deployment. Fix auth, strategy validation, raw SQL surfaces, destructive migrations, and backup/recovery before scaling risk.
