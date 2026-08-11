# DB-INDEX-03 — EXPLAIN + query-text evidence — 2026-08-05

Strictly read-only phase (`BEGIN READ ONLY` … `ROLLBACK`, `EXPLAIN` without
ANALYZE). Supersedes the speculative rows in `index-deep-dive-2026-08-05.md`.

## Method

1. Code-grep: map every query text touching `feature_producer_runs`,
   `feature_cache`, `features_zone_retest`, `features_moving_average`,
   `market_levels*`.
2. `EXPLAIN` (planner-only, read-only txn) on the exact query shapes found.

## Evidence table

| # | Query (source) | Planner choice | Candidate index verdict |
|---|---|---|---|
| Q1 | `assertProducerFresh` (`producerRuns.ts:117`): `WHERE symbol,feature_table[,tf,producer] ORDER BY COALESCE(finished_at,started_at) DESC, run_id DESC LIMIT 1` | `idx_fpr_sfts` — Index Cond `(symbol, feature_table, tf)` | **KEEP.** Live gate reader. Reshape candidate only: key is `(symbol,feature_table,tf,status,finished_at DESC)`; the 5th column can't serve the `COALESCE` ORDER BY (sort still applied on top). Narrower `(symbol,feature_table,tf,status)` would serve both Q1/Q1b identically and shrink 2.55 GB. Q1b's `status='done'` is a full key match. |
| Q2 | `FeatureCache.get` (`dag/cache.ts:107`): `WHERE feature_name, input_hash, lineage_state='trusted_current', output_jsonb IS NOT NULL` | `idx_feature_cache_trusted` (partial, **0 MB**) | `idx_feature_cache_lookup` (359.8 MB) = **SAFE DROP**: exact key-prefix duplicate of `feature_cache_pkey` (359.8 MB), wider predicate, planner never picks it (0 scans, two smaller same-key alternatives). `idx_feature_cache_created` (61.3 MB, 0 scans): **SAFE DROP pending grep** — no ORDER BY created_at found in code; confirm no ops script uses it before proposal. |
| Q3 | `analyzeSnapshot.ts:181`: `WHERE symbol, tf ORDER BY ts DESC LIMIT 10` | `idx_features_zone_retest_lookup` (121.3 MB) | `idx_features_zone_retest_pit` (635.7 MB) = **SAFE DROP**: key-prefix duplicate of `_lookup`, extra INCLUDE columns never needed by the only code reader (columns wick/close/direction are heap-fetched anyway; LIMIT 10 makes INCLUDE pointless). 0 scans + never picked. |
| Q4 | MA symbol-prefix: `WHERE symbol, tf ORDER BY ts DESC` | `idx_features_moving_average_symbol` (84.6 MB) | **NOT redundant — KEEP.** Planner prefers it over `cross_lookup` for symbol+tf-only scans (smaller key = cheaper). Redundant-prefix hypothesis refuted for this table; check remaining 7 prefix candidates individually with same method before any proposal. |
| Q4b | MA full-key (ma_type+periods) | `idx_features_moving_average_cross_lookup` | Keep. |

## Legacy table (no EXPLAIN needed)

- `market_levels_legacy_20260802` — grep for `market_levels_legacy|legacy_20260802`
  across repo: **0 code references**. Live reads use `market_levels_view`
  (levels package). 22.68M rows, 4.97 GB indexes + heap.
- **Data-retention decision, not index work**: archive dump (optional) +
  `DROP TABLE`. Yields ~4.97 GB indexes + heap, and removes the table from
  every future index audit.

## Revised quantified upside

| Bucket | Size | Classification |
|---|---|---|
| `market_levels_legacy_20260802` (table + indexes) | ~4.97 GB idx + heap | Retention drop (user decision) |
| `idx_features_zone_retest_pit` | 635.7 MB | SAFE DROP (EXPLAIN + 0 scans + prefix dupe) |
| `idx_feature_cache_lookup` | 359.8 MB | SAFE DROP (EXPLAIN + 0 scans + PK dupe) |
| `idx_feature_cache_created` | 61.3 MB | SAFE DROP pending ops-script grep |
| `idx_fpr_sfts` reshape (2.55 GB → ~1.5 GB est. narrower) | ~1 GB recovered | RESHAPE (optional; keep otherwise) |
| Redundant-prefix remaining 7 | ~90 MB | Needs per-index EXPLAIN (Q4 refuted the blanket hypothesis) |

**Proven safe now: ~1.06 GB** (two EXPLAIN-verified indexes).
**With retention decision: ~6 GB+.**
Previous "~9 GB" was an upper bound assuming all zero-scan candidates survived
proof — `idx_fpr_sfts` and `idx_features_moving_average_symbol` did not.

## DB-INDEX-04 proposal order (each needs explicit approval; DROP INDEX
CONCURRENTLY, one at a time, recreation DDL retained)

1. `DROP INDEX CONCURRENTLY public.idx_feature_cache_lookup;`
   — recreate: `CREATE INDEX idx_feature_cache_lookup ON public.feature_cache USING btree (feature_name, input_hash) WHERE (output_jsonb IS NOT NULL);`
2. `DROP INDEX CONCURRENTLY public.idx_features_zone_retest_pit;`
   — recreate: `CREATE INDEX idx_features_zone_retest_pit ON public.features_zone_retest USING btree (symbol, tf, ts DESC) INCLUDE (wick_into_zone, close_inside_zone, direction);`
