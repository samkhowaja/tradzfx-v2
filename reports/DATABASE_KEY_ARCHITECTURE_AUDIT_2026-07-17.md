# Database PK/FK Architecture Audit — 2026-07-17

## Scope

Read-only audit of PostgreSQL primary keys, foreign keys, unique constraints, index storage, FK index coverage, and TimescaleDB key multiplication. No schema or data changes made.

## Executive findings

- Public-table heap: **20 GB**.
- Public-table indexes: **9,827 MB**.
- PK indexes: **2,820 MB**, or **28.7%** of index storage.
- PK/FK constraints are not collectively larger than useful data. All indexes equal about 48% of heap storage; PK indexes equal about 14% of heap storage.
- Largest avoidable cost is not FKs. It is duplicated/overlapping secondary indexes, mutable event-table lifecycle indexes, and several wide natural identities.
- FKs store no hidden copy of parent rows. Referencing columns are normal row data; FK enforcement adds checks. PostgreSQL does not automatically index referencing columns.
- 14 FKs exist. Nine have left-prefix supporting indexes; five do not. Missing indexes are currently on empty/tiny analysis/deployment snapshot tables, so immediate performance risk is low.
- `candles_1m` is only application hypertable: 26 chunks, 98 MB table bytes, 145 MB index bytes, 268 MB total. Its indexes exceed heap because every chunk carries local indexes, but absolute cost is modest.
- Repeated `(symbol, tf, ts)` values in event tables are not duplicates. Full logical identity must include legitimate event discriminator/lineage.

## Largest index consumers

| Table | Heap | Indexes | Index/heap | Main concern |
|---|---:|---:|---:|---|
| `market_levels` | 14 GB | 4,969 MB | 34.8% | 3,057 MB unique `level_hash`, 1,036 MB UUID PK, several unused secondary indexes |
| `features_zone_retest` | 1,172 MB | 1,020 MB | 87.0% | Wide six-column PK plus two large query indexes |
| `zone_outcomes` | 1,241 MB | 703 MB | 56.7% | BIGINT PK plus 451 MB wide logical unique key and 102 MB lookup index |
| `features_atr` | 831 MB | 539 MB | 64.8% | 379 MB natural PK plus 159 MB secondary index |
| `features_zone` | 171 MB | 431 MB | 252.5% | Seven-column PK plus eleven secondary indexes; lifecycle update amplification |
| `features_moving_average` | 322 MB | 398 MB | 123.5% | Seven-column PK plus lookup/cross indexes |
| `features_ifvg` | 212 MB | 346 MB | 163.5% | Six-column PK plus six secondary indexes; lifecycle update amplification |
| `features_pivot` | 67 MB | 199 MB | 298.3% | 161 MB PK for 130k live rows indicates severe historical update/index churn or bloat |
| `features_indicator` | 88 MB | 185 MB | 211.3% | Five-column PK plus two similar lookup indexes |
| `features_structure` | 13 MB | 91 MB | 709.1% | Small live set, six indexes, frequent lifecycle updates |
| `features_order_block` | 8 MB | 42 MB | 525.5% | Six-column PK, eight indexes, heavy lifecycle updates |

High ratios on tiny tables are partly PostgreSQL minimum-page overhead and not operationally important. Focus on absolute bytes and write rates.

## Primary-key design assessment

### Keep

- Narrow `BIGINT` PKs: `feature_producer_runs`, `zone_outcomes`, `setup_evaluations`, backtest tables.
- UUID PKs where IDs cross process/API boundaries: analysis/live entities and `market_levels` unless workload proves sequential IDs necessary.
- State-coordinate keys such as `(symbol, tf)` or `(symbol, table_name, tf)` on tiny state/config tables.
- `(symbol, broker, ts)` on `candles_1m`: broker is required because multiple sources are retained. Timescale uniqueness requires partition key `ts`; current key satisfies this.
- Parameterized deterministic features such as ATR/Bollinger/Keltner may keep natural uniqueness, but index overlap should be reduced first.

### Redesign candidates

1. Event tables: `features_zone`, `features_ifvg`, `features_order_block`, `features_zone_retest`, `features_pivot`, `features_eq_liquidity`.
   - Current identity embeds floating geometry (`top`, `bottom`, `price`).
   - Geometry is unsuitable as durable identity when algorithm revisions or normalization can alter values.
   - Add narrow `event_id BIGINT GENERATED ...` or deterministic binary identity for references.
   - Preserve one unique logical identity constraint based on immutable source lineage: feature type, symbol, TF, formation timestamp, source candle range/zone lineage, direction/kind, and deterministic ordinal when multiple same-source events are valid.
   - Do not add surrogate PK while retaining every current index unchanged; that adds storage instead of saving it.

2. `feature_cache`.
   - PK payload averages about 120 bytes because `input_hash` averages 103 bytes.
   - Replace textual hash representation with fixed `bytea` digest (normally 32 bytes for SHA-256) after compatibility testing.
   - `feature_cache_pkey` and `idx_feature_cache_lookup` are same-sized and likely overlapping. Validate definitions/query plans, then retain one access path.

