# Index deep dive — 2026-08-05 (DB-INDEX-03 groundwork, read-only)

Builds on `index-inventory-2026-08-05.{json,md}` (319 indexes, 15.75 GB, 0 exact
dupes, 8 redundant-prefix ~174 MB, 147 zero-scan).

## Evidence-quality caveat (action before any DROP)

- `pg_stat_database.stats_reset` = epoch (never manually reset); counters date
  from cluster init or a PITR. Postmaster up since **2026-08-04T08:10 UTC**.
- `idx_scan = 0` therefore means "no scans across an unknown-but-long window"
  — stronger evidence than a 29h window would give, but still not proof:
  quarterly/monthly maintenance paths could be invisible. All zero-scan
  findings below need a query-text cross-check (DB-INDEX-03 EXPLAIN capture +
  code grep) before any drop proposal.

## Where the 15.75 GB actually is

| Object | Indexes | Verdict |
|---|---|---|
| `market_levels_legacy_20260802` (22.68M rows, retired 08-02) | **4.97 GB** (level_hash_key 3.06 GB, pkey 1.04 GB, symbol_ts 418 MB, type_ts 404 MB, lookup 54 MB) | **Dead weight.** Legacy snapshot table. Real saving is DROP TABLE (subject to retention decision + dump), not index surgery. Largest single recovery in the DB. |
| `feature_producer_runs` (22.6M rows, append-heavy ledger) | **3.03 GB** (idx_fpr_sfts 2.55 GB @ 235 scans, pkey(run_id) 484 MB @ 0 scans) | **Write-amplification target.** Every producer run INSERT maintains a 5-col DESC index that is almost never read (235 scans vs millions of writes). Your [dot] payoff lives here. |
| `features_zone_retest` | idx_features_zone_retest_pit **636 MB, 0 scans** | Zero-scan; verify PIT retest queries use a different path (or none) before drop proposal. |
| `feature_cache` | lookup 360 MB + created 61.7 MB, both 0 scans | Cache reads should be hot — 0 scans suggests reads hit PK only or cache is bypassed (see SK-57 engine_ver key change; verify which index serves `buildCacheInputHash` lookups). |
| `market_levels` (live) | **not indexed in public/market** — resolves to legacy table only | Live reads of `market_levels` route elsewhere (view/rename?). Confirm before assuming the 4.8 GB was ever serving live traffic. |

Chunk multiplication is **not** a factor: only `candles_1m` and
`features_push_pull` are hypertables. The 15.75 GB is plain big tables.

## Redundant-prefix set (from inventory, unchanged)

8 candidates ~174 MB, all `features_*_symbol` covered by `*_pit_cover`.
Largest: `idx_features_moving_average_symbol` 84.6 MB (13,247 scans — the
covering index must be verified to actually absorb those scans first).

## Proposed DB-INDEX-03/04 sequence (nothing executed)

1. **EXPLAIN capture** (read-only): ingestion hot path, `assertProducerFresh`
   (the only known `feature_producer_runs` reader), `feature_cache` lookup,
   PIT joins on `features_zone/ifvg/structure/order_block`, retest queries.
2. **Code grep cross-check** for every zero-scan index ≥ 50 MB: find the
   query text that would use it; absent = drop candidate.
3. **Drop proposals, one per PR, `DROP INDEX CONCURRENTLY` + stored
   recreation DDL**, ordered by value:
   a. `idx_fpr_sfts` (2.55 GB, needs assertProducerFresh plan proof first)
   b. legacy-table decision (retention, not index work)
   c. `idx_features_zone_retest_pit` (636 MB)
   d. feature_cache pair (421 MB) — after SK-57 read-path verification
   e. redundant-prefix set (174 MB) — after scan-absorption proof
4. Post-drop: disk, write latency on producer flush, buffer hit ratio,
   EXPLAIN regression check on the captured plan set.

**Do not touch:** `features_zone` serving indexes during feature repair;
anything blocking canonical recovery or detector work.

## Numbers to quote

- Total index: 15.75 GB / 319 indexes.
- Immediately actionable overlap: ~174 MB (redundant prefix).
- Probable dead weight: ~4.97 GB (legacy table) — retention decision.
- Write-amp candidate: ~2.55 GB (`idx_fpr_sfts`, 235 scans).
- Zero-scan ≥ 50 MB, needs query-text proof: ~1.4 GB across 6 indexes.
- Upside if all confirmed: ~9 GB of the 15.75 GB.
