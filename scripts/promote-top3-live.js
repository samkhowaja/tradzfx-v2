/**
 * Promote the top-3 variants to real live execution and deactivate everything else.
 *
 * Usage:
 *   node scripts/promote-top3-live.js
 */

const { spawn } = require("child_process");
const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const {
  loadStrategyFromDB,
  resolveReadinessRequirements,
} = require("../packages/strategies/dist/index.js");
const {
  collectCapabilityMatrix,
  readinessStatus,
} = require("./feature-capability.js");

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
    // Capability validation runs below against promotion targets only. Avoid
    // blocking promotion on unrelated inactive/legacy active specs.
    const proc = spawn("node", [seedPath, "--check", "--skip-capability"], {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`seed script exited ${code}`));
      else resolve();
    });
  });
}

function evaluatePromotionReadiness(matrix) {
  const summary = readinessStatus(matrix);
  return {
    ok: summary.status === "READY",
    ...summary,
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function checkPromotionReadiness() {
  for (const variantId of LIVE_VARIANTS) {
    const spec = await loadStrategyFromDB(pool, variantId);
    if (!spec) throw new Error(`readiness: strategy not found after seed: ${variantId}`);
    const requirements = resolveReadinessRequirements(spec);
    const symbols = spec.filters?.symbols ?? [];
    if (symbols.length === 0) throw new Error(`readiness: strategy has no symbols: ${variantId}`);
    console.log(`[promote] Scanning capability matrix: ${variantId}`);
    const matrix = await withTimeout(collectCapabilityMatrix(pool, {
      symbols,
      tfs: [...new Set(requirements.map((cell) => cell.tf))],
      features: [...new Set(requirements.map((cell) => cell.feature))],
      concurrency: 8,
    }), Number(process.env.TM_PROMOTION_CAPABILITY_TIMEOUT_MS || 120000),
    `capability scan for ${variantId}`);
    const requiredKeys = new Set(requirements.map((cell) => `${cell.feature}@${cell.tf}`));
    const requiredMatrix = {
      ...matrix,
      rows: matrix.rows.filter((row) => requiredKeys.has(`${row.feature}@${row.tf}`)),
    };
    const verdict = evaluatePromotionReadiness(requiredMatrix);
    console.log(`[promote] ${variantId} readiness: ${verdict.status}`);
    if (!verdict.ok) {
      const failures = requiredMatrix.rows
        .filter((row) => row.verdict !== "READY" && row.verdict !== "READY_LEVEL" && row.verdict !== "READY_EVENT")
        .map((row) => `${row.symbol}:${row.feature}@${row.tf}=${row.verdict}`);
      throw new Error(`readiness blocked promotion for ${variantId}: ${failures.join(", ")}`);
    }
  }
}

async function main() {
  console.log("[promote] Seeding and validating specs from YAML...\n");
  await runSeed();
  await checkPromotionReadiness();

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

if (require.main === module) {
  main().catch((e) => {
    console.error("[promote] Fatal:", e);
    process.exit(1);
  });
}

module.exports = { evaluatePromotionReadiness };
