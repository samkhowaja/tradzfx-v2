# Data Readiness Contract — formal schema & acceptance criteria — 2026-07-22

**Contract sentence:** *Nothing is ready until the manifest proves the required rows exist at the expected anchors, within the requested window, from an accepted producer version.*

Status: architecture frozen (10 refinements incorporated). No implementation started. This document is the build spec.

---

## 1. Semantic completion model (refinement 1)

Completeness is **per semantic type**, sourced from the existing `featureRegistry` contracts (`isStateFeature`/`isLevelFeature`/`isEventFeature`), extended with two flags: `session_scoped`, `multi_row`.

| semantic_kind | features | completeness metric |
|---|---|---|
| `dense` (state/distribution) | atr, bias, htf_bias, pricing, session, direction_state, indicator, volatility_normalized, time_of_day_edge, spread, correlation | `distinct_anchors / expected_tradable_anchors` over the window (calendar-aware expectation from `marketCalendar` — never 1,440×days flat) |
| `level` | zone, ifvg, order_block, liquidity_pools, eq_liquidity | Absence at an anchor is **valid** — a level is not formed every bar. Metric is **producer coverage**: `anchors_attempted / expected_tradable_anchors` (the producer demonstrably looked), plus lifecycle cursor coverage. Row count is diagnostic only. |
| `event` | structure, sweep, displacement, candle_pattern, zone_retest | Same as `level` (attempted-coverage + lifecycle cursor), event emission is sparse by design. |
| `session_scoped` | opening_range | completeness = expected `(date, session, range_minutes)` keys per tradable day present — **not** candle anchors. |
| `multi_row` | moving_average, bollinger, keltner, indicator(multi-series) | logical key = `(anchor, series_key)` (e.g. period+ma_type); completeness = distinct logical keys vs expected, never raw row count. |

Rule: no metric may be satisfiable by a proxy feature (the ATR-proxy class is abolished — §3.1).

---

## 2. Schema

### 2.1 `data_contract_versions` — what "accepted version" means (refinement 6)

