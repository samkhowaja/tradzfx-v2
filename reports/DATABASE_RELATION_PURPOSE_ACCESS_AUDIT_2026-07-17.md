# Database Relation Purpose and Access Audit — 2026-07-17

## Scope

Read-only audit of all 79 public relations in `tradzfx_v2`: 70 tables and 9 views. Review covers purpose, producer/consumer linkage, database dependencies, access boundaries, and same-purpose overlap. No schema, data, role, or privilege changes made.

Row counts below are PostgreSQL estimates unless stated otherwise. Timescale rows live in chunks, so parent estimate/size for `candles_1m` is not its full footprint.

## Executive findings

1. **Access control is critically over-broad.** Only one login role exists: `postgres`. It is superuser, owns all 79 relations, and every observed application/maintenance connection uses it. No application roles or row-level policies exist. Component isolation is therefore absent.
2. **Three confirmed retired/residual FVG relations exist.** Runtime architecture uses `features_zone WHERE zone_kind = 'fvg'`. `features_fvg` was retired by migration 099 but exists again empty; `features_fvg_backup` remains as a deploy-window backup. Both lack legitimate runtime ownership.
3. **`features_zone_clean` is a full-schema snapshot/copy, not an independent domain.** It has exactly the same 24 columns as `features_zone`, about 44k rows, no live producer found, and no DB dependency found. It needs explicit archival metadata or removal after data reconciliation.
4. **`lifecycle_refresh_state_tf` is retired state still read by compatibility code.** Migration 117 states TF checkpoint support was removed. Current `refresh_zone_lifecycle` uses `lifecycle_refresh_state`; six stale TF rows remain. `drain-lifecycle.js` and `feature-capability.js` still conditionally read old state, creating split observability.
5. **`market_levels` is largest architectural concern: 19 GB and ~23.1M rows.** Current canonical level consumer code reads `market_levels_view`, which derives directly from feature tables—not `market_levels`. No view/function dependency from `market_levels` was found. Its 19 GB materialized copy needs producer/consumer proof before retention.
6. **`market_zone_objects` is not a direct duplicate of `features_zone`.** It is a derived object aggregation with stable buckets and counts. However, only refresh script/function references were found; core strategy/level consumers still use `market_levels_view`. It is presently an optional projection, not canonical runtime source.
7. **`zone_touch_events`, `features_zone_retest`, and `zone_outcomes` are related but semantically distinct.** They represent touch ledger, per-candle retest feature surface, and evaluated outcome facts. Consolidating rows blindly would destroy grain. Their overlapping lifecycle analytics should share one immutable zone identity and lineage contract.
8. **`orders` and `live_order` are intentionally different grains but overlap operational status.** `orders` is execution system of record. `live_order` is deployment/signal snapshot lineage. Keep both only if `live_order` remains immutable audit projection; never let it become second execution state authority.
9. **`strategy_specs` and `strategy_families`/`strategy_variants` overlap configuration ownership.** Family/variant model is used by current UI/backtest/live deployment paths. Legacy `strategy_specs` remains populated and has activation trigger. One canonical authoring model and explicit compatibility boundary are required.
10. **Six candle aggregates are intentional, not duplicates.** `candles_5m`, `candles_15m`, `candles_1h`, `candles_4h`, `candles_1d_utc`, and `candles_1d_ny` are Timescale continuous aggregates over `candles_1m`. UTC daily is canonical engine daily; NY-close daily is auxiliary export/session data.

## Access audit

### Observed state

- Login roles: only `postgres`.
- `postgres`: superuser, database creator, role creator, replication privilege.
- Relation owners: `postgres` for all 79 public relations.
- Explicit visible grants: full table privileges to `postgres` only.
- Active DB sessions: all application, maintenance, and interactive sessions use `postgres`.
- Row-level security policies: none.
- Connection attribution is weak: most application sessions have blank `application_name`.
- More than 80 idle `psql` sessions were observed, indicating connection leakage/pooling misconfiguration or accumulated investigation sessions.

### Risk

A compromised web route, ingestion process, engine process, script, or leaked connection string can currently:

- Read all strategy, signal, order, execution, and analysis data.
- Modify or truncate candles and feature history.
- Alter schema and security because connection is superuser.
- Bypass future grants and RLS.
- Disable triggers or tamper with migration history.

