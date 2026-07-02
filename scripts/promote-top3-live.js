/**
 * Promote the top-3 PIT specs to real live execution and deactivate everything else.
 *
 * Usage:
 *   node scripts/promote-top3-live.js
 */

const { spawn } = require("child_process");
const { Pool } = require("pg");
const path = require("path");

const LIVE_SPECS = ["doyle_sd", "orb_classic", "watukushay_no1"];

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

function runSeed() {
  return new Promise((resolve, reject) => {
    const seedPath = path.join(__dirname, "seed-strategy-specs.js");
    const proc = spawn("node", [seedPath], {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`seed script exited ${code}`));
      else resolve();
    });
  });
}

async function main() {
  console.log("[promote] Seeding specs from YAML...\n");
  await runSeed();

  console.log("\n[promote] Activating top-3 specs in live mode...");
  const livePlaceholders = LIVE_SPECS.map((_, i) => `$${i + 1}`).join(",");
  await pool.query(
    `UPDATE strategy_specs
     SET spec_json = jsonb_set(spec_json, '{live,mode}', '"live"'),
         is_active = true
     WHERE id IN (${livePlaceholders})`,
    LIVE_SPECS
  );

  console.log("[promote] Deactivating all other specs...");
  await pool.query(
    `UPDATE strategy_specs
     SET is_active = false
     WHERE id NOT IN (${livePlaceholders})`,
    LIVE_SPECS
  );

  const { rows } = await pool.query(
    `SELECT id,
            is_active,
            spec_json->'live'->>'mode' AS mode
     FROM strategy_specs
     ORDER BY is_active DESC, id`
  );

  console.log("\n[promote] Current strategy_specs state:\n");
  console.log("id                  | is_active | mode");
  console.log("--------------------+-----------+------");
  for (const r of rows) {
    console.log(`${r.id.padEnd(19)} | ${String(r.is_active).padEnd(9)} | ${r.mode}`);
  }

  const activeLive = rows.filter((r) => r.is_active && r.mode === "live");
  console.log(`\n[promote] Active live specs: ${activeLive.map((r) => r.id).join(", ") || "NONE"}`);

  await pool.end();
}

main().catch((e) => {
  console.error("[promote] Fatal:", e);
  process.exit(1);
});