3. `zone_touch_events`.
   - `(zone_id, touch_ts)` PK already has `zone_id` as left prefix.
   - `idx_zone_touch_events_zone` is an exact duplicate index definition and costs **54 MB**.
   - Remove duplicate only through guarded migration after checking constraint ownership and live plans.

4. `market_levels`.
   - Biggest issue is 3,057 MB unique `level_hash`, not UUID PK alone.
   - Audit hash type/length and semantic need. Fixed binary digest can greatly reduce storage if hash is currently text.
   - Do not replace UUID PK without inspecting downstream identity/API contracts.

5. `features_pivot` and `features_session_hl`.
   - PK bytes per live row are anomalously high: about 1,303 and 1,015 bytes respectively.
   - Logical key width alone does not explain this. Likely index bloat/history from millions of updates.
   - Measure with `pgstattuple`/`pgstatindex` before redesign. Reindex can recover space without changing identity.

## Foreign-key assessment

### Covered FKs

Nine FKs have matching left-prefix indexes, including `analysis_*` run relations, live order/fill/signal relations, `orders.variant_id`, `position_commands.order_id`, and `strategy_variants.family_id`.

### Uncovered FKs

- `analysis_run.feature_snapshot_id`
- `analysis_run.strategy_snapshot_id`
- `analysis_trade.signal_id`
- `live_deployment.feature_snapshot_id`
- `live_deployment.strategy_snapshot_id`

These tables are currently empty or tiny. Adding five indexes now gives little benefit. Add indexes when row growth, parent deletion/update, or join plans justify them. `analysis_trade.signal_id` deserves first index once analysis trades become material.

## Exact duplicate indexes

Confirmed exact duplicates by key/operator/predicate expression:

- `zone_touch_events_pkey` and `idx_zone_touch_events_zone`: **54 MB each**.
- `feature_config_snapshot_content_hash_key` and `idx_feature_config_snapshot_hash`: 16 kB each.
- `strategy_settings_snapshot_content_hash_key` and `idx_strategy_settings_snapshot_hash`: 16 kB each.

Potential savings now: about **54 MB**. Small snapshot duplicates should still be removed for schema hygiene.

## TimescaleDB impact

- `candles_1m`: 26 chunks, compression enabled.
- Detailed size: 98 MB table, 145 MB indexes, 268 MB total.
- Chunk-local index multiplication is real. Four indexes per recent chunk appeared in statistics.
- Existing PK `(symbol, broker, ts)` includes time partition key and is valid for hypertable uniqueness.
- A surrogate-only unique PK would conflict with Timescale uniqueness rules unless `ts` remains included. It would not create global `id` uniqueness by itself.
- Avoid surrogate-key migration on `candles_1m`; optimize redundant chunk indexes and compression policy instead.

## Performance interpretation

Wide keys slow writes and joins through:

- More B-tree pages and cache pressure.
- More comparison work.
- More WAL during inserts and indexed updates.
- More page splits.
- Wider child FKs when natural keys are repeated.
- Timescale chunk-level replication of index structures.

Current DB shows bigger write-amplification problem than FK problem:

- `features_zone`: over 16.8 million updates and 24.4 million deletes in collected stats, with 12 indexes.
- `features_ifvg`: over 1.2 million updates, 328k deletes, seven indexes.
- `features_structure`: over 733k updates, six indexes.
- `features_order_block`: over 205k updates, eight indexes for only about 17.6k live rows.
- `features_pivot`: about 9.8 million updates for about 130k live rows.
- `features_session_hl`: about 2.0 million updates for 4,780 rows.

This supports immutable event identity plus separate current lifecycle state/history. Updating wide indexed event rows repeatedly is primary architectural waste.

## Permanent target architecture

### Event identity

- Immutable `feature_event` record with narrow internal ID.
- Deterministic logical identity derived from stable source lineage, not mutable geometry.
- Geometry stored as payload.
- Optional fixed binary identity digest for idempotent producer writes.

### Lifecycle

- `feature_event_state(event_id PK/FK, is_fresh, invalidated_at, touched_at, state_version, updated_at)` for current state.
- Optional append-only `feature_event_state_history(event_id, effective_ts, ...)` for PIT reconstruction.
- Live path reads current state; backtest reads PIT history/recomputes per documented asymmetry.
- Lifecycle updates touch narrow state indexes, not every event query index.

### Dimensions

Do not normalize short `symbol`/`tf` text solely to save a few bytes. Values average only 6 and 3 bytes. Integer dimensions add joins and migration complexity. Normalize only if measurements show repeated long text dominates a large index or strict referential governance is needed.

### Hashes

Use fixed binary digests instead of hex/text hashes in hot, large indexes. Best candidates: `market_levels.level_hash`, `feature_cache.input_hash`, snapshot content hashes. Migration needs dual-write, backfill, uniqueness verification, read cutover, then old-column/index removal.

## Rollout order

