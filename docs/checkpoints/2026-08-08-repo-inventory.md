# Repository Inventory — 2026-08-08

Read-only inventory after checkpoint commit `00462cec15a13dbd010a452e1391536603b23aa2`.

## Counts

| Set | Count | Meaning |
|---|---:|---|
| Tracked files | 7,153 | Git index files at inventory time |
| Untracked, not ignored | 1 | This inventory file, before commit |
| Ignored files | 171,477 | Dependencies, builds, runtime data, logs, reports, environments |
| JavaScript/TypeScript files | 866 | `.js`, `.mjs`, `.cjs`, `.ts` across tracked/untracked source |
| Reports/log paths | 5,740 | Historical or generated evidence/output paths |

## Classification

| Area | Classification | Action |
|---|---|---|
| `apps/engine/` | `ACTIVE_RUNTIME` | Keep; engine runtime |
| `apps/web/` | `ACTIVE_RUNTIME` | Keep; web/service runtime |
| `packages/` | `ACTIVE_RUNTIME` | Keep; shared/runtime packages |
| `infra/migrations/` | `MIGRATION` | Preserve permanently; no cleanup |
| `mt5-ea/` | `ACTIVE_RUNTIME` | Keep; terminal integration |
| Referenced `scripts/` | `ACTIVE_TOOLING` | Keep; register and govern |
| Unreferenced root scripts | `UNKNOWN` / `ONE_OFF_OBSOLETE` | Quarantine only after reference audit |
| `docs/repro/` | `AUDIT_EVIDENCE` | Preserve; review ownership |
| `reports/` | `AUDIT_EVIDENCE` or `GENERATED_OUTPUT` | Historical; archive/quarantine, no casual deletion |
| `logs/`, `temp/` | `GENERATED_OUTPUT` | Add/verify ignore rules; retain only required evidence |
| `node_modules/`, `.venv/`, `.next/`, `dist/` | `GENERATED_OUTPUT` | Never commit; ignore |
| `data/`, `backups/` | `AUDIT_EVIDENCE` or `UNKNOWN` | Preserve until retention decision and restore verification |

## Large-file candidates

Read-only scan found large files mainly in `backups/`, `logs/`, `data/`, `apps/web/.next/`, and `reports/parity/`. These are not deletion candidates yet. Backup deletion requires restore verification and provenance per `AGENTS.md`.

## Reference inventory required

Before moving scripts, inspect:

- `package.json` and workspace package commands;
- imports and require sites;
- `.github/workflows/`;
- `ecosystem.config.js` and PM2 configuration;
- migrations and operational PowerShell files;
- `README.md`, `AGENTS.md`, and `docs/`.

## Decision rule

Checkpoint manifest plus validated post-checkpoint results are authoritative. Older reports are historical evidence only. Unknown files remain untouched. No files were moved or deleted during this inventory.

## Safety state

- Migration 193: `BLOCKED / INCOMPLETE / UNAPPLIED`.
- Production migration apply: not performed.
- Raw candles, quarantine evidence, and `features_zone`: untouched.
- Index cleanup: excluded.
