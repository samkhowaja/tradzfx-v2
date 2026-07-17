/**
 * Promote the top-3 variants to real live execution and deactivate everything else.
 *
 * Usage:
 *   node scripts/promote-top3-live.js
 */

const { spawn } = require("child_process");
const { Pool } = require("pg");
const path = require("path");

const LIVE_VARIANTS = ["doyle_sd", "orb_classic", "watukushay_no1"]; // Jul 14 2026: doyle_sd new champ (82.9% WR EURUSD, 2.5R avg)

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

  console.log("\n[promote] Activating top-3 variants in live mode...");
  const livePlaceholders = LIVE_VARIANTS.map((_, i) => `$${i + 1}`).join(",");
  await pool.query(
    `UPDATE strategy_variants
     SET is_active = true,
         overrides = jsonb_set(COALESCE(overrides, '{}'), '{live,mode}', '"live"')
     WHERE id IN (${livePlaceholders})`,
    LIVE_VARIANTS
  );

  console.log("[promote] Deactivating all other variants...");
  await pool.query(
    `UPDATE strategy_variants
     SET is_active = false
     WHERE id NOT IN (${livePlaceholders})`,
    LIVE_VARIANTS
  );

  const { rows } = await pool.query(
    `SELECT v.id,
            v.is_active,
            v.overrides->'live'->>'mode' AS mode,
            f.name AS family_name
     FROM strategy_variants v
     JOIN strategy_families f ON f.id = v.family_id
     ORDER BY v.is_active DESC, f.name, v.id`
  );

  console.log("\n[promote] Current strategy_variants state:\n");
  console.log("family              | variant             | is_active | mode");
  console.log("--------------------+---------------------+-----------+------");
  for (const r of rows) {
    console.log(`${r.family_name.padEnd(19)} | ${r.id.padEnd(19)} | ${String(r.is_active).padEnd(9)} | ${r.mode ?? "paper"}`);
  }

  const activeLive = rows.filter((r) => r.is_active && r.mode === "live");
  console.log(`\n[promote] Active live variants: ${activeLive.map((r) => r.id).join(", ") || "NONE"}`);

  await pool.end();
}

main().catch((e) => {
  console.error("[promote] Fatal:", e);
  process.exit(1);
});
