/**
 * Quick fix: update watukushay_no1 symbols/timeframes in DB.
 * The seeder should have done this but something went wrong — run this to
 * directly apply the inherited values from the base spec.
 */
const { Pool } = require("pg");
const fs = require("fs");
const YAML = require("yaml");
const path = require("path");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const VARIANT_IDS = ["watukushay_no1", "doyle_sd", "orb_classic"];

async function fixVariantSymbols() {
  // Load base spec for watukushay
  const basePath = path.join(__dirname, "..", "packages", "strategies", "src", "specs", "watukushay.yaml");
  const baseSpec = YAML.parse(fs.readFileSync(basePath, "utf8"));

  const symbols = baseSpec.filters?.symbols ?? [];
  const timeframes = ["1h"];

  console.log("Fixing watukushay_no1 symbols/timeframes:");
  console.log("  symbols:", JSON.stringify(symbols));
  console.log("  timeframes:", JSON.stringify(timeframes));

  let r = await pool.query("SELECT id, symbols, timeframes FROM strategy_variants WHERE id = 'watukushay_no1'");
  console.log("  Before:", JSON.stringify(r.rows[0]));

  await pool.query(
    "UPDATE strategy_variants SET symbols = $1, timeframes = $2, updated_at = NOW() WHERE id = 'watukushay_no1'",
    [symbols, timeframes]
  );

  r = await pool.query("SELECT id, symbols, timeframes FROM strategy_variants WHERE id = 'watukushay_no1'");
  console.log("  After:", JSON.stringify(r.rows[0]));
}

async function fixDeploymentMode() {
  console.log("\nFixing live_deployment mode from 'paper' to 'live'...");

  const r = await pool.query(`
    UPDATE live_deployment d
    SET mode = 'live',
        started_at = NOW()
    FROM strategy_variants v
    WHERE d.strategy_id = v.id
      AND v.id = ANY($1)
      AND v.is_active = true
      AND d.mode = 'paper'
      AND d.is_active = true
    RETURNING d.deployment_id, d.strategy_id, d.mode
  `, [VARIANT_IDS]);

  console.log(`  Updated ${r.rows.length} deployments:`);
  r.rows.forEach(row => console.log(`    ${row.deployment_id}: ${row.strategy_id} → ${row.mode}`));

  // Also end any other active deployments for watukushay_no1 if they exist
  // and mark only the latest one as active
}

async function resetPipelineBuckets() {
  console.log("\nResetting pipeline_trigger_state for recent buckets...");

  // Collect symbols from our three strategies
  const r = await pool.query(`
    DELETE FROM pipeline_trigger_state
    WHERE bucket >= EXTRACT(EPOCH FROM NOW() - INTERVAL '2 hours')::bigint
      AND symbol = ANY(
        SELECT unnest(symbols) FROM strategy_variants WHERE id = ANY($1)
      )
    RETURNING symbol, bucket
  `, [VARIANT_IDS]);

  console.log(`  Cleared ${r.rows.length} stale trigger buckets`);
}

async function verifyFix() {
  console.log("\n=== VERIFICATION ===");

  // 1. Variant symbols
  let r = await pool.query(
    "SELECT id, symbols, timeframes, is_active, overrides->'live'->>'mode' as live_mode FROM strategy_variants WHERE id = ANY($1) ORDER BY id",
    [VARIANT_IDS]
  );
  console.log("Variants:");
  r.rows.forEach(row => console.log(`  ${row.id}: symbols=${JSON.stringify(row.symbols?.length)} tfs=${JSON.stringify(row.timeframes)} active=${row.is_active} live_mode=${row.live_mode}`));

  // 2. Live deployments
  r = await pool.query(`
    SELECT d.strategy_id, d.mode, d.is_active, d.started_at
    FROM live_deployment d
    WHERE d.strategy_id = ANY($1) AND d.is_active = true
    ORDER BY d.strategy_id`, [VARIANT_IDS]);
  console.log("Active deployments:");
  r.rows.forEach(row => console.log(`  ${row.strategy_id}: mode=${row.mode} active=${row.is_active}`));

  // 3. Check if watukushay_no1 has a deployment — create one if missing
  r = await pool.query("SELECT deployment_id, mode FROM live_deployment WHERE strategy_id = 'watukushay_no1' AND is_active = true");
  if (r.rows.length === 0) {
    console.log("\nNo active deployment for watukushay_no1 — need to create one.");
    console.log("  (This will be created automatically when the pipeline runs next)");
  } else {
    console.log(`\nwatukushay_no1 deployment: ${r.rows[0].deployment_id} mode=${r.rows[0].mode}`);
  }

  // 4. Pipeline state
  r = await pool.query("SELECT COUNT(*) as cnt FROM pipeline_trigger_state");
  console.log(`Pipeline trigger buckets remaining: ${r.rows[0].cnt}`);
}

async function main() {
  await fixVariantSymbols();
  await fixDeploymentMode();
  await resetPipelineBuckets();
  await verifyFix();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