3. (after ops grep) `DROP INDEX CONCURRENTLY public.idx_feature_cache_created;`
4. Retention decision on `market_levels_legacy_20260802` (dump → DROP TABLE).
5. (optional, low priority) `idx_fpr_sfts` reshape: new
   `(symbol,feature_table,tf,status)` CONCURRENTLY, EXPLAIN-verify, drop old.
6. Per-index EXPLAIN for remaining 7 prefix candidates.

**Excluded:** all `features_zone` serving indexes; anything on the
canonical/detector path.

## Wave-1 execution log (2026-08-05, approved by user)

- Pre-snapshot: `reports/index-drop-wave1-before.json`
  (idx_feature_cache_lookup 377,241,600 B / 0 scans;
  idx_features_zone_retest_pit 666,615,808 B / 0 scans; DB 50,591,217,331 B).
- `DROP INDEX CONCURRENTLY public.idx_feature_cache_lookup;` — 76 ms, OK.
- `DROP INDEX CONCURRENTLY public.idx_features_zone_retest_pit;` — 9 ms, OK.
- Post-checks: both absent from `pg_indexes`; DB size 49,547,466,419 B
  (**reclaimed 1,043,750,912 B ≈ 995.5 MiB**).
- Planner regression check: Q2 still picks `idx_feature_cache_trusted`;
  Q3 still picks `idx_features_zone_retest_lookup`. No plan change.
- Post-snapshot: `reports/index-drop-wave1-after.json`.
- Recreation DDL (rollback): item 1 and item 2 above.

Wave 1 COMPLETE.

## Wave-1.5 execution log (2026-08-05, approved by user)

- Evidence: `ORDER BY created_at DESC` pattern exists only in dead debug
  scripts (`scripts/debug-signals-2.cjs`, `scripts/debug-zero-signals.cjs`,
  `scripts/pipeline-investigate{9,10}.js`) which reference dropped columns
  (`variant_id`, `ts`) — already broken. No production/ops path reads
  `feature_cache.created_at`.
- Pre: 64,274,432 B / 0 scans. `reports/index-drop-wave15-before.json`.
- `DROP INDEX CONCURRENTLY public.idx_feature_cache_created;` — 24 ms, OK.
- Post: absent from pg_indexes; DB 49,556,813,491 → 49,492,547,251 B
  (**reclaimed 64,266,240 B ≈ 61.3 MiB**). Hot path unchanged
  (`idx_feature_cache_trusted`). `reports/index-drop-wave15-after.json`.
- Recreation DDL (rollback):
  `CREATE INDEX idx_feature_cache_created ON public.feature_cache USING btree (created_at DESC);`

**Running total reclaimed: ~1,108,017,152 B ≈ 1.03 GiB** (wave 1 + 1.5).

Next queued (not approved): `market_levels_legacy_20260802` table drop
(pg_dump snapshot first, ~5 GB, retention), `idx_fpr_sfts` reshape,
7 prefix candidates per-index EXPLAIN, inventory of other `*_legacy`/`*_backup`
tables. **History/raw/canonical/quarantine: never prune** — disk relief comes
from indexes + obsolete derived artifacts only.

## Prefix-candidate EXPLAINs (2026-08-05, post ML-LEGACY)

Scope correction: only 5 tables actually have pit_cover (ifvg, order_block, pricing, structure, zone). MA previously proven KEEP. True candidate set = 5, not 7 (earlier "8 candidates" conflated all features_*_symbol indexes with the pit_cover subset).

Method: EXPLAIN (FORMAT JSON) on XAUUSD/1h, two query shapes per table:
- Shape A: SELECT * WHERE symbol,tf ORDER BY ts DESC LIMIT 10 (live read shape)
- Shape B: SELECT covered-cols WHERE symbol,tf,ts<x ORDER BY ts DESC LIMIT 1 (PIT backtest shape)

| Table | Shape A planner pick | Shape B planner pick | Verdict |
|---|---|---|---|
| features_pricing | idx_features_pricing_symbol | idx_features_pricing_pit_cover (Index Only Scan, cost 0.65) | KEEP both |
| features_zone | idx_features_zone_symbol | idx_features_zone_pit_cover (IOS, 0.58) | KEEP both |
| features_ifvg | idx_features_ifvg_symbol | idx_features_ifvg_pit_cover (IOS, 0.57) | KEEP both |
| features_structure | idx_features_structure_symbol | idx_features_structure_pit_cover (IOS, 0.71) | KEEP both |
| features_order_block | idx_features_order_block_symbol | idx_features_order_block_pit_cover (IOS, 0.61) | KEEP both |

Query-text proof (why symbol indexes stay):
- liveRunner.ts:1750 pricing: SELECT position,in_ote,ote_low,ote_high � in_ote/ote_* NOT in pit_cover INCLUDE(position) ? cover cannot serve.
- contextBuilder.ts:255 + 696 (batch LATERAL): adds dynamic_ote_*,premium_discount_score,lineage_state filter � uncovered.
- contextBuilder.ts:787 structure: SELECT event_type,direction,level,ts � all covered, planner free to use pit_cover (IOS observed).
- compiler.ts:1471/1481 (PIT LATERAL): SELECT * FROM features_pricing/features_zone � star beats INCLUDE, needs heap; planner picks _symbol.
- riskCompiler.ts:197-238: zone top/bottom, ob bottom/top subselects � covered.

Conclusion: zero redundant-prefix drops. The two-index design is load-bearing: pit_cover = index-only scans for covered PIT queries; _symbol = smaller key for SELECT * / uncovered-column live reads. Blanket prefix hypothesis refuted 6/6 (MA + these 5). Remaining symbol indexes (atr 176.9MB etc.) have NO pit_cover sibling � not prefix candidates, out of scope.
