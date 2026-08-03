#!/usr/bin/env node
/** Disabled-by-default progressive DAG v2 lifecycle worker. No order path imports. */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const {
  loadProgressivePlan,
  processProgressiveShadowBatch,
  readProgressiveShadowWorkerConfig,
} = require("../packages/strategies/dist/index.js");

const intervalMs = Math.max(1000, Number.parseInt(process.env.TM_PROGRESSIVE_DAG_INTERVAL_MS || "5000", 10));
const dbUrl = process.env.TM_DATABASE_URL_STRATEGY;
const pool = new Pool(dbUrl ? {
  connectionString: dbUrl,
  application_name: "tradzfx-progressive-dag-shadow",
  max: 2,
} : {
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: "tradzfx-progressive-dag-shadow",
  max: 2,
});
let running = false;

async function runOnce(config) {
  if (running) return;
  running = true;
  try {
    const result = await processProgressiveShadowBatch(
      pool,
      (planHash) => loadProgressivePlan(pool, planHash),
      config,
    );
    if (result.selected || result.errors.length) console.log("[progressive-dag-shadow]", JSON.stringify(result));
  } finally {
    running = false;
  }
}

async function main() {
  const config = readProgressiveShadowWorkerConfig(process.env);
  if (!config.enabled) {
    console.log("[progressive-dag-shadow] disabled; set TM_PROGRESSIVE_DAG_ENABLED=true with TM_PROGRESSIVE_DAG_MODE=shadow");
    await pool.end();
    return;
  }
  console.log(`[progressive-dag-shadow] enabled interval=${intervalMs}ms; shadow-only, no order path`);
  await runOnce(config);
  setInterval(() => runOnce(config).catch((error) => console.error("[progressive-dag-shadow] batch failed", error)), intervalMs);
}

async function shutdown() {
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (require.main === module) main().catch(async (error) => {
  console.error("[progressive-dag-shadow] fatal", error);
  await pool.end();
  process.exit(1);
});
module.exports = { runOnce };
