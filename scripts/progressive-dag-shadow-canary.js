#!/usr/bin/env node
/** Disabled-by-default rolling progressive DAG-v2 canary. Shadow lifecycle tables only. */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const {
  readProgressiveShadowCanaryConfig,
  runProgressiveShadowCanary,
} = require("../packages/strategies/dist/index.js");

function poolConfig(env = process.env) {
  if (env.TM_DATABASE_URL_STRATEGY) return {
    connectionString: env.TM_DATABASE_URL_STRATEGY,
    application_name: "tradzfx-progressive-dag-canary-shadow",
    max: 2,
  };
  return {
    host: env.TM_DB_HOST || "localhost",
    port: Number(env.TM_DB_PORT || 5432),
    database: env.TM_DB_NAME || "tradzfx_v2",
    user: env.TM_DB_USER || "postgres",
    password: env.TM_DB_PASSWORD,
    application_name: "tradzfx-progressive-dag-canary-shadow",
    max: 2,
  };
}

async function runOnce(env = process.env) {
  const config = readProgressiveShadowCanaryConfig(env);
  if (!config.enabled) {
    console.log("[progressive-dag-canary] disabled; no DB access");
    return null;
  }
  const pool = new Pool(poolConfig(env));
  try {
    const result = await runProgressiveShadowCanary(pool, config);
    console.log("[progressive-dag-canary]", JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}

function main(env = process.env) {
  const enabled = env.TM_PROGRESSIVE_DAG_CANARY_ENABLED === "true";
  if (!enabled) {
    console.log("[progressive-dag-canary] disabled; no DB access");
    return;
  }
  const intervalMs = Math.max(900000, Number.parseInt(env.TM_PROGRESSIVE_DAG_CANARY_INTERVAL_MS || "900000", 10));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runOnce(env); }
    catch (error) { console.error("[progressive-dag-canary] run failed", error); }
    finally { running = false; }
  };
  console.log(`[progressive-dag-canary] enabled interval=${intervalMs}ms; shadow-only, no order path`);
  void tick();
  setInterval(() => void tick(), intervalMs);
}

if (require.main === module) main();
module.exports = { main, poolConfig, runOnce };
