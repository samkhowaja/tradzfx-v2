#!/usr/bin/env node
/**
 * Recompute canonical feature anchors corresponding to rows quarantined by
 * repair-invalid-dense-feature-anchors.js.
 *
 * Source of scope is immutable repair_audit_20260717 backup tables. Each bad
 * timestamp maps to latest canonical candle at or before that timestamp. Only
 * features still missing at mapped anchor are requested. Dry-run by default;
 * pass --apply to execute PIT-safe DAG runs with 500-bar context.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { DAGRunner, globalDAG } = require("../apps/engine/dist/index.js");

const AUDIT_SCHEMA = "repair_audit_20260717";
const CANDLES = {
  "1d": "market.candles_1d_utc_canonical",
  "4h": "market.candles_4h_canonical",
  "1h": "market.candles_1h_canonical",
  "15m": "market.candles_15m_canonical",
  "5m": "market.candles_5m_canonical",
  "1m": "market.candles_1m_canonical",
};

function safeIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}

async function getAuditTables(pool) {
  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",
    [AUDIT_SCHEMA]
  );
  return rows.map((row) => safeIdentifier(row.tablename));
}

async function getJobs(pool, tables) {
  const jobs = new Map();
  for (const table of tables) {
    for (const [tf, candleTable] of Object.entries(CANDLES)) {
      const { rows } = await pool.query(
        `WITH repaired AS (
           SELECT DISTINCT symbol, ts FROM ${AUDIT_SCHEMA}.${table} WHERE tf=$1
         ), mapped AS (
           SELECT DISTINCT r.symbol, c.ts
             FROM repaired r
             CROSS JOIN LATERAL (
               SELECT ts FROM ${candleTable} c
                WHERE c.symbol=r.symbol AND c.ts<=r.ts
                ORDER BY c.ts DESC LIMIT 1
             ) c
         )
         SELECT m.symbol, m.ts
           FROM mapped m
          WHERE NOT EXISTS (
            SELECT 1 FROM ${table} f
             WHERE f.symbol=m.symbol AND f.tf=$1 AND f.ts=m.ts
          )
            AND (
              $2 <> 'features_pricing'
              OR 20 <= (SELECT count(*) FROM (
                SELECT 1 FROM ${candleTable} c
                 WHERE c.symbol=m.symbol AND c.ts<=m.ts
                 ORDER BY c.ts DESC LIMIT 20
              ) warmup)
            )
          ORDER BY m.symbol, m.ts`,
        [tf, table]
      );
      for (const row of rows) {
        const ts = new Date(row.ts);
        const key = `${row.symbol}|${tf}|${ts.toISOString()}`;
        const job = jobs.get(key) || { symbol: row.symbol, tf, ts, features: [] };
        job.features.push(table);
        jobs.set(key, job);
      }
    }
  }
  return [...jobs.values()].sort((a, b) =>
    Object.keys(CANDLES).indexOf(a.tf) - Object.keys(CANDLES).indexOf(b.tf) ||
    a.symbol.localeCompare(b.symbol) || a.ts.getTime() - b.ts.getTime()
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
    max: 4,
  });
  const tables = await getAuditTables(pool);
  const jobs = await getJobs(pool, tables);
  const featureRows = jobs.reduce((sum, job) => sum + job.features.length, 0);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", jobs: jobs.length, featureRows, tables: tables.length }));
  if (!apply) {
    await pool.end();
    return;
  }

  const runner = new DAGRunner(pool, globalDAG);
  let completed = 0;
  let errors = 0;
  for (const job of jobs) {
    try {
      await runner.run({
        symbol: job.symbol,
        tf: job.tf,
        endTs: job.ts,
        requestedFeatures: job.features,
        lookbackBars: 500,
        skipCache: true,
        // Per-anchor persistence keeps producer postflight tied to same source
        // anchor. DAGRunner batch metadata is table-scoped, not row-scoped.
        batchInserts: false,
        skipLifecycle: true,
        skipEventGate: true,
      });
      completed++;
      if (completed % 500 === 0) console.log(`[repair-recompute] ${completed}/${jobs.length} jobs`);
    } catch (error) {
      errors++;
      console.error(`[repair-recompute] ${job.symbol} ${job.tf} ${job.ts.toISOString()}: ${error.message}`);
    }
  }
  await runner.flush();
  console.log(JSON.stringify({ mode: "apply", jobs: jobs.length, completed, errors, featureRows }));
  await pool.end();
  if (errors) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
