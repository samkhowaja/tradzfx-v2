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

/**
 * SK-51 — destructive-migration guard (preventive).
 *
 * Migrations 075/077 historically TRUNCATEd live tables (orders, backtest_*,
 * strategy_*) with no backup. Those are already applied, so this guard protects
 * FUTURE migrations and fresh replays: it refuses a destructive statement on a
 * protected table that actually holds data, unless TM_ALLOW_DESTRUCTIVE=1 is set
 * (after a backup). Empty/missing tables are allowed so fresh bootstrap is not
 * blocked. Benign migrations (CREATE/ALTER ADD) are unaffected.
 */

/** Exact protected table names (lowercased for comparison). */
export const PROTECTED_TABLES: string[] = [
  "orders",
  "trades",
  "signals",
  "setup_evaluations",
  "backtest_results",
  "backtest_runs",
  "strategy_families",
  "strategy_variants",
  "strategy_specs",
  "feature_producer_runs",
  "candle_quality",
  "market_volatility_profile",
  "lifecycle_refresh_state",
];

/** Protected table-name prefixes (covers every candles_ and features_ table). */
export const PROTECTED_PREFIXES: string[] = ["candles_", "features_"];

export interface DestructiveHit {
  op: "TRUNCATE" | "DROP TABLE" | "DROP COLUMN" | "DELETE";
  table: string;
  statement: string;
}

/** Strip line/block comments and single-quoted string literals (false-positive
 *  sources, e.g. a `-- TRUNCATE orders` comment). */
function stripNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, " '' ");
}

function normalizeIdent(raw: string): string {
  const trimmed = raw.trim().replace(/^"|"$/g, "");
  const parts = trimmed.split(".");
  return (parts[parts.length - 1] ?? trimmed).toLowerCase();
}

function isProtected(
  name: string,
  protectedTables: string[],
  prefixes: string[]
): boolean {
  const n = name.toLowerCase();
  if (protectedTables.some((p) => p.toLowerCase() === n)) return true;
  if (prefixes.some((px) => n.startsWith(px.toLowerCase()))) return true;
  return false;
}

/** Syntactic scan for the FIRST destructive statement on a protected table.
 *  Pure/comment-safe — exported for tests. Returns null when clean. */
export function findDestructive(
  sql: string,
  protectedTables: string[] = PROTECTED_TABLES,
  prefixes: string[] = PROTECTED_PREFIXES
): DestructiveHit | null {
  const clean = stripNoise(sql);
  const statements = clean.split(";");
  for (const stmt of statements) {
    const s = stmt.trim();
    if (!s) continue;
    let m: RegExpMatchArray | null;
    if ((m = s.match(/\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?("?[\w.]+"?)/i))) {
      const table = normalizeIdent(m[1]);
      if (isProtected(table, protectedTables, prefixes))
        return { op: "TRUNCATE", table, statement: s };
    }
    if ((m = s.match(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i))) {
      const table = normalizeIdent(m[1]);
      if (isProtected(table, protectedTables, prefixes))
        return { op: "DROP TABLE", table, statement: s };
    }
    if (
      (m = s.match(
        /\bALTER\s+TABLE\s+(?:ONLY\s+)?("?[\w.]+"?)\s+DROP\s+(?:COLUMN\s+)?/i
      ))
    ) {
      const table = normalizeIdent(m[1]);
      if (isProtected(table, protectedTables, prefixes))
        return { op: "DROP COLUMN", table, statement: s };
    }
    if ((m = s.match(/\bDELETE\s+FROM\s+(?:ONLY\s+)?("?[\w.]+"?)/i))) {
      // DELETE without WHERE is the destructive form (a targeted DELETE … WHERE is fine).
      if (!/\bWHERE\b/i.test(s)) {
        const table = normalizeIdent(m[1]);
        if (isProtected(table, protectedTables, prefixes))
          return { op: "DELETE", table, statement: s };
      }
    }
  }
  return null;
}

/** True if `table` exists and contains at least one row. Missing/empty => false
 *  (so fresh bootstrap and empty tables are not blocked). Identifier is sanitized
 *  to [A-Za-z0-9_] to avoid injection. */
async function tableHasRows(
  pool: Pick<Pool, "query">,
  table: string
): Promise<boolean> {
  const safe = table.replace(/[^A-Za-z0-9_]/g, "");
  if (!safe) return false;
  try {
    const { rows } = await pool.query(`SELECT 1 FROM ${safe} LIMIT 1`);
    return rows.length > 0;
  } catch {
    return false; // table does not exist yet (fresh deploy) => nothing to destroy
  }
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
      // SK-51: refuse destructive statements on protected tables that hold data,
      // unless explicitly overridden (after a backup). Fail closed.
      const hit = findDestructive(sql);
      if (hit && process.env.TM_ALLOW_DESTRUCTIVE !== "1") {
        const live = await tableHasRows(pool, hit.table);
        if (live) {
          throw new Error(
            `[migrate] ${version}.sql blocked: ${hit.op} on protected table '${hit.table}' ` +
              `which contains data. Back it up first, then re-run with TM_ALLOW_DESTRUCTIVE=1 to proceed.`
          );
        }
      }
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