1. Install/use `pgstattuple` read-only functions and measure true leaf density/bloat on `features_pivot`, `features_session_hl`, `features_zone`, `features_ifvg`, `features_structure`, and `features_order_block`. **Blocked:** extension is not installed. `pnpm db:indexes:bloat` is ready, read-only, and fails closed rather than installing it implicitly.
2. Remove three confirmed duplicate indexes through non-blocking/guarded migrations. **Completed:** migrations 132–134 dropped only redundant non-constraint indexes with `DROP INDEX CONCURRENTLY`. Catalog preflight proved exact key/operator/predicate/expression parity and no constraint ownership. Reclaimed 56,999,936 bytes (~54.36 MiB). `pnpm db:indexes:duplicates:removed` proves all keepers remain and duplicates are absent. Full tests and all eight builds pass post-migration.
3. Capture `pg_stat_statements` for at least one normal trading week. **Blocked:** extension is absent, `shared_preload_libraries` contains only `timescaledb`, and `track_io_timing` is off. Enabling complete evidence requires approved PostgreSQL configuration plus restart, which repository operations policy forbids automation from performing. `pnpm db:indexes:workload` is read-only, never resets counters, and captures capability plus cumulative table/index statistics. 2026-07-17 provisional baseline shows `feature_cache` PK and partial lookup both heavily scanned, so neither is a safe drop. `market_levels` reports ~4.5 GB of zero-scan indexes but zero estimated live rows despite large physical storage; treat this as stale/inconsistent statistics until approved analysis refresh and statement capture, not drop evidence.
4. Consolidate overlapping secondary indexes per actual query predicates and INCLUDE columns only after step 3 provides a full-week window.
5. Convert large text hashes to fixed binary digests using dual-write migration. **Pilot additive stage completed:** migrations 135–137 added generated 32-byte SHA-256 shadow columns and concurrent unique binary indexes to both tiny snapshot tables. Existing text columns, uniqueness constraints, readers, and writers remain authoritative; PostgreSQL derives binary shadows so all writers stay consistent. Preflight found 2 feature snapshots and 22 strategy snapshots with zero malformed hashes. Post-migration read-only verification found 24/24 exact text-to-binary matches, zero null/length mismatches, exact distinct counts, both indexes valid/ready, both generated expressions correct, old text unique constraints intact, and all three ledger entries present. No read cutover or text-index removal occurred.
6. Introduce event identity/state split for one pilot table, preferably `features_order_block` because row count is manageable and index amplification is extreme.
7. Benchmark insert, lifecycle refresh, PIT query, live query, WAL, and index bytes before/after.
8. Migrate `features_ifvg` and `features_zone` only after pilot proves semantic parity.
9. Add uncovered FK indexes only when child tables gain volume or parent mutation becomes common.
10. Leave `candles_1m` natural hypertable key intact unless source model changes.

## Feature timestamp repair evidence

- Root cause: dense serializers without `ts` inherited caller wall-clock `endTs`. `DAGRunner` now anchors them to latest fetched candle; explicit event timestamps remain intact.
- Producer contracts: all 26 registered producers have explicit dense/sparse/session-scoped modes; unknown names fail closed. `features_displacement` is verified dense, while `features_pivot` remains sparse.
- Cleanup: 373,897 invalid dense rows removed transactionally from 12 affected tables after exact typed backup into `repair_audit_20260717` (368,284 initial rows plus 5,613 displacement rows). Manifest, backup, and delete counts had to match or rollback.
- Restoration: backup-derived timestamps mapped only to preceding canonical candle anchors. Exact PIT runner scheduled 102,081 anchor jobs covering 159,610 absent outputs with 500-bar context, no cache, no lifecycle, and no malformed timestamp reuse.
- Runner hardening: exact historical repairs can bypass forward-only `onEvent` gating through `skipEventGate`; repair persistence is non-batched because table-level pending anchor metadata cannot represent mixed historical anchors safely.
- Contract-valid no-output: 19 EURUSD 15m pricing anchors had only 1–19 candles since source-history start. Pricing requires 20 candles and intentionally emits no row; these warm-up anchors are excluded from actionable jobs.
- Final DB evidence: zero actionable recompute jobs; zero invalid rows across 16 dense tables; zero rows at three known polluted wall-clock timestamps; 14/14 preservation tables nonempty; audit backup retained.
- Regression evidence: root Node tests 118/118; all workspace package tests pass; engine 116/116 after direct historical event-gate regressions; all eight workspace builds pass, including Next.js production build.

## Safety constraints

- No destructive migration without backup and `TM_ALLOW_DESTRUCTIVE=1` where required.
- Use `CREATE INDEX CONCURRENTLY`/`DROP INDEX CONCURRENTLY` where PostgreSQL permits.
- Constraint-backed indexes need constraint-aware migration, not direct blind drop.
- Validate full logical identity before any deduplication.
- Preserve PIT semantics and `trustStoredLifecycle` live/backtest asymmetry.
- Run `pnpm db:seed:check`, relevant Vitest suites, `pnpm -r build`, and backtest parity before promotion.
- Binary-hash pilot validation: full root/workspace tests and all eight builds passed. `pnpm db:seed:check` remains blocked by pre-existing `keylevel_bounce*` specs missing `risk.sl`, `risk.tp`, `risk.minRR`, and `risk.timeoutBars`; no strategy spec was changed in this hash-only phase and no promotion occurred.
