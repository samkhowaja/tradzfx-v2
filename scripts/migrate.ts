/**
 * Database migration runner.
 * Applies SQL migrations from v2/infra/migrations/ in order.
 */

import { getPool, closePool } from "../packages/shared/src/utils/db";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

async function main() {
  const pool = getPool();

  // Ensure migrations table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = join(process.cwd(), "infra", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`[migrate] Found ${files.length} migration files`);

  for (const file of files) {
    const version = file.replace(".sql", "");

    const { rows } = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [version]
    );

    if (rows.length > 0) {
      console.log(`[migrate] Skipping ${file} (already applied)`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    console.log(`[migrate] Applying ${file}...`);

    try {
      await pool.query(sql);
      await pool.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version]
      );
      console.log(`[migrate] ✓ ${file}`);
    } catch (err: any) {
      console.error(`[migrate] ✗ ${file} failed:`, err.message);
      process.exit(1);
    }
  }

  console.log("[migrate] All migrations applied.");
  await closePool();
}

main().catch((err) => {
  console.error("[migrate] Fatal:", err);
  process.exit(1);
});
