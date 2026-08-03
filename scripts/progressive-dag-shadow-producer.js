#!/usr/bin/env node
/** Bounded, disabled-by-default XAUUSD progressive DAG-v2 shadow producer. */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const {
  produceXauusdProgressiveShadowBatch,
  readProgressiveShadowProducerConfig,
} = require("../packages/strategies/dist/index.js");

function poolConfig(env = process.env) {
  if (env.TM_DATABASE_URL_STRATEGY) return {
    connectionString: env.TM_DATABASE_URL_STRATEGY,
    application_name: "tradzfx-progressive-dag-producer-shadow",
    max: 1,
  };
  return {
    host: env.TM_DB_HOST || "localhost",
    port: Number(env.TM_DB_PORT || 5432),
    database: env.TM_DB_NAME || "tradzfx_v2",
    user: env.TM_DB_USER || "postgres",
    password: env.TM_DB_PASSWORD,
    application_name: "tradzfx-progressive-dag-producer-shadow",
    max: 1,
  };
}

async function main(env = process.env) {
  const config = readProgressiveShadowProducerConfig(env);
  if (!config.enabled) {
    console.log("[progressive-dag-producer] disabled; no DB access");
    return;
  }
  const pool = new Pool(poolConfig(env));
  try {
    const result = await produceXauusdProgressiveShadowBatch(pool, config);
    console.log("[progressive-dag-producer]", JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => {
  console.error("[progressive-dag-producer] fatal", error);
  process.exit(1);
});
module.exports = { main, poolConfig };