```sql
CREATE TABLE data_contract_versions (
  id                       SERIAL PRIMARY KEY,
  contract_version         TEXT NOT NULL UNIQUE,      -- e.g. 'drc-1.0.0'
  engine_ver               TEXT NOT NULL,             -- engine build tag
  compiler_contract_version TEXT NOT NULL,            -- COMPILER_CONTRACT_VERSION
  feature_registry_version TEXT NOT NULL,             -- FEATURE_REGISTRY_CONTRACT_VERSION
  producer_versions        JSONB NOT NULL,            -- {feature_name: producer_version, ...}
  dep_fingerprint          TEXT NOT NULL,             -- sha256(DAG closure + producer_versions)
  candle_source_revision   TEXT NOT NULL,             -- canonical candle pipeline revision
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

A proof is only as strong as its version identity. `engine_ver` alone is insufficient because (a) producers version independently, (b) DAG shape changes semantics, (c) repaired candles change inputs with identical engine code.

### 2.2 `data_verification_runs` — immutable, window-keyed proof (refinements 3, 4, 5)

```sql
CREATE TABLE data_verification_runs (
  id                 BIGSERIAL PRIMARY KEY,
  contract_version   TEXT NOT NULL REFERENCES data_contract_versions(contract_version),
  symbol             TEXT NOT NULL,
  tf                 TEXT NOT NULL,
  feature            TEXT NOT NULL,
  semantic_kind      TEXT NOT NULL,          -- §1 enum
  window_start       TIMESTAMPTZ NOT NULL,
  window_end         TIMESTAMPTZ NOT NULL,
  expected_keys      BIGINT NOT NULL,
  actual_keys        BIGINT NOT NULL,
  distinct_anchors   BIGINT NOT NULL,
  density_ratio      NUMERIC(6,4),
  anchors_attempted  BIGINT NOT NULL DEFAULT 0,
  anchors_computed   BIGINT NOT NULL DEFAULT 0,
  anchors_persisted  BIGINT NOT NULL DEFAULT 0,
  compute_errors     BIGINT NOT NULL DEFAULT 0,
  persist_rejected   BIGINT NOT NULL DEFAULT 0,
  failed_anchor_min  TIMESTAMPTZ,
  failed_anchor_max  TIMESTAMPTZ,
  lifecycle_cursor   TIMESTAMPTZ,
  source_edge_ts     TIMESTAMPTZ NOT NULL,   -- data edge at verification time
  status             TEXT NOT NULL,          -- 'verified' | 'partial' | 'failed'
  error_detail       TEXT,
  verified_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_version, symbol, tf, feature, window_start, window_end)
);
```

Immutable — a new run per (contract, window); history is the audit trail. Nothing is ever overwritten.

### 2.3 `data_coverage_segments` — cheap incremental reads (refinement 5)

```sql
CREATE TABLE data_coverage_segments (
  symbol              TEXT NOT NULL,
  tf                  TEXT NOT NULL,
  feature             TEXT NOT NULL,
  segment_start       TIMESTAMPTZ NOT NULL,
  segment_end         TIMESTAMPTZ NOT NULL,
  contract_version    TEXT NOT NULL,
  density_ratio       NUMERIC(6,4) NOT NULL,
  status              TEXT NOT NULL,
  verification_run_id BIGINT NOT NULL REFERENCES data_verification_runs(id),
  PRIMARY KEY (symbol, tf, feature, segment_start, contract_version)
);
```

Append-only. A window verdict = coverage across the segments intersecting `[w_start, w_end]` under **one** contract version (mixing versions in one verdict is invalid).

### 2.4 `feature_producer_runs.quality_json` — explicit attempted-anchor accounting (refinement 4)

Formal keys (beyond today's rows_seen/inserted/rejected):

```json
{
  "anchors_attempted":  N,   // anchors the run was asked to cover
  "anchors_computed":   N,   // anchors whose compute returned
  "anchors_persisted":  N,   // anchors whose rows were actually written
  "compute_errors":     N,   // crashes before any persist attempt
  "persist_rejected":   N,   // rejected at write (deadlock/constraint)
  "failed_anchor_min":  ts,
  "failed_anchor_max":  ts
}
```

**Rule:** `status='error'` with `persist_rejected = 0` and `anchors_computed < anchors_attempted` ⇒ compute crash — explicitly **not** "zero damage". This is the USDJPY/USDSEK ledger anomaly made legible.

---

## 3. The verification pipeline

```
backfill/repair → flush → DB VERIFICATION (source of truth) → manifest write → gate read
```

1. **Backfill** requests `(symbol, tf, feature_closure, window)`. Skip logic is **per-feature, window-scoped**: skip anchor `ts` for feature F only if F already has a row at `(symbol, tf, ts)` within the requested window (ATR-proxy removed — `backfill-historical-features.js:124-153` is deleted, not patched). Partial recompute: request the missing feature only, compute its upstream closure **read-only**, persist **only the requested feature** — healthy upstream rows are never rewritten (SK-66 discipline) (refinement 2).
2. **Runtime counters** stream from `computePersistOutcome()` — diagnostics only.
3. **Post-flush DB verification** is the **sole source of exit status** (refinement 3): distinct anchors/keys per §1, attempted/computed/persisted/rejected from the ledger, lifecycle cursor. A hand-deleted row, a deadlock, a compute crash, or a ledger-write failure each flips the run to `failed`/`partial` regardless of what the runtime counters claimed.
4. **Exit non-zero** unless every requested (feature, tf) reaches `verified` (or explicit `--allow-partial` with the gaps named).
5. **Only then** write `data_verification_runs` + `data_coverage_segments` (refinement 10: accounting must be truthful before manifest evidence exists).

---

## 4. Lifecycle refresh contract (refinements 8, 9-partial)

1. `pg_try_advisory_lock(symbol, table)` for the whole pass; a second concurrent refresh exits `lock_not_acquired` immediately.
2. **Continuation requires progress**: loop only while (cursor advanced since last iteration) OR (pending keyspace shrank). `rows_updated > 0` alone is **not** progress (the 459,893-iteration treadmill is this rule's witness).
3. `max_iterations` (default 50) as the final safety stop, logged loudly.
4. Cursor commits per batch (crash → resume, no re-scan of completed keyspace).
5. Lifecycle refresh is a **required final stage of any research backfill** — its cursor is written to the manifest. `skipLifecycle:true` remains for live hot-path only, where scheduled maintenance owns the state.

---

## 5. Freshness formula (refinement 7)

```
maxAge(tf)      = max( producer_cadence(tf) + grace , 2 × tf_minutes )
producerLag     = dataEdge(symbol) − last_produced_ts
PASS iff        producerLag ≤ maxAge(tf)
```

- `dataEdge(symbol)` = last **expected tradable anchor** per `marketCalendar` (never raw wall clock, never naive MAX(ts) over weekends).
- `producer_cadence(tf)` = the registered write cadence (currently 15m inline for all tfs; daily job for 1d profiles).
- `grace` default 5 minutes.
- A 15m-cadence producer can never false-fail at boundary+11 min; a producer silent for `cadence + grace` always fails. The 10-min-vs-15m false-STALE race is abolished here, and belongs to this readiness dimension only — not to strategy logic.

---

## 6. Planning-gate trust predicate (refinement 9)

A manifest proof for `(symbol, tf, feature, [w_start, w_end])` is **trusted** iff ALL of:

1. ∃ `data_verification_runs` with `status='verified'` whose segments cover `[w_start, w_end]` under a single `contract_version`;
2. that `contract_version` ∈ the accepted set for this run (exact match or registered successor);
3. `source_edge_ts ≥ w_end` and no candle source repair for `symbol` landed after `verified_at` (source revision check);
4. `lifecycle_cursor ≥ required_edge − lifecycle_grace` for level/event features;
5. the verification run's `status` is `verified` and `verified_at` is present (no pending/failed rows counted).

If any clause fails, the gate reports the **specific missing proof** and the exact backfill command that creates it. No generic STALE.

---

## 7. PR sequencing (refinement 10)

| PR | Contents | Gate to proceed |
|---|---|---|
| **PR-1** | ATR-proxy removal; runner outcome exposure (attempted/computed/persisted/rejected/compute_errors); post-flush DB verification; non-zero exit on incomplete | A seeded sparse case recomputes exactly the missing anchors; injected deadlock exits non-zero |
| **PR-2** | Schema §2 (3 objects + quality_json keys); manifest written **from verified results only** | Hand-deleted row flips run to `failed`; no manifest row written |
| **PR-3** | Planning gate reads manifest with §6 trust predicate; freshness formula §5 | Doctored manifest row fails gate; boundary+11min producer passes |
| **PR-4** | Lifecycle contract §4 | Treadmill fixture terminates ≤ 2 zero-progress iterations; concurrent refresh exits `lock_not_acquired` |
| **PR-5** | Vintage pinning: research runs pin `min contract_version`; segments only from accepted versions | Old-vintage segment never satisfies a new-contract gate |

---

## 8. Acceptance criteria (each = a test)

1. **Proxy removal:** window where ATR exists at all anchors but `features_bias` is missing at 10 → backfill recomputes exactly those 10 for bias closure only; post-verification reports bias density 100%; upstream rows for other features are byte-identical before/after (proven via row hash).
2. **Truthful accounting:** injected deadlock → run exits non-zero; summary prints `computed/persisted/rejected/compute_errors` matching the ledger; runtime counter lies do not change the exit status.
3. **Post-verification authority:** delete one persisted row post-run → verification flips to `failed` and no manifest row is written; restore → next run reaches `verified` and manifest appears.
4. **Semantic split:** a `level` feature with 0 rows but 100% attempted coverage scores `READY_LEVEL`; at 40% attempted it scores `BLOCKED_PRODUCER_COVERAGE` with the failing anchor range named.
5. **Session-scoped completeness:** `opening_range` proof requires `(date, session, range_minutes)` keys per tradable day — a missing NY key on one day fails that day's segment even if all candles exist.
6. **Multi-row keys:** `moving_average` proof counts `(anchor, period, ma_type)` logical keys; a window missing only period 200 scores partial for that series, not "complete".
7. **Freshness formula:** a producer writing every 15m passes at boundary+11min and boundary+14min; one silent for `cadence+grace+ε` fails; weekend edge never fails freshness.
8. **Lifecycle convergence:** a fixture whose function returns `rows_updated>0` with no cursor movement terminates after ≤ 2 zero-progress iterations and logs `NO_PROGRESS_STOP`; a lock-holding second instance exits `lock_not_acquired` immediately.
9. **Trust predicate:** a manifest row with (a) doctored window, (b) wrong contract version, (c) source edge older than the request, (d) missing lifecycle cursor, or (e) `status='partial'` — each independently fails the gate with its clause named.
10. **End-to-end (the GBPUSD scenario):** with data present, the readiness check passes at any minute of the cadence cycle (no cadence-race false-STALE); with 14% window coverage it fails at planning time with `run backfill <from> <to>` in the message.

---

## 9. What this deliberately does NOT change

- Strategy/spec/compiler semantics (progressive steps, TTLs, direction chaining) — untouched.
- The accuracy panel (zones-per-setup, dup rate, drift, placement) — it becomes one consumer of the manifest, not a replacement for it.
- Live hot-path behavior — the inline engine keeps `skipLifecycle:true`; the contract governs *proof for research*, and live reads the same manifest for its own freshness view.

*Authored from the joint assessment (10 refinements) of 2026-07-22. Next step per the frozen plan: PR-1.*