This is not least privilege. Relation grants cannot protect anything while every process connects as relation-owning superuser.

### Permanent role model

| Role | Required access | Must not receive |
|---|---|---|
| `tradzfx_owner` | Own schema, relations, functions; migration-only; `NOLOGIN` | Runtime credentials |
| `tradzfx_migrator` | Temporary membership in owner role during controlled deploy | Persistent app use |
| `tradzfx_ingest` | `INSERT/UPDATE/SELECT` on `candles_1m`, terminal/event ingest state; execute bounded ingest functions | Feature, strategy, backtest, or schema writes |
| `tradzfx_engine` | Read canonical candle views; write registered `features_*`, producer ledger/cache/job state | Orders, live execution, DDL, truncation |
| `tradzfx_lifecycle` | Read candles/events; update lifecycle state columns or execute security-definer lifecycle functions | Feature formation payload writes, orders, DDL |
| `tradzfx_strategy` | Read canonical candles/features/market views and strategy configuration; write candidate/decision audit only | Candle/feature mutation |
| `tradzfx_execution` | Read approved live signals/deployments; write `orders`, fills, commands, terminal state | Historical feature or strategy-definition mutation |
| `tradzfx_web_read` | Read API/dashboard projections | Direct table writes |
| `tradzfx_web_command` | Execute narrowly scoped stored procedures for activation/order acknowledgement/commands | Generic `UPDATE`, `DELETE`, `TRUNCATE`, DDL |
| `tradzfx_backtest` | Read PIT inputs; write isolated backtest run/results tables | Live execution writes |
| `tradzfx_monitor` | `SELECT` on health views and `pg_monitor` as needed | Business-table writes |

Use separate connection strings per PM2 process. Set `application_name` per component. Reassign ownership before revoking privileges. Prefer stored procedures for narrow state transitions. Do not make runtime roles members of owner role.

## Dependency map

### Views

- Candle continuous aggregates depend only on `candles_1m`.
- `market_levels_view` depends on:
  - `features_zone`
  - `features_order_block`
  - `features_ifvg`
  - `features_pivot`
  - `features_eq_liquidity`
  - `features_liquidity_pools`
- `market_zone_objects_active` depends on `market_zone_objects`.
- `pipeline_health` depends on `strategy_families`, `strategy_variants`, `pipeline_trigger_state`, and `live_signal_rejection`.

### Functions

- `refresh_zone_lifecycle`: `candles_1m`, `features_zone`, `lifecycle_refresh_state`.
- `refresh_ifvg_lifecycle`: `candles_1m`, `features_ifvg`, `lifecycle_refresh_state`.
- `refresh_order_block_lifecycle`: `candles_1m`, `features_order_block`, `lifecycle_refresh_state`.
- `refresh_structure_lifecycle`: `candles_1m`, `features_structure`, `lifecycle_refresh_state`.
- `refresh_sweep_lifecycle`: `candles_1m`, `features_sweep`, `lifecycle_refresh_state`.
- `refresh_opening_range_lifecycle`: `features_opening_range`, `lifecycle_refresh_state`.
- `refresh_zone_touch_events`: `candles_1m`, `features_zone`, `zone_touch_events`, `zone_touch_event_refresh_state`.
- `refresh_market_zone_objects`: `features_zone`, `market_zone_objects`.
- `backfill_htf_bias`: bias/HTF-bias feature domain and supporting feature relations.

### Triggers

- `strategy_specs.trg_strategy_specs_activation` executes `track_spec_activation`.
- `strategy_variants.trg_strategy_variants_activation` executes `track_spec_activation`.

## Purpose and canonical ownership matrix

### Candle and ingestion domain

| Relations | Purpose | Producer | Consumers | Status |
|---|---|---|---|---|
| `candles_1m` | Canonical broker-preserving raw M1 OHLCV | Ingest API, spool replay, controlled imports/backfills | Engine, strategy, setup, execution checks, exports, all caggs | **Canonical source** |
| `candles_5m`, `candles_15m`, `candles_1h`, `candles_4h` | Fast deterministic HTF projections | Timescale continuous aggregate | Engine, compiler, backtests, exports | **Canonical projections** |
| `candles_1d_utc` | UTC-midnight daily projection | Timescale continuous aggregate | Engine/features/coverage | **Canonical daily** |
| `candles_1d_ny` | 21:00 UTC anchored daily projection | Timescale continuous aggregate | Export/session compatibility | **Auxiliary intentional** |
| `candle_coverage`, `candle_quality` | Coverage and quality observations | Ingest/monitoring jobs | Health and audit paths | Keep; define retention and producer SLA |
| `mt5_terminals`, `processed_ea_events` | Terminal heartbeat and idempotent EA event receipt | MT5 API routes | Execution safety and replay protection | Keep; execution-owned |

