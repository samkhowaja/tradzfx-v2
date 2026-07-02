# Database Migrations

Migrations live in this directory and are applied in filename order by `scripts/migrate.ts`.

## Running migrations

```bash
cd C:\tradzfx-v2
pnpm db:migrate
```

## Linting migrations

```bash
pnpm db:lint-migrations
```

This checks every `.sql` file for non-idempotent patterns (bare `CREATE TABLE`, `ADD PRIMARY KEY`, `INSERT` without `ON CONFLICT`, etc.). Run it locally before committing a new migration, and ideally in CI.

## Conventions

1. **Idempotent SQL**
   Use `IF NOT EXISTS` / `IF EXISTS` for schema changes so migrations can be retried safely:
   - `CREATE TABLE IF NOT EXISTS ...`
   - `CREATE INDEX IF NOT EXISTS ...`
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
   - `CREATE EXTENSION IF NOT EXISTS ...`

2. **Reconcile targets (optional but recommended)**
   If a migration renames an existing object or is hard to make fully idempotent, add one or more `-- @reconcile:` comments at the top of the file. The runner will skip the migration if all targets already exist.

   Supported targets:
   ```sql
   -- @reconcile: table:features_indicator
   -- @reconcile: column:position_commands.close_reason
   -- @reconcile: index:idx_features_indicator_lookup
   -- @reconcile: extension:timescaledb
   ```

3. **Repair mode**
   If the migration tracking table (`schema_migrations`) gets out of sync with the filesystem (e.g. after a migration refactor), run:
   ```bash
   pnpm tsx scripts/migrate.ts --repair
   ```
   This records all current migration files as applied without executing SQL. Only use this on an environment whose schema is known to be up to date.

4. **Reconcile mode**
   For fresh environments or after renaming migrations, run:
   ```bash
   pnpm tsx scripts/migrate.ts --reconcile
   ```
   In this mode the runner records a migration as applied if it fails with an "already exists" Postgres error, instead of crashing.
