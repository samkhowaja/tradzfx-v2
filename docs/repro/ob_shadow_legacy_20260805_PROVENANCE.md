# OB Shadow Family — ML-LEGACY Provenance

## Artifact

| Field | Value |
|---|---|
| Dump | `backups/ob_shadow_legacy_20260805T223959Z.dump` |
| Size | 43,063,556 B (custom format, `-Fc`) |
| SHA-256 | `8c6c8d9575fe63e7269e03254689c7f676a517a9900473d4904bcaa1345aa400` |
| Sidecar | `backups/ob_shadow_legacy_20260805T223959Z.dump.sha256` |
| Restore list | `docs/repro/ob_shadow_legacy_20260805_restore_list.txt` |
| Full inventory | `temp/ob-shadow-inventory.json` (tables, columns, indexes, constraints, trigger def, function def) |
| Captured | 2026-08-05T22:39:59Z |

## Tables

| Table | Rows | Total bytes | Table bytes | Index bytes |
|---|---|---|---|---|
| `public.order_block_state_history_shadow` | 2,194,641 | 784,334,848 | 450,510,848 | 333,668,352 |
| `public.order_block_event_shadow` | 29,460 | 8,880,128 | 4,177,920 | 4,661,248 |
| `public.order_block_state_shadow` | 29,460 | 7,282,688 | 6,127,616 | 1,114,112 |
| `public.order_block_lifecycle_replay_shadow` | 2,825 | 1,392,640 | 737,280 | 614,400 |
| **Total** | **2,256,386** | **801,890,304** | — | — |

## Indexes (10)

- `order_block_state_history_shadow`: `pkey`, `idx_..._effective`, `idx_..._observed`
- `order_block_event_shadow`: `pkey`, `_logical_id_key`, `idx_..._anchor`
- `order_block_state_shadow`: `pkey`
- `order_block_lifecycle_replay_shadow`: `pkey`, `idx_..._pit`, `idx_..._effective`

## Constraints (14)

- 4 PRIMARY KEY, 3 FOREIGN KEY (all → `order_block_event_shadow`), 1 UNIQUE (`event_shadow.logical_id`), 6 CHECK

## Trigger + Function

- **Trigger:** `trg_mirror_order_block_event_state_shadow` ON `public.features_order_block` (AFTER INSERT OR UPDATE OF logical_id, is_fresh, first_touch_at, fill_pct, mitigated_at, invalidated_at) — `tgenabled='O'` (enabled)
- **Function:** `public.mirror_order_block_event_state_shadow()` — full def in `temp/ob-shadow-inventory.json`

## Timestamp ranges

| Table | Min | Max |
|---|---|---|
| `state_history_shadow.observed_at` | 2026-07-18T01:48:33Z | 2026-08-03T03:58:34Z |
| `event_shadow.formed_at` | — | 2026-07-31T13:15:00Z |
| `state_shadow.updated_at` | — | 2026-08-03T03:58:34Z |
| `lifecycle_replay_shadow.replayed_at` | — | 2026-07-18T11:58:51Z |

Last live write: 2026-08-03T03:58Z (stopped when 1x Trade feed froze 2026-08-04T07:53Z).

## Provenance

- Built by migrations `142` (event/state/history shadow + trigger), `143` (effective_time + replay function v2), `144` (lifecycle_replay_shadow), `145` (fill_progress kind check).
- Purpose: **order-block lifecycle replay audit** (SK-xx workstream). Mirrored every `features_order_block` INSERT/UPDATE into shadow tables for PIT-correct lifecycle reconstruction, later used by one-off audit scripts (`scripts/audit-ob-formula*.cjs`, `compare-order-block-lifecycle-shadow.js`, `check-replay-coverage.cjs`, `check-drain-state.cjs`).
- Last replay run: 2026-07-18.
- **No live code path reads shadow family** (verified: zero references in `apps/` + `packages/`). Only migrations, one-off audit scripts, and tests reference it.
- Tests (`scripts/order-block-event-state-shadow-migration.test.js`, `order-block-lifecycle-replay.test.js`) assert migration file contents — unaffected by table drop (migrations remain in repo).

## Restore drill — PASSED 2026-08-05

- Scratch DB `restore_drill_ob` created.
- `pg_restore --no-owner --no-privileges` exit 0.
- Verified: 4/4 tables exact row counts, 10 indexes, 14 constraints (6c/1u/4p/3f), ts ranges exact.
- Scratch DB dropped.

## Operational rule

- **Forensic recovery only.** Never re-attach to live DB as a mirror. If SK-xx lifecycle audit is re-run, restore dump into a scratch DB and replay from there.
- Family is rebuildable: re-apply migrations 142–145 on a scratch DB + re-run replay from `features_order_block` history if needed.

## Retention

- Review date: **2026-11-05** (90 days).
- Deletion of `backups/ob_shadow_legacy_20260805T223959Z.dump` + `.sha256` requires **separate explicit user approval** at or after review date.
- Off-host copy is user action only.