Candle views are similar physically but not duplicate jobs. Their TF/boundary semantics differ.

### Feature production domain

| Relations | Purpose | Producer/owner | Status |
|---|---|---|---|
| `feature_producer_runs` | Per-producer execution ledger | DAG runner | Canonical observability; large append history needs retention/partitioning |
| `feature_jobs` | Queued/background feature work | Feature orchestration | Keep only if distinct queue still active; do not merge with producer-run ledger |
| `feature_cache` | Computation cache by feature/input hash | DAG/cache layer | Keep; cache retention and fixed binary hash recommended |
| `feature_config_snapshot` | Immutable feature configuration snapshot | Snapshot utility | Keep; config lineage |
| Registered `features_*` tables | Deterministic feature output surfaces | DAG runner and approved backfills | Canonical feature domain |

`feature_jobs`, `feature_producer_runs`, and `feature_cache` are not duplicates: intent queue, execution ledger, and reusable output cache differ. Enforce those boundaries in names, retention, and grants.

### Feature overlap findings

| Relations | Finding | Decision |
|---|---|---|
| `features_fvg`, `features_fvg_backup`, FVG rows in `features_zone` | Migration 099 retired standalone table. Strategy compiler tests prohibit standalone FVG read. Empty table reappeared, implying migration drift or script recreation. Backup is deploy artifact. | Make `features_zone(zone_kind='fvg')` sole source. Find creator of reappeared table. Reconcile backup checksum/count, export archival artifact, then guarded drop. |
| `features_zone_clean`, `features_zone` | Identical schemas. No live producer/consumer or DB dependency found for clean copy. | Classify as snapshot with manifest/expiry or retire after anti-join/checksum validation. Never run parallel production reads. |
| `features_bias`, `features_htf_bias`, `features_direction_state` | Related but different grains: local bias, cross-TF bias, and consolidated direction state. | Keep only with documented equations and DAG lineage. `features_direction_state` should be canonical consumer interface if it fully composes others; otherwise naming must expose distinctions. |
| `features_session`, `features_session_hl`, `features_opening_range`, `features_time_of_day_edge` | Same session domain, different facts/grains. | Keep separate while grains remain explicit. Consider one immutable session dimension plus specialized fact tables, not one wide nullable table. |
| `features_zone_retest`, `zone_touch_events`, `zone_outcomes` | Per-candle retest surface, immutable touch ledger, evaluated outcomes. | Do not merge grains. Link all through durable zone/event ID and define retention. |
| `features_indicator`, named indicator tables | Generic indicator storage overlaps ATR/Bollinger/Keltner/moving-average tables conceptually. | Verify registry ownership. Generic table must not store same indicator variants also persisted in named tables. Add uniqueness/contract test across registry outputs. |

### Market abstraction domain

| Relations | Purpose | Current access | Finding |
|---|---|---|---|
| `market_levels_view` | Unified live level projection over canonical feature tables | `packages/levels` entry/SL/TP consumers | **Current canonical read abstraction** |
| `market_levels` | Materialized normalized levels with hash/source JSON | No current view/function dependency found; runtime producer/consumer not proven | **19 GB orphan-risk table; highest consolidation priority** |
| `market_zone_objects` | Bucketed stable objects derived from raw zones | Refresh function/script; active view | Valid derived model, but not current core consumer source |
| `market_zone_objects_active` | Active object projection | No core consumer found | Optional projection until consumer cutover |
| `market_volatility_profile` | Small volatility regime/profile state | Setup/market context domain | Distinct purpose; keep if producer SLA exists |

Permanent choice required:

- **Option A:** Keep `market_levels_view` canonical; retire materialized `market_levels`; keep `market_zone_objects` only for explicit object-level strategies.
- **Option B:** Make materialized object/level store canonical; refresh transactionally and cut every consumer from view to store; remove redundant raw materialization.

