#!/usr/bin/env node
/** Bounded, disabled-by-default progressive DAG-v2 fixed-point shadow replay. */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const {
  readProgressiveShadowProducerConfig,
  readProgressiveShadowReplayMaxPasses,
  readProgressiveShadowWorkerConfig,
  runProgressiveShadowReplay,
} = require("../packages/strategies/dist/index.js");

function poolConfig(env = process.env) {
  if (env.TM_DATABASE_URL_STRATEGY) return {
    connectionString: env.TM_DATABASE_URL_STRATEGY,
    application_name: "tradzfx-progressive-dag-replay-shadow",
    max: 2,
  };
  return {
    host: env.TM_DB_HOST || "localhost",
    port: Number(env.TM_DB_PORT || 5432),
    database: env.TM_DB_NAME || "tradzfx_v2",
    user: env.TM_DB_USER || "postgres",
    password: env.TM_DB_PASSWORD,
    application_name: "tradzfx-progressive-dag-replay-shadow",
    max: 2,
  };
}

async function main(env = process.env) {
  if (env.TM_PROGRESSIVE_DAG_ENABLED !== "true") {
    console.log("[progressive-dag-replay] disabled; no DB access");
    return;
  }
  const producer = readProgressiveShadowProducerConfig(env);
  const worker = readProgressiveShadowWorkerConfig(env);
  const maxPasses = readProgressiveShadowReplayMaxPasses(env);
  const pool = new Pool(poolConfig(env));
  try {
    const result = await runProgressiveShadowReplay(pool, { producer, worker, maxPasses });
    console.log("[progressive-dag-replay]", JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => {
  console.error("[progressive-dag-replay] fatal", error);
  process.exit(1);
});
module.exports = { main, poolConfig };
