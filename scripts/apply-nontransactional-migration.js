/**
 * Apply a non-transactional migration file.
 *
 * Some DDL (e.g. CREATE INDEX CONCURRENTLY) cannot run inside a transaction.
 * This script splits a migration file on `--- statement:` markers and executes
 * each statement with its own autocommit query.
 *
 * Usage:
 *   node scripts/apply-nontransactional-migration.js infra/migrations/085_lifecycle_fast_lookup.sql
 */

const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
});

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node apply-nontransactional-migration.js <file>");
    process.exit(1);
  }

  const raw = fs.readFileSync(file, "utf8");
  const statements = raw
    .split(/\n---\s*statement:\s*\S+\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (statements.length === 0) {
    console.error("No statements found. Mark each statement with '--- statement: <name>' separators.");
    process.exit(1);
  }

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < statements.length; i++) {
    const sql = statements[i];
    try {
      await pool.query(sql);
      console.log(`Applied statement ${i + 1}/${statements.length}`);
      ok++;
    } catch (e) {
      console.error(`Failed statement ${i + 1}/${statements.length}:`, e.message);
      failed++;
    }
  }

  await pool.end();
  if (failed > 0) {
    process.exitCode = 1;
  }
  console.log(`Done: ${ok} applied, ${failed} failed.`);
})();
