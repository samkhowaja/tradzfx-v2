# Repository Checkpoint — 2026-08-08

## Authority

- Checkpoint tag: `repo-checkpoint-2026-08-08`
- Checkpoint commit: `00462cec15a13dbd010a452e1391536603b23aa2`
- Cleanup branch: `chore/repo-checkpoint-cleanup`
- Older reports and generated outputs are historical evidence only. They are not current project state.
- Current truth begins with this checkpoint and later validated results.

## Database state

- Migration 193: unapplied.
- Production database mutation: none.
- XAUUSD 15m candidate: not created.
- ATR derivation: blocked.
- Trust registration and READY transition: blocked.
- Feature backfill: blocked.
- Backtest reads for this certification gate: blocked.
- Applied migration list: must be captured from production using read-only query before any migration apply. No unverified list is asserted here.

## Runtime state

- No service restart or deployment performed by checkpoint operation.
- Running services and health status: not asserted by this checkpoint; capture with read-only health and process commands before cleanup validation.

## Safety gates

- Canonical candle path: fail-closed.
- Quarantine evidence: immutable.
- Raw candles: immutable.
- `features_zone`: untouched and protected.
- Feature jobs, live signals, and unresolved backtests: blocked where unresolved.
- Index cleanup: excluded from cleanup scope.

## Known active blockers

- Migration 193 certification incomplete.
- Disposable role matrix incomplete after schema-visibility test failure.
- Positive finalization fixture incomplete.
- Negative lineage, mutation, concurrency, and failure-atomicity acceptance incomplete.
- Immutable evidence review incomplete.
- Read-only XAUUSD lineage/calendar report incomplete.
- Production privilege and membership evidence incomplete.

## Protected files and tables

### Protected files

- `infra/migrations/`
- `apps/engine/`
- `apps/web/`
- `packages/`
- `mt5-ea/`
- `scripts/` entries referenced by package commands, CI, PM2, migrations, or operations
- `AGENTS.md`
- `.env*` files: never commit or expose

### Protected database areas

- Raw candle tables and raw-source evidence
- Quarantine evidence
- Ingestion run/evidence tables
- Canonical candle lineage
- HTF derivation lineage and children
- `features_zone`
- Orders, trades, signals, setup evaluations, and backtest evidence
- Strategy specifications and live state
- All indexes and migrations: no index cleanup in this work

## Reproduction commands

```powershell
git switch chore/repo-checkpoint-cleanup
git show --stat --oneline repo-checkpoint-2026-08-08
git diff --check repo-checkpoint-2026-08-08..HEAD
node scripts/migration-193-disposable.test.cjs
node scripts/audit-migration-193-finalizer.cjs
```

Production report commands must be read-only and documented only after their SQL and scope are reviewed. No production apply command is authorized by this checkpoint.

## Gate

`BLOCKED / INCOMPLETE / UNAPPLIED`

No production migration apply, XAUUSD 15m candidate creation, ATR derivation, trust registration, READY transition, feature backfill, or backtest reads until required acceptance and read-only lineage/calendar gates pass.
