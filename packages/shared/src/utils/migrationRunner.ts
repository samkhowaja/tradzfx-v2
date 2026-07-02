/**
 * Shared migration-runner logic.
 *
 * Supports:
 * - Normal ordered migration application with schema_migrations tracking.
 * - `--repair`: record all current migrations as applied without running SQL.
 * - `--reconcile`: skip / record migrations whose objects already exist, either
 *   via explicit `-- @reconcile:` comments or by catching "already exists" errors.
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { Pool } from "pg";
import { getPool, closePool } from "./db";

export const ALREADY_EXISTS_CODES = new Set([
  "42P07", // duplicate_table
  "42701", // duplicate_column
  "42P16", // invalid_table_definition (often duplicate column/index)
  "42P06", // duplicate_schema
  "42723", // duplicate_function
  "23505", // unique_violation (data migration already applied)
]);

export interface Migration {
  version: string;
  sql: string;
}

export interface RunOptions {
  /** Record all supplied migrations as applied without executing SQL. */
  repair?: boolean;
  /** Treat "already exists" errors as applied instead of failing. */
  reconcile?: boolean;
  /** Directory containing *.sql migration files. */
  migrationsDir?: string;
  /** Optional explicit migration list (used in tests). */
  migrations?: Migration[];
  /** Optional pool (used in tests). */
  pool?: Pool;
}

export function parseArgs(argv: string[]): { repair: boolean; reconcile: boolean } {
  return {
    repair: argv.includes("--repair"),
    reconcile: argv.includes("--reconcile"),
  };
}

/**
 * Parse explicit reconcile targets from comments like:
 *   -- @reconcile: table:features_indicator
 *   -- @reconcile: column:position_commands.close_reason
 *   -- @reconcile: index:idx_features_indicator_lookup
 *   -- @reconcile: extension:timescaledb
 */
export function parseReconcileTargets(sql: string): string[] {
  const targets: string[] = [];
  for (const line of sql.split("\n")) {
    const match = line.match(/--\s*@reconcile:\s*(.+)/);
    if (match) targets.push(match[1].trim());
  }
  return targets;
}

export async function checkReconcileTarget(
  pool: Pick<Pool, "query">,
  target: string
): Promise<boolean> {
  const [kind, name] = target.split(":").map((s) => s.trim());
  if (!kind || !name) return false;

  try {
    if (kind === "table") {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
        [name]
      );
      return rows.length > 0;
    }
    if (kind === "column") {
      const [table, column] = name.split(".");
      const { rows } = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2`,
        [table, column]
      );
      return rows.length > 0;
    }
    if (kind === "index") {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
        [name]
      );
      return rows.length > 0;
    }
    if (kind === "extension") {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_extension WHERE extname = $1`,
        [name]
      );
      return rows.length > 0;
    }
  } catch (err) {
    console.warn(`[migrate] Reconcile check failed for ${target}:`, err);
  }
  return false;
}

function loadMigrationsFromDir(migrationsDir: string): Migration[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => ({
    version: file.replace(".sql", ""),
    sql: readFileSync(join(migrationsDir, file), "utf-8"),
  }));
}

async function ensureMigrationsTable(pool: Pick<Pool, "query">): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function runMigrations(options: RunOptions = {}): Promise<void> {
  const pool = options.pool ?? getPool();
  const { repair, reconcile } = options;

  await ensureMigrationsTable(pool);

  const migrations =
    options.migrations ??
    (options.migrationsDir ? loadMigrationsFromDir(options.migrationsDir) : []);

  if (migrations.length === 0) {
    console.log("[migrate] No migrations to run.");
    if (!options.pool) await closePool();
    return;
  }

  if (repair) {
    for (const { version } of migrations) {
      const { rows } = await pool.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version]
      );
      if (rows.length > 0) continue;
      await pool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
        version,
      ]);
      console.log(`[migrate] Repaired ${version}.sql`);
    }
    console.log("[migrate] Repair complete.");
    if (!options.pool) await closePool();
    return;
  }

  for (const { version, sql } of migrations) {
    const { rows } = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [version]
    );
    if (rows.length > 0) {
      console.log(`[migrate] Skipping ${version}.sql (already applied)`);
      continue;
    }

    const reconcileTargets = parseReconcileTargets(sql);
    if (reconcileTargets.length > 0) {
      const exists = await Promise.all(
        reconcileTargets.map((t) => checkReconcileTarget(pool, t))
      );
      if (exists.every(Boolean)) {
        await pool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
          version,
        ]);
        console.log(
          `[migrate] Reconciled ${version}.sql (targets already present)`
        );
        continue;
      }
    }

    console.log(`[migrate] Applying ${version}.sql...`);
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
        version,
      ]);
      console.log(`[migrate] ✓ ${version}.sql`);
    } catch (err: any) {
      const code = err?.code ?? "";
      if (reconcile && ALREADY_EXISTS_CODES.has(code)) {
        console.warn(
          `[migrate] ! ${version}.sql failed with already-exists error ${code}; marking applied under --reconcile`
        );
        await pool.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [version]
        );
        console.log(`[migrate] ✓ ${version}.sql (reconciled)`);
      } else {
        console.error(`[migrate] ✗ ${version}.sql failed:`, err.message);
        throw err;
      }
    }
  }

  console.log("[migrate] All migrations applied.");
  if (!options.pool) await closePool();
}