Current evidence favors Option A because active level package reads `market_levels_view` and view derives from canonical feature facts. Do not drop `market_levels` until exact writer/reference audit, row-age analysis, and reconciliation prove no hidden external consumer.

### Strategy, analysis, and backtest domain

| Relations | Purpose | Status |
|---|---|---|
| `strategy_families`, `strategy_variants` | Current base-spec and override model | Canonical current authoring model |
| `strategy_specs` | Versioned monolithic spec model | Legacy/parallel model; resolve ownership |
| `strategy_settings_snapshot`, `feature_config_snapshot` | Immutable deployment/analysis reproducibility snapshots | Keep; content-addressed lineage |
| `analysis_run`, `analysis_signal`, `analysis_trade` | Analysis execution lineage | Distinct analysis domain; currently empty/tiny |
| `backtest_runs`, `backtest_results` | Backtest execution and trade results | Canonical backtest facts |
| `calibration_tuning`, `setup_evaluations`, `ai_narratives` | Derived optimization/evaluation/explanation artifacts | Keep with source run IDs and retention |

Do not merge analysis and backtest tables solely because both simulate trades. Their workflow and reproducibility contracts differ. Shared immutable snapshots and strategy IDs should link them.

### Live signal and execution domain

| Relations | Grain and authority | Decision |
|---|---|---|
| `strategy_signal_candidates` | Every candidate and decision-stage audit row | Keep append-only; strategy-owned |
| `decision_trace` | Gate/decision trace | Keep as detailed trace linked to candidate/signal |
| `live_signal_rejection` | Rejected live candidate/signal observation | Keep; health view depends on it |
| `live_signal` | Deployment-bound approved/attempted signal snapshot | Keep immutable except linkage fields |
| `live_order` | Deployment/signal order snapshot | Keep only as audit projection |
| `live_fill` | Fill linked to live-order snapshot | Keep audit lineage |
| `orders` | Actual execution command and lifecycle system of record | **Canonical execution authority** |
| `position_commands` | Position-management command queue | Keep; order FK-linked |
| `risk_state` | Current risk controls/state | Keep; execution-owned |

Prevent dual authority: order status, broker ticket, fill, close, and realized P&L must be authoritative in `orders`/execution facts. `live_order` may reference legacy/current order ID but must not independently drive execution state.

### Pipeline and operational state

| Relations | Purpose | Decision |
|---|---|---|
| `pipeline_trigger_state` | Trigger/checkpoint state by pipeline key | Keep; operational state |
| `pipeline_health` | Read-only health projection | Keep; monitor/web read |
| `lifecycle_refresh_state` | Canonical per-symbol/table lifecycle checkpoint | Keep |
| `lifecycle_refresh_state_tf` | Old per-TF zone checkpoint | Retire after compatibility readers removed |
| `zone_touch_event_refresh_state` | Separate checkpoint for touch ledger | Keep; separate producer and grain |
| `schema_migrations` | Migration ledger | Owner/migrator only |

## Confirmed and probable consolidation actions

### Confirmed, after guarded validation

1. Remove exact duplicate indexes already documented in PK/FK audit, including `idx_zone_touch_events_zone` duplicate of PK access path.
2. Remove compatibility reads of `lifecycle_refresh_state_tf`; then archive/drop old six-row table.
3. Prevent recreation of `features_fvg`; add schema contract test asserting absence and registry contract asserting FVG maps to `features_zone`.
4. Export and retire `features_fvg_backup` after deploy-window and checksum verification.
5. Classify `features_zone_clean` as time-limited snapshot or retire it. No permanent `_clean` production table allowed.

### Requires proof before action

1. `market_levels`: 19 GB. Determine exact writer, latest write, row-age distribution, external consumers, and parity against `market_levels_view` before archival/removal.
2. `strategy_specs`: trace all active deployments and API routes before choosing family/variant-only model.
3. `features_indicator`: compare actual `(indicator_name, params)` coverage against named feature tables.
4. `market_zone_objects`: decide whether object projection has committed consumers and SLA; otherwise treat as experiment with expiry.
5. `features_zone_retest` and `zone_outcomes`: establish retention/partitioning; do not merge semantic grains.

## Governance defects

- No machine-readable relation ownership manifest.
- Dynamic DAG persistence can write any discovered table matching runtime metadata; DB grants do not constrain producer ownership.
- Historical/debug scripts directly mutate canonical tables.
- Backup, clean, and temporary relations live in `public` beside production relations.
- Views expose canonical abstractions, but direct table reads remain possible everywhere.
- No DB role separation or application attribution.
- No retention policy for large ledgers/projections.
- Migration drift allowed retired `features_fvg` to reappear.

