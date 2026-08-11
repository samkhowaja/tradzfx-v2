# tradzfx-v2 — Comprehensive Technical, Architectural & Trading Strategy Audit

**Audit Date:** 2026-07-01  
**Auditor:** Kimi Code CLI (automated codebase analysis + institutional trading review)  
**Repository:** `c:\tradzfx-v2`  
**Commit Audited:** `26174ad` (master)  
**Scope:** Full stack — TypeScript monorepo, Next.js web app, PostgreSQL/TimescaleDB, MQL4/5 EA bridge, strategy compiler, feature engine, setup engine, live execution pipeline, risk management, backtesting, AI/ML claims, security, and code quality.

---

## 1. Executive Summary

`tradzfx-v2` is a functionally rich, production-aware algorithmic trading platform built around a **declarative YAML → SQL strategy compiler**, a **DAG-based feature engine**, and an **MT4/MT5 EA execution bridge**. The codebase demonstrates clear package boundaries, strong database-centric concurrency primitives, and a disciplined separation between feature detection, setup grading, risk compilation, and broker execution. The included test suite (129+ unit tests across packages) currently passes.

However, the platform has several **Critical** and **High** severity issues that must be addressed before it can be considered institutional-grade:

- **Critical Security:** EA ↔ server communication relies on a single shared API key with no per-terminal credentials, request signing, or replay protection. Multiple SQL-injection surfaces exist in the strategy compiler, backtest engine, and decision-trace persistence.
- **Critical Data Loss:** Migrations `075` and `077` `TRUNCATE` live orders, execution history, backtest results, and audit tables without pre-migration backups.
- **High Trading Logic:** Live order sizing is hard-capped to 0.01–0.05 lots regardless of strategy-level risk settings, making %-risk-based specs inoperative.
- **High SMC/ICT:** The liquidity-sweep detector requires a structure event *before* the sweep, which inverts the canonical ICT “inducement → sweep → CHoCH → entry” sequence and will miss high-probability reversal setups.
- **High Risk Management:** Daily-loss limits use the globally-latest terminal balance without currency conversion or terminal/account scoping; correlation/currency exposure is not managed.
- **High Concurrency:** Order status transitions use read-then-update patterns without explicit transactions or `SELECT FOR UPDATE`, creating race-condition and lost-update risk under concurrent EA callbacks.

The system is best characterized as a **well-architected V2 retail/prop-style interpretation of ICT/SMC**, not a literal institutional implementation. With focused remediation of the items above, it can become a robust live trading platform.

---

## 2. Audit Scope & Methodology

- **Static analysis:** Full file-tree review, grep-based pattern searches, direct source reads.
- **Architecture review:** Package dependency graph, service boundaries, event flow, API route inventory, configuration/secret handling.
- **Database review:** 77 migrations, schema/table relationships, indexes, constraints, query patterns, transaction integrity, backup/recovery.
- **Trading logic review:** Feature engine (`apps/engine/src/features`), strategy compiler (`packages/strategies`), setup engine (`packages/setupEngine`), levels (`packages/levels`), live pipeline (`packages/tradePipeline`), MT5 bridge (`mt5-ea/`).
- **SMC/ICT review:** Component-by-component fidelity check against institutional definitions.
- **Risk/execution review:** Position sizing, daily loss, exposure, order state machine, MT5 command/fill/close flow.
- **Security review:** Authentication, authorization, SQL injection, input validation, secret management.
- **Performance review:** Hot-path queries, caching, batching, synchronous blocking calls.
- **Test execution:** `pnpm test` (Vitest) across all packages.

---

## 3. Software Architecture Review

### 3.1 Project Structure

| Directory | Purpose | Assessment |
|---|---|---|
| `apps/engine/` | Feature-engine DAG runner | Clean feature modules; worker exists but is under-utilized. |
| `apps/web/` | Next.js 15 dashboard + API | Monolithic: hosts ingestion, feature compute, pipeline, robot strategies, SSE. |
| `packages/shared/` | Types, DB/Redis helpers, migration runner, Telegram | True shared kernel, but also contains application-level concerns. |
| `packages/strategies/` | YAML spec compiler/loader | Declarative → SQL is elegant but compiler interpolates SQL. |
| `packages/tradePipeline/` | Live execution pipeline | Decision graph + gates + order executor; well-structured. |
| `packages/setupEngine/` | Setup grading | Grade A+/A/B/C/BLOCK model with calibration tuning. |
| `packages/levels/` | Entry/SL/TP math | Pure helpers, minimal surface. |
| `packages/analyzerBacktest/` | Backtest harness | PIT SQL backtester; powerful but injection-prone. |
| `scripts/` | 80+ operational/ad-hoc scripts | Many temporary/debug scripts create clutter. |
| `infra/migrations/` | 77 SQL migrations | Generally good; two destructive migrations are dangerous. |
| `mt5-ea/` | MQL4/5 source + compiled EA | Solid bridge logic; `.ex5` binary committed. |

### 3.2 Module Separation & Coupling

**Dependency graph:**
```
apps/web
 ├─ @tm/engine        (feature computation inside web server)
 ├─ @tm/setup-engine
 ├─ @tm/shared
 ├─ @tm/strategies
 └─ @tm/trade-pipeline

apps/engine
 └─ @tm/shared

packages/trade-pipeline
 ├─ @tm/shared
 └─ @tm/setup-engine
```

**Findings:**
- `apps/web` imports `@tm/engine` and instantiates `DAGRunner` inside the web server (`apps/web/src/lib/pipelineTrigger.ts:29`). This blurs the boundary between dashboard and compute engine.
- `packages/shared` re-exports a broad surface (`packages/shared/src/index.ts:1-18`), making it easy for consumers to import application-level code.
- Circular dependencies are low; the DAG is built via explicit registration.

### 3.3 Scalability & Monolith vs Microservice

**Current state:** Monolith. The entire live trading loop runs inside the Next.js web process:
1. MT5 EA POSTs 1m bars to `/api/ingest`.
2. Web process refreshes caggs, triggers feature computation, evaluates strategies, runs gates, creates orders.
3. EA polls `/api/mt5/commands` and reports fills/closes.

**Scalability bottlenecks:**
- Synchronous cagg refresh + pipeline trigger + feature-job enqueue inside the HTTP POST (`apps/web/src/app/api/ingest/route.ts:65-228`).
- No message broker (RabbitMQ/Kafka/SQS). Queueing is implemented via PostgreSQL tables (`feature_jobs`, `pipeline_trigger_state`).
- Single-threaded Node.js; no worker threads or clustering.

**Recommendation:** Move `FeatureWorker` and live pipeline triggering out of the web request path into standalone PM2 workers. The existing `feature_jobs` and `pipeline_trigger_state` primitives already support this split.

### 3.4 Configuration, Secrets & Environment

