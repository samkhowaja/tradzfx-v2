#!/usr/bin/env node
/**
 * Controlled causal backfill through DAGRunner persistence.
 *
 * Default mode is read-only preflight. Use --apply to persist upserts.
 * Add --delete-first only with --apply to remove target-window rows first.
 *
 * Usage:
 *   node scripts/backfill-causal-runner.cjs <SYMBOL> <TF> <DAYS> [--verify-only]
 *   node scripts/backfill-causal-runner.cjs <SYMBOL> <TF> <DAYS> --apply [--delete-first]
 */

require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const { DAGRunner, globalDAG } = require("../apps/engine/dist/index.js");
const { getCandleTableForTf } = require("../packages/shared/dist/index.js");

const CAUSAL_FEATURES = [
  "features_pivot",
  "features_structure",
  "features_sweep",
  "features_order_block",
];
const VALID_TFS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: +(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

function parseArgs(argv) {
  const [, , symbolArg, tf, daysArg, ...flags] = argv;
  const symbol = symbolArg?.toUpperCase();
  const days = Number(daysArg);
  if (!symbol || !VALID_TFS.has(tf) || !Number.isInteger(days) || days <= 0) {
    throw new Error("Usage: node scripts/backfill-causal-runner.cjs <SYMBOL> <TF> <DAYS> [--verify-only] | --apply [--delete-first]");
  }
  const apply = flags.includes("--apply");
  const deleteFirst = flags.includes("--delete-first");
  const verifyOnly = flags.includes("--verify-only") || !apply;
  if (deleteFirst && !apply) throw new Error("--delete-first requires --apply");
  return { symbol, tf, days, apply, deleteFirst, verifyOnly };
}

function countValue(result) {
  return Number(result.rows[0]?.count || 0);
}

async function countRows(client, table, symbol, tf, minTs, maxTs) {
  if (!IDENTIFIER.test(table)) throw new Error(`Unsafe table identifier: ${table}`);
  const result = await client.query(
    `SELECT COUNT(*)::bigint AS count FROM ${table} WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4`,
    [symbol, tf, minTs, maxTs]
  );
  return countValue(result);
}

async function verify(client, symbol, tf, minTs, maxTs) {
  const checks = [
    ["pivot", `SELECT COUNT(*)::bigint AS count FROM features_pivot WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4 AND confirmation_ts IS NOT NULL AND confirmation_ts < ts`],
    ["structure", `SELECT COUNT(*)::bigint AS count FROM features_structure WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4 AND available_at_ts IS NOT NULL AND available_at_ts < ts`],
    ["sweep", `SELECT COUNT(*)::bigint AS count FROM features_sweep WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4 AND available_at_ts IS NOT NULL AND available_at_ts < ts`],
  ];
  const violations = {};
  for (const [name, sql] of checks) {
    const result = await client.query(sql, [symbol, tf, minTs, maxTs]);
    violations[name] = countValue(result);
  }

  const populated = {};
  for (const [name, sql] of [
    ["pivot", "SELECT COUNT(*)::bigint AS total, COUNT(confirmation_ts)::bigint AS populated FROM features_pivot WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4"],
    ["structure", "SELECT COUNT(*)::bigint AS total, COUNT(available_at_ts)::bigint AS populated FROM features_structure WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4"],
    ["sweep", "SELECT COUNT(*)::bigint AS total, COUNT(available_at_ts)::bigint AS populated FROM features_sweep WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4"],
    ["order_block", "SELECT COUNT(*)::bigint AS total, COUNT(logical_id)::bigint AS logical_ids FROM features_order_block WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4"],
  ]) {
    const result = await client.query(sql, [symbol, tf, minTs, maxTs]);
    populated[name] = result.rows[0];
  }
  console.table(populated);
  console.log(`Timestamp violations: ${JSON.stringify(violations)}`);
  if (Object.values(violations).some((value) => value > 0)) {
    throw new Error("Causal timestamp violations detected");
  }
}

async function verifyProducerVersions(client, symbol, tf) {
  const expected = {
    features_pivot: "1.3.0",
    features_structure: "2.2.0",
    features_sweep: "1.5.0",
    features_order_block: "1.5.0",
  };
  const result = await client.query(
    `SELECT DISTINCT ON (feature_table) feature_table, producer_version, status
       FROM feature_producer_runs
      WHERE symbol = $1 AND tf = $2 AND feature_table = ANY($3)
      ORDER BY feature_table, finished_at DESC NULLS LAST, started_at DESC`,
    [symbol, tf, CAUSAL_FEATURES]
  );
  const rows = Object.fromEntries(result.rows.map((row) => [row.feature_table, row]));
  for (const table of CAUSAL_FEATURES) {
    const row = rows[table];
    if (!row) throw new Error(`Missing producer ledger row: ${table}`);
    if (row.status !== "done") throw new Error(`Producer not done: ${table} (${row.status})`);
    if (row.producer_version !== expected[table]) {
      throw new Error(`Version mismatch: ${table}=${row.producer_version}, expected ${expected[table]}`);
    }
    console.log(`  ${table}: ${row.producer_version}`);
  }
}

async function main({ symbol, tf, days, apply, deleteFirst, verifyOnly }) {
  const client = await pool.connect();
  try {
    const candleTable = getCandleTableForTf(tf);
    const windowResult = await client.query(
      `SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts, COUNT(*)::bigint AS count FROM ${candleTable} WHERE symbol=$1 AND ts >= NOW() - ($2::text || ' days')::interval`,
      [symbol, String(days)]
    );
    const window = windowResult.rows[0];
    const minTs = window.min_ts && new Date(window.min_ts);
    const maxTs = window.max_ts && new Date(window.max_ts);
    const candleCount = Number(window.count || 0);
    if (!minTs || !maxTs || candleCount === 0) {
      console.log(`No candle window for ${symbol} ${tf} (${days} days)`);
      return;
    }

    const running = await client.query(
      `SELECT producer, feature_table, status FROM feature_producer_runs WHERE symbol=$1 AND tf=$2 AND status='running'`,
      [symbol, tf]
    );
    if (running.rows.length) {
      console.table(running.rows);
      throw new Error("Producers currently running");
    }

    console.log(`=== ${symbol} ${tf} | ${candleCount} candles | ${minTs.toISOString()} -> ${maxTs.toISOString()} ===`);
    console.log(`Mode: ${verifyOnly ? "VERIFY-ONLY" : deleteFirst ? "DELETE-THEN-REGENERATE" : "UPSERT"}`);
    console.log("--- Before counts ---");
    for (const table of CAUSAL_FEATURES) console.log(`  ${table}: ${await countRows(client, table, symbol, tf, minTs, maxTs)}`);

    if (verifyOnly) return;

    if (deleteFirst) {
      console.log("--- Deleting target window ---");
      for (const table of CAUSAL_FEATURES) {
        const result = await client.query(`DELETE FROM ${table} WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4`, [symbol, tf, minTs, maxTs]);
        console.log(`  ${table}: deleted ${result.rowCount}`);
      }
    }

    const timestampResult = await client.query(`SELECT ts FROM ${candleTable} WHERE symbol=$1 AND ts >= $2 AND ts <= $3 ORDER BY ts`, [symbol, minTs, maxTs]);
    const timestamps = timestampResult.rows.map((row) => new Date(row.ts));
    const runner = new DAGRunner(pool, globalDAG);
    const started = Date.now();
    for (let index = 0; index < timestamps.length; index++) {
      await runner.run({
        symbol,
        tf,
        endTs: timestamps[index],
        requestedFeatures: CAUSAL_FEATURES,
        lookbackBars: 500,
        skipCache: true,
        skipEventGate: true,
        skipInvariant: true,
        batchInserts: true,
        batchSize: 1000,
        skipLifecycle: true,
      });
      if ((index + 1) % 100 === 0 || index + 1 === timestamps.length) console.log(`  ${index + 1}/${timestamps.length}`);
    }
    await runner.flush();
    console.log(`Regeneration time: ${((Date.now() - started) / 1000).toFixed(1)}s`);

    console.log("--- After counts ---");
    for (const table of CAUSAL_FEATURES) console.log(`  ${table}: ${await countRows(client, table, symbol, tf, minTs, maxTs)}`);
    await verify(client, symbol, tf, minTs, maxTs);
    console.log("--- Producer version verification ---");
    await verifyProducerVersions(client, symbol, tf);
    console.log("Backfill complete and verified");
  } finally {
    client.release();
  }
}

(async () => {
  try {
    await main(parseArgs(process.argv));
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