## Permanent target architecture

### 1. Relation contract registry

Create version-controlled registry containing for every relation:

- Domain and semantic grain.
- Canonical/derived/cache/audit/state/snapshot classification.
- Owning process and DB role.
- Allowed operations by role.
- Producer function/module.
- Approved consumers.
- Source lineage and refresh SLA.
- Retention, partitioning, archive, and deletion policy.
- PIT/live semantics.
- Replacement/deprecation state.

CI compares registry against `pg_catalog`, feature registry, migration definitions, and static SQL references. Unknown relation, missing owner, retired relation, or unapproved writer fails deployment.

### 2. Schema separation

Move relations by ownership boundary:

- `raw`: `candles_1m`, ingest ledgers.
- `market`: feature facts and canonical market projections.
- `strategy`: families, variants, snapshots, candidates, decision traces.
- `execution`: orders, fills, commands, terminals, risk state.
- `analysis`: analysis/backtest/calibration outputs.
- `ops`: producer runs, jobs, checkpoints, health.
- `archive`: explicitly retained snapshots/backups, no runtime grants.

Use compatibility views during migration. Schema alone is not security; pair it with roles.

### 3. Canonical-source enforcement

- Candle reads through shared candle-source contract.
- Level reads through one canonical level abstraction.
- FVG reads only from `features_zone` with explicit `zone_kind`.
- Execution lifecycle only through `orders` and bounded transition procedures.
- Strategy activation only through one strategy model and one activation service.
- Lifecycle producers own checkpoints; consumers never infer freshness from unrelated checkpoint tables.

### 4. Immutable events plus projections

Keep formation/touch/signal/order events immutable. Put mutable current status in narrow state tables or controlled projections. Link derived tables by stable IDs, not repeated mutable geometry. This addresses both purpose overlap and index/write amplification.

### 5. Retention and rebuildability

- Partition high-volume append tables: producer runs, candidates, touch events, outcomes, retests.
- Define retention by business need and PIT reproducibility.
- Derived projections must have reproducible refresh functions and source watermark.
- Backup tables require owner, creation migration, source checksum, expiry timestamp, and archive location.
- Never use `_clean`, `_backup`, `_old`, or `_tmp` as indefinite public production relations.

## Safe rollout order

1. Add relation contract registry and CI drift check without changing DB.
2. Set `application_name` and separate connection strings; observe one trading week.
3. Create `NOLOGIN` owner and least-privilege runtime roles. Grant before revoking.
4. Move migration ownership from `postgres`; test restore and rollback.
5. Remove old `lifecycle_refresh_state_tf` compatibility readers, then retire table.
6. Add anti-recreation contract for `features_fvg`; archive backup and clean snapshot after reconciliation.
7. Audit `market_levels` writer, external reads, age distribution, and parity. This decision yields largest storage benefit.
8. Choose canonical strategy configuration model; migrate deployment references before retiring old model.
9. Enforce execution transitions via procedures and make `orders` sole mutable authority.
10. Partition/retain high-volume ledgers; remove duplicate indexes and measure WAL/query effects.
11. Revoke superuser runtime access only after every component passes role-specific integration tests.

## Required validation gates

- Restore production backup into staging.
- Run catalog-contract and grant-contract tests.
- Run `pnpm db:seed:check`, relevant Vitest suites, `pnpm -r build`, PIT parity, and live paper-mode test.
- Verify each PM2 component starts using its own role.
- Verify forbidden writes fail.
- Verify migration role alone can alter schema.
- Compare row counts, checksums, latest timestamps, and sampled semantic parity before retiring any relation.
- Capture `pg_stat_statements`, WAL rate, lock waits, and query latency before/after.

## Conclusion

Database does contain residual and overlapping relations, but most similarly named tables represent different grains rather than true duplicates. Confirmed cleanup targets are retired FVG artifacts, `features_zone_clean`, old TF lifecycle checkpoint state, and duplicate indexes. Largest unresolved issue is `market_levels`: 19 GB despite canonical consumers reading `market_levels_view`. Highest security issue is universal `postgres` superuser access. Fix ownership and relation contracts before destructive consolidation.