- Sensitive values are env-driven; no hardcoded secrets in source.
- `.env.example` documents required vars: `TM_DB_PASSWORD`, `TM_MT5_API_KEY`, `TM_REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Foot-gun:** `ingest/route.ts:122-125` falls back to empty string for `TM_MT5_API_KEY`. An unconfigured server accepts any key (`"" === ""`).
- `ecosystem.config.js` and `ops/ecosystem.config.js` are nearly identical; risk of divergence.
- PM2 process name drift: `tz-web-v2` in root `ecosystem.config.js:4`, but ops scripts refer to `tm-web-v2` (`ops/monitor-v2-health.ps1:21`, `ops/restart-web-v2.ps1:35`, `ops/start-web-v2.ps1:24`). `deploy.ps1:22` references non-existent processes `tz-web-v2`, `tz-engine`, `tz-ingestion`.

### 3.5 Logging, Error Handling & Observability

- **No structured logger** (no Pino/Winston). 641 `console.*` occurrences across 140 files.
- Prefix convention exists (`[engine]`, `[liveRunner]`, `[ingest]`), but no log levels or sampling.
- Errors are frequently swallowed and converted to fallback values:
  - `packages/shared/src/utils/redis.ts:56-58` sets `connectFailed = true` and returns `null`.
  - `packages/setupEngine/src/contextBuilder.ts:148-150` returns `null` on DB error.
  - `apps/engine/src/dag/runner.ts:183-188` catches lifecycle refresh errors and logs them.
- `decision_trace` and `live_signal_rejection` tables provide good auditability.

### 3.6 SOLID / Clean Architecture Compliance

**Strengths:**
- Strategy pattern for gates (`packages/tradePipeline/src/gates/*`).
- Dependency inversion: `LiveRunOptions.createOrder` is an injected callback.
- Single Responsibility: each feature module computes one indicator/structure type.
- DAG pattern for feature dependencies.

**Weaknesses:**
- Global singletons: `globalDAG` (`apps/engine/src/dag/graph.ts:69`) and `getPool()` singleton (`packages/shared/src/utils/db.ts:9-42`) hinder testing and horizontal scaling.
- Open/Closed violation: `compiler.ts` `translatePredicate` uses a long chain of `.replace()` calls (`packages/strategies/src/compiler.ts:714-793`) that must be edited for every new feature column.
- Mixed abstraction in `apps/web/src/app/api/ingest/route.ts`: HTTP handling, data normalization, DB writes, aggregate refresh, pipeline triggering, robot strategies, SSE publishing.
- Type safety: 218 occurrences of `: any` across 69 TypeScript files.

### 3.7 Code Duplication & Dead Code

**Dead/exploratory code:**
- 12 `scripts/pipeline-investigate*.js` debugging scripts.
- 15+ `packages/analyzerBacktest/scripts/tmp_*.ts` temporary probes.
- `scripts/debug-gate.js`, `scripts/debug-waqar-sql.mjs`, `scripts/diagnose-candles.js`.
- Robot strategy code may be active or legacy (`apps/web/src/lib/robots/ninjaTurtleEmitter.ts`, `ninjaTurtleScalper.ts`, `ninjaTurtleTrailMonitor.ts`).

**Duplication:**
- API-key validation duplicated across route files (`ingest`, `ingest/work`, `mt5/commands`, `mt5/fills`, etc.).
- Two nearly identical `ecosystem.config.js` files.
- `dist/` and `.next/` build outputs are committed for every package.

---

## 4. Database Review

### 4.1 Platform & Connection

- PostgreSQL 17 + TimescaleDB extension via Docker (`infra/docker-compose.yml:4-31`).
- `pg` driver singleton pool (`packages/shared/src/utils/db.ts:9-43`).
- Default pool `max=20`, `idleTimeoutMillis=30000`, `connectionTimeoutMillis=5000`.
- Statement timeout and idle-in-transaction timeout supported via env.
- **Risk:** `db.ts` throws if `TM_DB_PASSWORD` missing, but many scripts fall back to `process.env.TM_DB_PASSWORD || undefined`, deferring failure.

### 4.2 Migration Strategy

- 77 numbered `.sql` migrations applied in filename order by `scripts/migrate.ts`.
- Custom runner tracks state in `schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)`.
- Supports `--repair` (blindly marks all files applied) and `--reconcile` (swallows already-exists errors).
- **No down migrations.**
- `scripts/lint-migrations.ts` enforces idempotency.

**Critical:**
- `075_strategy_families_and_variants.sql:44-48` truncates `strategy_specs`, `orders`, `setup_evaluations`, `backtest_results`, `backtest_runs`, `position_commands`, `decision_trace`, `live_signal_rejection`, `live_fill`, `live_order`, `live_signal`.
- `077_truncate_strategies_fresh_start.sql:6-13` additionally truncates `live_deployment`.
- These migrations delete production trade history with no backup step.

### 4.3 Schema, Tables & Relationships

**Core market data:**
- `candles_1m` hypertable (7-day chunks) with compression after 30 days.
- Continuous aggregates: `candles_5m`, `candles_15m`, `candles_1h`, `candles_4h`, `candles_1d_utc`, `candles_1d_ny`.

**Feature tables (20+):**
- Follow pattern `(symbol, tf, ts, …)` composite PK with `engine_ver` and `input_hash` versioning.
- Include structure, zones, order blocks, FVG/iFVG, liquidity pools, bias, HTF bias, pricing/OTE, session, displacement, candle patterns, indicators, MAs, correlations, spreads, etc.

**Execution & audit tables:**
- `orders` (canonical state machine), `position_commands`, `mt5_terminals`, `live_signal`, `live_order`, `live_fill`, `decision_trace`, `live_signal_rejection`.
- `orders` PK is `id TEXT`; nullable `variant_id`/`family_id` text columns added in `075`/`076` but **no FK to `strategy_variants`**.
- No `CHECK` constraints on `orders.status` despite defined state machine.
- `position_commands` FK to `orders` with `ON DELETE CASCADE`; deleting an order silently deletes pending commands.

### 4.4 Query Performance & Missing Indexes

**Existing indexes are reasonable:**
- `candles_1m` by `symbol, ts` and `ts`.
- `orders` by symbol, strategy, status, timestamp, variant/family.
- Feature tables generally have `(symbol, tf, ts DESC)`.
- Lifecycle covering indexes (`idx_*_pit_cover`) added in migration `042`.

**Performance concerns:**
- `liveRunner.ts:498-504` fetches all orders from last 24 hours into memory.
- `liveRunner.ts:758-848` runs one `SELECT MAX(ts)` per required `(feature, tf)` pair sequentially.
- `smallAccountPositionManager.ts` runs multiple sequential aggregate queries for every gate check.
- Ingest refreshes 6 caggs in parallel inside the HTTP response.

**Missing indexes:**
- Partial index on `orders(status, created_at DESC) WHERE status IN ('pending','sent','filled')`.
- Partial index on `orders(signal_fingerprint, created_at DESC) WHERE signal_fingerprint IS NOT NULL`.
- Composite index on `backtest_results(run_id, grade, outcome)`.

### 4.5 Transaction Integrity & Concurrency

**Findings:**
- Order status transitions in `apps/web/src/lib/orderService.ts` are **read-then-update** without explicit transactions or `SELECT FOR UPDATE`.
- `markCommandCompleted` (`packages/shared/src/utils/positionCommandService.ts:210-243`) is also non-atomic.
- Live signal insertion and order insertion are separate queries; crash after `createOrder` could leave orphan `orders` row.
- `apps/engine/src/dag/runner.ts:51-58` batches inserts table-by-table with no rollback on partial failure.
- Good examples exist: `scripts/import-mt5-csv.js:110-140` and `packages/analyzerBacktest/src/runBacktest.ts:208-248` use explicit transactions.

### 4.6 Backup & Recovery

- One manual dump exists: `backups/tradementor_v2_audit_baseline_20260630_122822.dump`.
- No automated `pg_dump`, WAL archiving, PITR, or tested restore procedure.
- Reliance on Docker volume `timescaledb_data`.
- **No defined RPO/RTO.**

### 4.7 Caching & Data Retention

**Three-tier cache:**
1. In-process LRU (10k entries) — `apps/engine/src/dag/cache.ts:26-50`.
2. Redis (24h TTL) — `packages/shared/src/utils/redis.ts`, optional/fail-open.
3. PostgreSQL `feature_cache.output_jsonb` — durable backing store.

**Risks:**
- Redis fail-open: outages silently increase DB load.
- No cache invalidation tied to migrations; stale outputs possible after schema changes.
- No explicit retention policy for raw `candles_1m` beyond compression; storage grows indefinitely.

---

## 5. Market Data Review

### 5.1 OHLC Generation & Ingestion

- MT5 EA POSTs 1m bars to `/api/ingest`.
- Timestamps rounded to nearest minute to prevent duplicates.
- Spread converted from points to pips using `effectiveDigits`.
- **SQL injection risk:** `ingest/route.ts:168-173` string-interpolates `cleanSymbol`, timestamps, numeric values, and especially the `broker` text into the INSERT statement. Although `cleanSymbol` is sanitized and numeric values are controlled, the `broker` field is user-supplied and only has single-quote escaping.

### 5.2 Continuous Aggregates

- 6 caggs refreshed synchronously on every ingest (`refreshCaggs` in `ingest/route.ts:65-99`).
- TimescaleDB background refresh policies also exist.
- **Risk:** cagg refresh contention can block the HTTP response and fail under load.

### 5.3 Data Validation & Gaps

- Payload schema validation is minimal (checks `symbol` and `bars` array).
- No validation of OHLC relationships (e.g., `h >= l`, `o/h/l/c` consistency).
- Weekend gaps and holiday handling are implicit via candle absence.
- Missing-candle detection is not explicit; feature freshness checks infer staleness.

### 5.4 Time Synchronization

- `candles_1d_ny` continuous aggregate for New York close.
- Session features (`features_session`) track UTC hour and session name.
- No explicit broker/server clock-drift detection beyond terminal heartbeat.

### 5.5 Broker Feeds & Spread

- EA payload `spread` is optional; many ingests will store `NULL` spread.
- `features_spread` table exists but may have no data if EA omits spread (confirmed in `docs/proposals/v2-improvements-2026-06-20.md`).
- No multi-broker feed reconciliation.

---

## 6. Algorithmic Trading Engine Review

### 6.1 Signal Generation

- YAML strategy specs are compiled into SQL signal queries by `packages/strategies/src/compiler.ts`.
- 55+ YAML specs in `packages/strategies/src/specs/`.
- Signal query uses correlated subqueries (`SELECT MAX(ts) ...`) for pricing, zones, and ATR per timeframe.
- **SQL injection risk:** `compiler.ts` interpolates feature table names, timeframes, and raw predicate strings into SQL (`packages/strategies/src/compiler.ts:72-84`, `180-188`, `251-252`, `713-793`).

### 6.2 Setup Grading

- `packages/setupEngine/src/evaluateSetup.ts` computes a weighted score:
  - trend: 0.35
  - entry: 0.30
  - risk: 0.20
  - confirmation: 0.15
- Final grade cap: A+/A/B/C/BLOCK based on thresholds.
- HTF tree cap can override confidence to BLOCK/A+/A/B/C (`evaluateSetup.ts:55-91`).
- Calibration tuning loaded per symbol/TF with fail-open behavior.

### 6.3 Position Sizing

- `computeLotSize` in `packages/tradePipeline/src/orderExecutor.ts:22-67` correctly implements %-risk sizing with pair characteristics and side asymmetry.
- **However, `buildOrderInput` (`orderExecutor.ts:108-119`) explicitly overrides `lotSize: 0.01` and `maxLot: 0.05`, then sizes by grade (0.01–0.05 lots).**
- **Impact:** Strategy-level `riskPerTradePct` and `accountBalance` are ignored in live execution. This is a deliberate small-account protection but makes the system unsuitable for any strategy expecting %-risk sizing.

### 6.4 Trade & Order Management

- Order state machine: `pending → sent → filled → closed`, with `rejected`/`expired` terminal states.
- `VALID_ORDER_TRANSITIONS` defined in `apps/web/src/lib/orderService.ts:18-29`.
- **Race condition:** status transitions are read-then-update, not atomic.
- Signal fingerprint + cooldown provide duplicate rejection.
- Partial closes, break-even, trailing stops, scaling in/out are not implemented in the server-side order model (trailing handled only for robot strategies).

### 6.5 Execution Profiles

- Quality engine supports `market`, `limit`, `market_if_close_else_limit` profiles (`packages/tradePipeline/src/qualityEngine.ts`).
- Effective RR computed from current market price (correct for pre-trade evaluation).
- Rough broker min-distance proxy: `max(spread*1.5, atr*0.1)`.

---

## 7. Smart Money Concepts (SMC) Accuracy Review

| Concept | Implementation | Assessment |
|---|---|---|
| **BOS / CHoCH / MSS** | `apps/engine/src/features/structure.ts` from swing pivots; confirmation window; volume/ATR strength; failure events. | Largely correct. CISD heuristic is pragmatic. |
| **Internal / External Structure** | Structure tagged by degree; swing pivot lookback hardcoded at 5 bars. | Acceptable but 5-bar lookback is TF-agnostic; misses larger-degree swings on higher TFs. |
| **Swing Highs / Lows** | `apps/engine/src/features/pivot.ts:13` with fixed 5-bar lookback. | Same as above. |
| **Liquidity Pools** | `apps/engine/src/features/liquidityPools.ts`: Asian/London ranges, prev day/week high/low, round numbers, EQH/EQL. | Good coverage; lacks explicit internal vs external liquidity distinction. |
| **Equal Highs / Equal Lows** | Detected in liquidity pools (`features_eq_liquidity`). | Present. |
| **Inducement / Liquidity Sweeps** | `apps/engine/src/features/sweep.ts`: wick beyond pivot with close back; requires preceding BOS/MSS/CHoCH within 10 bars. | **Incorrect sequencing.** In ICT, sweep typically *precedes* CHoCH/MSS that confirms reversal. Current filter will miss canonical inducement-sweep setups. |
| **Stop Hunts** | Not a separate feature; inferred from sweep + structure. | Missing explicit stop-hunt model. |
| **Premium / Discount Zones** | `apps/engine/src/features/pricing.ts`: impulse legs ≥1.5 ATR; OTE band 0.618–0.786. | Correct. |
| **Fair Value Gaps (FVG)** | `apps/engine/src/features/ifvg.ts`: 3-candle non-overlap; max age 50 bars. | Reasonable; max age is TF-agnostic (50m vs 200h). |
| **Inverse FVG (iFVG)** | Same module; requires ≥50% fill + 2 confirmations. | Conservative; reasonable. |
| **Mitigation Blocks** | Not explicitly implemented as a distinct feature type. | Gap. |
| **Order Blocks** | `apps/engine/src/features/orderBlock.ts`: last opposing candle within 15 bars before BOS/MSS/CHoCH; internal vs swing degree. | Standard implementation. Does not score by wick/body ratio. |
| **Breaker Blocks** | Not explicitly implemented. | Gap. |
| **Rejection Blocks** | Not explicitly implemented. | Gap. |
| **Propulsion Blocks** | Not explicitly implemented. | Gap. |
| **Volume Imbalances** | Not explicitly implemented. | Gap. |
| **Balanced Price Range** | Not explicitly implemented. | Gap. |
| **Institutional Candles** | Displacement feature exists but does not require break of structural level. | Partial. |
| **SMT Divergence** | Not explicitly implemented. | Gap. |
| **Dealing Range / Market Delivery** | `features_pricing` includes premium/discount positioning. | Partial. |

**Summary:** Core SMC building blocks (structure, OB, FVG, zones, liquidity pools, OTE) are present and mostly accurate. The sweep/structure sequencing is the most significant fidelity issue. Several advanced SMC concepts (breaker/rejection/propulsion blocks, volume imbalance, BPR, SMT divergence) are not implemented.

---

## 8. ICT Strategy Audit

| Concept | Implementation | Assessment |
|---|---|---|
| **Power of Three (PO3) / AMD** | Not an explicit feature. | Gap. |
| **Accumulation / Manipulation / Distribution** | Not explicitly modeled. | Gap. |
| **Judas Swing** | Not explicitly detected. | Gap. |
| **Kill Zones (NY / London / Asian)** | `features_session` and `features_time_of_day_edge` provide session + hour-of-day edge scoring. | Present but not full kill-zone model with expected range/volatility. |
| **Opening Range** | `features_opening_range` exists. | Present. |
| **Daily / Weekly / Monthly Bias** | `features_htf_bias` computes top-down consensus. | Present; weighting issues (see below). |
| **Draw on Liquidity** | Inferred from liquidity pools + sweep. | Partial. |
| **Consequent Encroachment** | Not explicitly implemented. | Gap. |
| **Optimal Trade Entry (OTE)** | `features_pricing`: 0.618–0.786 band. | Correct. |
| **Liquidity Voids** | Not explicitly implemented. | Gap. |
| **Macro Sessions / Session Opens** | `features_session_hl` tracks session highs/lows. | Present. |
| **Daily / Weekly / Monthly Open** | Liquidity pools include previous open levels. | Present. |
| **Silver Bullet / Turtle Soup** | Not explicit features; robot strategies may implement variants. | Gap. |

**HTF Bias Weighting Issue:**
- Weights: `1d=3.0`, `4h=2.0`, `1h=1.0`, `15m=0.5`.
- For a 15m scalp, the entry timeframe has the weakest voice.
- Evidence from proposal: `waqar_v2` (HTF bias) returned -8.0R/12.5% WR vs `waqar_v2_15m` (local bias) +8.19R/26.7% WR.
- HTF bias disagrees with local 15m bias ~50% of the time.
- `htfTreeGradeCap` can BLOCK a setup solely because parent timeframe opposes the entry direction.

**Summary:** Basic ICT concepts (OTE, kill zones, session opens, HTF bias) are implemented. Advanced ICT models (PO3/AMD, Judas, liquidity voids, silver bullet, turtle soup, SMT) are absent. The HTF bias weighting materially suppresses valid 15m setups.

---

## 9. Multi-Timeframe Analysis Review

### 9.1 Timeframe Coverage

Covered: Monthly (implicit via 1d), Weekly (implicit via 1d), Daily, H4, H1, M30, M15, M5, M1.

### 9.2 Synchronization

- `features_htf_bias` builds a top-down tree: 1D → 4H → 1H → 15M.
- `features_bias` provides local timeframe bias.
- Continuous aggregates keep HTF candles aligned with 1m source.

### 9.3 Bias Propagation & Conflict Detection

- HTF bias propagates from higher to lower timeframe via weighted consensus.
- No explicit conflict-detection metric beyond the final `state` (`READY`/`SOFT_WARN`/`BLOCK`).
- Proposal recommends adding `local_agreement` score and confidence interval.

### 9.4 Hierarchical Decision Making

- `evaluateSetup.ts` applies `htfTreeGradeCap` to downgrade/block entries that conflict with higher-TF bias.
- This is hierarchical but overly rigid; local setups in pullbacks are systematically blocked.

---

## 10. Key Levels Review

| Level Type | Implementation | Assessment |
|---|---|---|
| Previous Day High/Low | `features_liquidity_pools` + `features_eq_liquidity` | Present. |
| Previous Week High/Low | Liquidity pools | Present. |
| Previous Month High/Low | Liquidity pools | Present. |
| Daily / Weekly / Monthly Open | Liquidity pools | Present. |
| Session Highs / Lows | `features_session_hl` | Present. |
| Psychological / Round Numbers | `features_liquidity_pools` | Present. |
| Supply / Demand Zones | `features_zone` | Present with learned outcome scoring. |
| Support / Resistance | Inferred from zones/structure | Partial. |
| Institutional Levels | Order blocks, liquidity pools | Present. |

**Unified level store:** `market_levels` table (`068_market_levels.sql`) provides a typed, hashed level registry — a strong architectural addition.

---

## 11. Risk Management Review

### 11.1 Implemented Controls

- `maxPositionsPerSymbol` (default 1).
- `maxPositionsTotal` (default 1).
- `cooldownMinutes` after close (default 30).
- `maxDailyLossPct` (default 5%).
- `maxConsecutiveLosses` circuit breaker (default 3).
- Spread guard (`maxSpreadPips`).
- Volatility gate.
- Session gate.
- Rate-limit gate.
- Daily loss/win gate.
- Family-position gate.

### 11.2 Critical Risk Issues

**High — Daily loss limit uses wrong balance:**
- `getLatestTerminalBalance` (`packages/shared/src/smallAccountPositionManager.ts:97-108`) selects the single most-recently-seen terminal globally, ignoring account number, currency, or terminal assignment.
- Daily PnL sums `realized_pnl` in raw account terms without currency conversion.
- In a multi-terminal/multi-currency setup, the 5% USD limit is mathematically wrong.

**High — No portfolio correlation/currency exposure control:**
- `portfolioHeatGate.ts` limits total positions and per-symbol positions but does not prevent correlated drawdowns (e.g., EURUSD + GBPUSD + EURGBP).
- No margin usage monitoring or leverage enforcement.

**Medium — Lot sizing mismatch:**
- As noted in §6.3, live execution overrides strategy risk settings with fixed 0.01–0.05 grade lots.

**Medium — Default risk limits may be too loose:**
- 5% daily loss and 3 consecutive losses may be appropriate for some small accounts but are not configurable per strategy/account.

### 11.3 Stop-Loss / Take-Profit Logic

- SL/TP computed from structural levels (`market_levels`) via `computeStopLoss`/`computeTarget`.
- Clamped to `maxSlDistance` and fallback to ATR/fixed RR.
- `risk compiler` supports `nearest_swing_high/low`, opposing zone/OB, and `minRR` guard.

---

## 12. Execution Review

### 12.1 MT5 EA Bridge

**Strengths (`mt5-ea/tradzfxManager_v5_0_1.mq5`):**
- Auto-registration with per-account key files.
- Broker symbol resolution with suffix fallback and DXY aliases.
- Stop-level normalization for SL/TP.
- Multi-mode fill attempt: `IOC` → `FOK` → `RETURN`.
- Server-reachability watchdog cancels pending orders after 120s.
- Cloud-configurable execution (paper/live), spread guard, slippage.

**Weaknesses:**
- `g_execPaperMode` defaults to `true` (safe but easy to leave on in production).
- `TMOpenMarket` uses `res.deal` as ticket; fallback to `res.order` if `deal == 0`. On some brokers position ticket may differ.
- `TMPipSize` returns `point` for 2-digit symbols; may be incorrect for indices.
- Partial fills are not explicitly handled for limit orders.

### 12.2 Server-Side Execution Flow

1. Pipeline creates `orders` row in `pending` status.
2. EA polls `/api/mt5/commands` → server calls `markOrderSent`.
3. EA executes order and POSTs fill to `/api/mt5/fills` → `markOrderFilled`.
4. EA POSTs close to `/api/mt5/closes` → `markOrderClosed`.

**Issues:**
- `markOrderSent` is called when EA polls; if EA crashes after poll, order remains `sent` until TTL expiry.
- No retry/revert from `sent` back to `pending`.
- `markOrderFilled` read-then-update is non-atomic.
- Post-fill “bad fill” safety net queues a close command but does not verify EA execution.

### 12.3 Order Types

- Market, limit, stop supported in data model.
- Execution strategies: market, limit, market_if_close_else_limit.
- No bracket-order (OCO) or scale-in/scale-out support.

---

## 13. Performance Analysis

### 13.1 Hot-Path Bottlenecks

| Area | Location | Impact |
|---|---|---|
| Synchronous cagg refresh | `apps/web/src/app/api/ingest/route.ts:65-99` | Blocks HTTP response; fails under load. |
| Sequential feature freshness checks | `packages/tradePipeline/src/liveRunner.ts:758-848` | One query per (feature, tf). |
| HTF bias sequential queries | `apps/engine/src/features/htfBias.ts:60-151` | Multiple round-trips per symbol/TF. |
| Compiled strategy correlated subqueries | `packages/strategies/src/compiler.ts:400-406`, `472-501` | Expensive when scanning many symbols. |
| Large batch upserts | `apps/engine/src/dag/runner.ts:309-360` | Unbounded batch size can spike WAL/lock time. |
| 24h order load | `packages/tradePipeline/src/liveRunner.ts:498-504` | Loads all orders from last 24h into memory. |

### 13.2 Resource Configuration

- PM2: `max_memory_restart: 5000M`, `NODE_OPTIONS: --max-old-space-size=4096`.
- TimescaleDB: `shared_buffers=4GB`, `effective_cache_size=12GB`, `work_mem=256MB`.
- No worker threads; single-threaded Node.js event loop.

### 13.3 Caching Effectiveness

- In-process LRU + Redis + DB feature cache is a strong three-tier design.
- Redis fail-open is acceptable for resilience but increases DB load.
- No cache invalidation tied to migrations.

---

## 14. Security Assessment

### 14.1 Authentication & Authorization

**Critical:**
- EA endpoints use a single shared API key (`TM_MT5_API_KEY` / `MT5_API_KEY`).
- Key compromise grants any caller ability to create, fill, close, and command positions across all linked accounts.
- Terminal identity is resolved from unauthenticated headers (`X-Terminal-Platform`, `X-Terminal-Account`, `X-Terminal-Broker-Server`). After key auth, any caller can spoof another terminal.
- Dashboard and analytics API routes have **no authentication middleware**.

**High:**
- Heartbeat accepts balance/equity from EA body; with shared key, any terminal/attacker can overwrite another terminal’s balance record.
- Server trusts EA-reported `closePrice` and `realizedPnl` without signature or reconciliation against broker data.

### 14.2 SQL Injection

**Critical surfaces:**
1. `packages/strategies/src/compiler.ts:72-84`, `180-188`, `251-252`, `713-793` — interpolates table names, timeframes, and raw predicate strings from YAML specs into SQL.
2. `scripts/backtest-pit-v2.js:366-505` — `compilePITSQL` interpolates feature table names, timeframes, symbols, timestamps, time filters, and predicate strings.
3. `packages/tradePipeline/src/decisionGraph.ts:103-108` — `persistTrace` builds VALUES clause via string concatenation of `runId`, `symbol`, `strategyId`, `nodeId`, `nodeType`, and `reason`.
4. `apps/web/src/app/api/ingest/route.ts:168-173` — string-interpolates broker text into candle batch insert.

### 14.3 Input Validation

- EA payload validation is minimal.
- No schema validation (Zod/io-ts) observed on API routes.
- No rate limiting beyond the `rateLimitGate` for signals.

### 14.4 Secret Management

- Secrets are env-only; no hardcoded secrets found.
- `.env.local` and `apps/web/.env.production.local` are correctly protected by sensitive-file filter.
- Empty API key fallback in ingest route is a deployment foot-gun.

---

## 15. Backtesting Review

### 15.1 Point-in-Time (PIT) Backtester

- `scripts/backtest-pit-v2.js` compiles YAML specs into PIT SQL queries using lifecycle columns.
- Intrabar resolution modes: `sl_first`, `tp_first`, `random_walk`, `momentum`.
- **Issue:** Intrabar modes are deterministic simplifications; results may be overly optimistic.

### 15.2 Performance

- Proposal notes `is_band_fresh()` called ~92k times per XAUUSD run, taking ~33 seconds.
- Switching to lifecycle columns drops query to ~50 ms.
- Backtest applies gates by iterating signals in JS rather than pushing logic into SQL.

### 15.3 Robustness & Overfitting

- No automated Monte Carlo simulation observed.
- No walk-forward automation or scheduler.
- No systematic overfitting metrics (CAGR, Sharpe, Calmar, probabilistic edge).
- 31+ hand-authored YAML specs with no systematic optimization/selection loop.
- Calibration tuning uses heuristics without statistical significance checks beyond `MIN_TRADES_FOR_TUNE`.

### 15.4 Data Quality

- Historical feature rows duplicated across `tf` labels before Phase A candle-source fix (per proposal).
- Proposal recommends one-time rebuild of `features_zone`, `features_order_block`, `features_structure`, `features_ifvg`, `features_sweep` from correct per-TF candles.

---

## 16. AI/ML Review

### 16.1 Claim vs Reality

- **No ML models are present.** Grep for `tensorflow`, `pytorch`, `sklearn`, `xgboost`, `onnx` returned zero matches.
- The “AI grader” is a heuristic weighted scorecard:
  - trend 0.35
  - entry 0.30
  - risk 0.20
  - confirmation 0.15
- `ai_narratives` table stores Kimi API outputs (narrative text, cost, latency), but these appear to be descriptive, not predictive.

### 16.2 Feature Engineering

- Feature engineering is extensive (20+ feature tables).
- No drift detection, retraining pipeline, or prediction-confidence metrics.

### 16.3 Explainability & Validation

- Decision trace provides explainability at the gate level.
- No validation set, regularization, or confidence intervals for zone outcome learning (`packages/shared/src/utils/zoneOutcomes.ts:23-68`).

**Recommendation:** Either remove AI/ML claims from marketing or replace the heuristic grader with a validated model.

---

## 17. Code Quality Review

### 17.1 Readability & Naming

- Generally readable; consistent camelCase/snake_case per layer.
- Many files are long (>300 lines) and mix concerns.
- Naming drift (`tm-` vs `tz-` process names).

### 17.2 Documentation

- `AGENTS.md` provides agent conventions.
- `README.md` exists for repo and MT5 EA.
- `docs/proposals/v2-improvements-2026-06-20.md` identifies known issues (still un-remediated).
- Inline comments are decent but not exhaustive.

### 17.3 Test Coverage

- 129+ tests across packages, all passing.
- Coverage is concentrated in feature modules and trade pipeline.
- No tests for SQL injection, race conditions, or security boundaries.
- No integration tests for MT5 bridge.

### 17.4 Static Analysis & Type Safety

- TypeScript strict mode enabled.
- 218 occurrences of `: any` across 69 files.
- No ESLint visible in CI script; `eslint-config-next` present.

### 17.5 Dead Code & Build Artifacts

- `packages/*/dist/` committed.
- `apps/web/.next/` committed.
- Many temporary scripts.

---

## 18. Bugs & Defects Register

| ID | Severity | Area | Issue | Root Cause | Trading Impact | Technical Impact | Recommended Fix | Complexity |
|---|---|---|---|---|---|---|---|---|
| D001 | **Critical** | Security | Single shared API key for all EA endpoints; no per-terminal auth or signing. | Flat auth model in all `/api/mt5/*` and `/api/ingest/*` routes. | Complete account takeover if key leaks; spoofed fills/closes. | High blast radius; no auditability of which terminal acted. | Implement per-terminal API keys + HMAC request signing or mTLS; rotate keys. | High |
| D002 | **Critical** | Security | SQL injection in strategy compiler (`compiler.ts`) and backtester (`backtest-pit-v2.js`). | Table names, timeframes, and raw predicates interpolated into SQL from YAML specs. | Malicious spec can exfiltrate or destroy DB. | Data breach, data loss, unauthorized execution. | Use parameterized queries; whitelist table/feature names; parse predicates into AST before SQL generation. | High |
| D003 | **Critical** | Security | SQL injection in `decisionGraph.persistTrace`. | `symbol`, `strategyId`, `nodeId`, `reason` concatenated into VALUES clause. | Trace data corruption; potential injection via signal metadata. | Data integrity loss; possible broader injection. | Use parameterized batch insert (`unnest` or `pg-format`). | Low |
| D004 | **Critical** | Database | Migrations `075` and `077` truncate orders, audit, and strategy tables. | `TRUNCATE TABLE` statements in schema migrations. | Production trade history deleted on migration. | Irreversible data loss. | Move destructive cleanup to explicit admin scripts with pre-backup hook; never truncate in migrations. | Medium |
| D005 | **High** | Trading Logic | Live orders forced to 0.01–0.05 grade lots; risk-based sizing ignored. | `buildOrderInput` overrides `lotSize` and `maxLot` (`orderExecutor.ts:108-119`). | Strategies expecting %-risk sizing are silently under-sized; returns do not match backtests. | Backtest/live divergence; incorrect P&L expectations. | Make grade sizing optional; use `computeLotSize` when `riskPerTradePct` and `accountBalance` are provided; add `forceFixedLots` flag. | Low |
| D006 | **High** | SMC/ICT | Sweep detector requires structure *before* sweep, missing canonical inducement-sweep setups. | `hasPrecedingStructureEvent` in `sweep.ts:48-64` requires BOS/MSS/CHoCH before sweep. | Misses high-probability reversal entries where sweep precedes CHoCH. | Reduced signal count and edge. | Add `inducement_sweep` mode that allows sweep → CHoCH within N bars; or rename current feature to `post_structure_sweep`. | Medium |
| D007 | **High** | Risk | Daily loss limit uses globally-latest terminal balance without currency/account scoping. | `getLatestTerminalBalance` ignores account/currency (`smallAccountPositionManager.ts:97-108`). | Wrong risk limit applied; over- or under-trading. | Risk logic is incorrect in multi-account setups. | Scope balance to terminal/account; convert PnL to account currency or USD using rates. | Medium |
| D008 | **High** | Execution | Order status transitions are non-atomic read-then-update. | `markOrderFilled`, `markOrderClosed`, etc. query then update without transaction/lock (`orderService.ts:204-367`). | Duplicate fills, invalid state transitions, double-closes. | Data inconsistency; orphaned positions. | Wrap transitions in explicit transactions with `SELECT FOR UPDATE` or use atomic `UPDATE ... WHERE status = 'pending'`. | Medium |
| D009 | **High** | Security | Dashboard/analytics API routes have no authentication. | Missing auth middleware on `/api/dashboard/**`, `/api/analytics`, `/api/analyze/**`. | Exposure of P&L, positions, strategies to anyone with network access. | Privacy breach; possible account info leakage. | Add JWT/session auth middleware to all non-EA routes. | Medium |
| D010 | **Medium** | Architecture | Feature computation runs synchronously inside web request. | `apps/web` imports `@tm/engine` and calls `DAGRunner` in request path. | HTTP latency spikes; web server blocked by compute. | Poor scalability; request timeouts under load. | Run `FeatureWorker` as standalone PM2 process; trigger pipeline asynchronously. | High |
| D011 | **Medium** | Database | Synchronous cagg refresh on every ingest blocks response. | `refreshCaggs` awaited inside `POST /api/ingest`. | Ingest latency; potential EA timeout/retry storms. | Unpredictable response times; lock contention. | Move cagg refresh to TimescaleDB policy or background job with locking. | Medium |
| D012 | **Medium** | Security | Ingest route string-interpolates broker text into SQL. | `ingest/route.ts:168-173` builds VALUES clause with broker string. | SQL injection via broker field in EA payload. | Data integrity; possible injection. | Use parameterized batch insert (`unnest` arrays). | Low |
| D013 | **Medium** | SMC | Entry grader filters zones to `!tapped`, excluding valid retest setups. | `entryQuality.ts:33` filters out tapped zones. | Misses retest entries after first touch. | Fewer valid entries. | Allow mitigated-but-not-invalidated zones with lower weight; add retest flag. | Low |
| D014 | **Medium** | Database | No retention policy for raw `candles_1m` beyond compression. | Missing TimescaleDB retention policy. | Storage grows indefinitely. | Cost and query slowdown over time. | Add retention policy dropping chunks older than N years. | Low |
| D015 | **Medium** | Risk | No portfolio correlation or currency exposure control. | `portfolioHeatGate` only counts positions. | Correlated drawdowns not limited. | Higher tail risk. | Add correlation matrix gate and currency exposure caps. | High |
| D016 | **Medium** | Performance | HTF bias uses sequential per-TF queries. | `htfBias.ts:60-151` loops timeframes and issues queries. | Slow feature computation. | CPU/DB load. | Batch queries or pre-aggregate parent-TF signals. | Medium |
| D017 | **Medium** | Code Quality | 218 `: any` types across 69 files. | Gradual typing debt. | Runtime errors not caught at compile time. | Reduced maintainability. | Incrementally replace `any` with strict types. | Medium |
| D018 | **Low** | Ops | PM2 process naming drift (`tz-web-v2` vs `tm-web-v2`). | Inconsistent naming across config and scripts. | Deployment/monitoring confusion. | Operational errors. | Align all references to single naming convention. | Low |
| D019 | **Low** | Build | `dist/` and `.next/` committed. | Build artifacts not gitignored. | Merge conflicts; stale binaries. | Repository bloat. | Add to `.gitignore`; build in CI/deploy. | Low |
| D020 | **Low** | SMC | Fixed 5-bar pivot lookback across all timeframes. | `pivot.ts:13` hardcodes `lookback=5`. | Misses larger swings on higher TFs. | Inconsistent structure detection. | Make lookback TF-dependent or configurable. | Low |

---

## 19. Logical Errors

1. **Sweep sequencing inversion** (D006): Requiring structure before sweep contradicts standard ICT order of operations.
2. **Lot sizing override** (D005): `computeLotSize` is implemented correctly but its result is never used in live execution.
3. **Empty API key fallback** (`ingest/route.ts:122-125`): Unconfigured server accepts any key.
4. **Terminal heartbeat check is global, not per-order** (`orderService.ts:124-130`): accepts orders if any terminal is online, not the assigned terminal.
5. **Signal `sent` state has no retry path** (`mt5/signals/route.ts:89`): if EA fails after poll, order expires rather than retrying.
6. **Daily PnL sums raw account terms** without currency conversion.
7. **HTF bias local timeframe suppression** gives 15m only 0.5 weight while 1d has 3.0.
8. **Repair migration mode** can mark files applied without executing SQL, silently skipping schema changes.
9. **Redis fail-open** hides outages and increases DB load without alerting.
10. **Cagg refresh awaited inside ingest** although background policies exist, creating redundant synchronous work.

---

## 20. Strategy Weaknesses

1. **Fixed micro-lot execution** makes %-risk strategies and backtests diverge.
2. **HTF bias over-ride** blocks ~50% of valid 15m setups per proposal evidence.
3. **Zone lifecycle too aggressive:** zones are tapped/mitigated on first touch, starving retest strategies (per proposal).
4. **Sweep filter misses inducement-sweep reversals**, the primary ICT entry model.
5. **No PO3/AMD, Judas, liquidity voids, SMT, breaker blocks** — limited conceptual coverage.
6. **DXY-only correlation** is a poor proxy for non-USD cross pairs (EURCAD, EURAUD, etc.).
7. **No session-specific kill-zone volatility expectations** — only session presence is checked.
8. **No news protection / economic calendar integration** beyond session gates.
9. **Hand-authored spec proliferation** (55 YAMLs) without systematic optimization increases overfitting risk.
10. **Backtest intrabar assumptions** (`sl_first`/`tp_first`/`random_walk`) may overstate edge.

---

## 21. Missing Features

1. Per-terminal API keys / HMAC signing / mTLS.
2. Authentication/authorization for dashboard and analytics routes.
3. Proper atomic order state transitions with idempotency keys.
4. Currency conversion for multi-account daily PnL and risk limits.
5. Portfolio correlation and currency exposure gates.
6. Margin usage and leverage monitoring.
7. News/economic calendar filter.
8. Monte Carlo and walk-forward automation.
9. Overfitting metrics (Sharpe, Calmar, probabilistic edge).
10. Systematic strategy optimization/variant generator.
11. Advanced SMC features: breaker blocks, rejection blocks, propulsion blocks, SMT divergence, volume imbalance, BPR.
12. Inducement-sweep detector aligned with ICT sequencing.
13. Dynamic pivot lookback by timeframe/volatility.
14. Explicit stop-hunt detection.
15. Partial close / scale-in / scale-out / OCO order support.
16. Structured logging framework (Pino/Winston) with log levels and sampling.
17. Automated database backups and tested restore procedure.
18. Retention policies for raw and feature hypertables.
19. Health endpoint and independent engine scheduler.
20. Cache invalidation tied to migrations.

---

## 22. Optimization Recommendations

1. **PIT backtest performance:** Switch `is_band_fresh()` to lifecycle columns (`mitigated_at`/`invalidated_at`) — ~660x speedup claimed.
2. **Feature engine:** Run as standalone worker; remove from web request path.
3. **Cagg refresh:** Rely on TimescaleDB policies; remove synchronous refresh from ingest.
4. **HTF bias:** Batch parent-timeframe queries; add covering indexes.
5. **Order queries:** Replace 24h full `SELECT *` with targeted indexed queries.
6. **Batch inserts:** Cap batch size and use `COPY` for large backfills.
7. **Zone lifecycle:** Update `fill_pct` incrementally and add `touch_count`/`retest_count`.
8. **Strategy compiler:** Cache compiled SQL by spec hash; parameterize predicates.
9. **Redis:** Add circuit breaker and alerting instead of silent fail-open.
10. **Monitoring:** Add `/api/health` endpoint and structured metrics.

---

## 23. Refactoring Recommendations

1. **Extract feature engine from web app** into `apps/engine` as a standalone PM2 service.
2. **Create shared auth middleware** for EA routes (per-terminal keys) and web routes (JWT/session).
3. **Replace string-built SQL** in compiler, backtester, decision trace, and ingest with parameterized queries / AST generation.
4. **Consolidate ecosystem configs** and align process names.
5. **Remove committed build artifacts** (`dist/`, `.next/`) from git.
6. **Delete or archive temporary scripts** (`pipeline-investigate*`, `tmp_*`, debug scripts).
7. **Refactor `translatePredicate`** into a proper predicate parser/AST to satisfy Open/Closed principle.
8. **Wrap order transitions** in a state-machine service with atomic updates.
9. **Introduce structured logging** and remove ad-hoc `console.*` calls.
10. **Add DB-level `CHECK` constraints** for status columns.

---

## 24. Priority Matrix

### Critical (Fix before live deployment)

| ID | Issue |
|---|---|
| D001 | Single shared EA API key |
| D002 | SQL injection in compiler/backtester |
| D003 | SQL injection in decision trace |
| D004 | Destructive data-loss migrations |
| D005 | Fixed micro-lot override ignores risk sizing |
| D006 | Sweep/structure sequencing inversion |
| D007 | Daily loss limit uses wrong balance |
| D008 | Non-atomic order state transitions |
| D009 | Unauthenticated dashboard/analytics routes |

### High

| ID | Issue |
|---|---|
| D010 | Feature computation in web request path |
| D011 | Synchronous cagg refresh in ingest |
| D012 | Ingest route SQL injection |
| D015 | No portfolio correlation/exposure control |
| HTF bias suppresses 15m setups |
| No automated backups |
| No retention policy |

### Medium

| ID | Issue |
|---|---|
| D013 | Tapped-zone filter excludes retests |
| D016 | HTF bias sequential queries |
| D017 | Widespread `any` typing |
| No structured logging |
| No ML model despite claims |
| No news filter |

### Low

| ID | Issue |
|---|---|
| D018 | PM2 naming drift |
| D019 | Committed build artifacts |
| D020 | Fixed 5-bar pivot lookback |
| Zone lifecycle fill_pct not updated |

---

## 25. Action Plan & Implementation Roadmap

### Phase 1 — Security & Safety (Weeks 1–2)

1. **Replace shared EA API key** with per-terminal keys stored in `mt5_terminals` and rotated via `/ingest/register`.
2. **Add HMAC request signing** or mTLS to EA ↔ server traffic.
3. **Authenticate dashboard/analytics routes** with JWT/session middleware.
4. **Parameterize all SQL** in `compiler.ts`, `backtest-pit-v2.js`, `decisionGraph.ts`, and `ingest/route.ts`.
5. **Make migrations `075` and `077` safe** by removing `TRUNCATE` or moving to admin script with mandatory backup.
6. **Add `CHECK` constraints** for `orders.status` and `position_commands.status`.

### Phase 2 — Execution Integrity (Weeks 2–3)

1. **Atomic order transitions:** use `BEGIN ... SELECT FOR UPDATE` or `UPDATE ... WHERE status = 'pending'` pattern.
2. **Idempotency keys** for EA fill/close requests to prevent duplicate processing.
3. **Per-terminal heartbeat check** before assigning orders.
4. **Retry path** for `sent` orders that are not filled within TTL.
5. **Re-enable risk-based sizing** while keeping an optional `forceFixedLots` safety flag.
6. **Currency-aware daily PnL** and per-terminal balance scoping.

### Phase 3 — Trading Logic Corrections (Weeks 3–4)

1. **Fix sweep sequencing** by adding `inducement_sweep` detector (sweep → CHoCH within N bars).
2. **Allow retest zones** in entry grader (mitigated-but-not-invalidated).
3. **Refine HTF bias weights** so entry timeframe is not the weakest voice.
4. **Make pivot lookback TF-dependent** or configurable.
5. **Update zone lifecycle** to separate `first_touch_at` from `mitigated_at` and update `fill_pct`.

### Phase 4 — Performance & Architecture (Weeks 4–6)

1. **Move feature engine out of web request path** into standalone PM2 worker.
2. **Independent scheduler** for engine runs every 1–5 minutes.
3. **Remove synchronous cagg refresh** from ingest; rely on policies or background job.
4. **Add `/api/health` endpoint** with candle/feature freshness.
5. **Add covering indexes** and lifecycle-column PIT predicates.
6. **Implement retention policies** for `candles_1m` and feature hypertables.

### Phase 5 — Robustness & Advanced Features (Weeks 6–8)

1. **Automated backups** (`pg_dump` + WAL archiving) and tested restore.
2. **Portfolio correlation/currency exposure gate**.
3. **News/economic calendar filter**.
4. **Monte Carlo and walk-forward automation**.
5. **Systematic strategy optimizer/variant generator**.
6. **Advanced SMC features**: breaker blocks, SMT divergence, volume imbalance.
7. **Structured logging and monitoring** (Pino + metrics endpoint).

---

## 26. Conclusion

`tradzfx-v2` is a capable, feature-rich algorithmic trading platform with a sound high-level architecture and a disciplined separation between market-data features, strategy compilation, setup grading, and broker execution. Its YAML → SQL strategy compiler and DAG-based feature engine are genuine architectural strengths, and the test suite provides a solid safety net for the implemented components.

The most urgent issues are **security** (shared API key, SQL injection, unauthenticated dashboards), **data safety** (destructive migrations, no backups), and **trading correctness** (fixed micro-lot override, sweep/structure sequencing inversion, non-atomic order transitions). Addressing these nine Critical items is mandatory before the system can responsibly trade live capital.

Once those are remediated, the platform will benefit from the medium-term improvements listed in Phase 3–5: trading-logic refinements, performance optimization, independent workers, and institutional-grade risk controls. The existing `docs/proposals/v2-improvements-2026-06-20.md` document already identifies several of the correct next steps; the priority now is execution.

**Overall grade: B** — production-aware and structurally sound, but not yet institutional-grade. With focused remediation of Critical and High issues, it can reach **B+/A-** within 4–6 weeks.
