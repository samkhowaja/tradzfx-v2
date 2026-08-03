"use strict";

/**
 * PIT-causal shadow backfill for session/liquidity v2 evidence.
 *
 * Usage:
 *   node scripts/backfill-liquidity-v2.js XAUUSD 5m 120
 *   node scripts/backfill-liquidity-v2.js XAUUSD 5m 120 --lookback=2000 --resume
 *   node scripts/backfill-liquidity-v2.js XAUUSD 5m 120 --start=... --end=...
 *
 * Each DAG run is anchored to candle completion. V2 serializers persist only
 * rows whose knowledge timestamp equals that anchor. Runs are sequential so
 * exact level foreign keys always persist before linked events.
 */

require("dotenv").config({ path: require("node:path").resolve(__dirname, "..", ".env.local") });

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { DAGRunner, globalDAG } = require("../apps/engine/dist/index.js");
const { getCandleTableForTf, getTfMs } = require("../packages/shared/dist/index.js");

const SUPPORTED_TFS = new Set(["1m", "5m", "15m"]);
const FEATURES = ["features_session_range_v2", "features_liquidity_event_v2"];

function option(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function validDate(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is not a valid timestamp: ${value}`);
  return date;
}

function checkpointPath(symbol, tf) {
  return path.resolve(__dirname, "..", "reports", `liquidity-v2-backfill-${symbol}-${tf}.checkpoint.json`);
}

function readCheckpoint(file) {
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return parsed.lastCompletedTs ? validDate(parsed.lastCompletedTs, "checkpoint lastCompletedTs") : null;
}

function writeCheckpoint(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

async function main() {
  const symbol = String(process.argv[2] || "XAUUSD").trim().toUpperCase();
  const tf = String(process.argv[3] || "5m").trim();
  const days = positiveInteger(process.argv[4] || "120", "days");
  if (!/^[A-Z0-9._-]{3,20}$/.test(symbol)) throw new Error(`Unsafe symbol: ${symbol}`);
  if (!SUPPORTED_TFS.has(tf)) throw new Error(`Unsupported tf: ${tf}`);

  const lookbackBars = positiveInteger(option("lookback") || "2000", "lookback");
  const warmupBars = positiveInteger(option("warmup") || String(lookbackBars), "warmup");
  const progressEvery = positiveInteger(option("progress-every") || "250", "progress-every");
  const explicitStart = option("start");
  const explicitEnd = option("end");
  const resume = process.argv.includes("--resume");
  const tfMs = getTfMs(tf);
  const table = getCandleTableForTf(tf);
  const checkpoint = checkpointPath(symbol, tf);

  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
    application_name: "tradzfx-v2-liquidity-v2-backfill",
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  try {
    const edgeResult = await pool.query(`SELECT MAX(ts) AS ts FROM ${table} WHERE symbol = $1`, [symbol]);
    if (!edgeResult.rows[0]?.ts) throw new Error(`No ${symbol} ${tf} candles in ${table}`);
    const dataEdge = new Date(edgeResult.rows[0].ts);
    const endTs = explicitEnd ? validDate(explicitEnd, "end") : new Date(dataEdge.getTime() + tfMs);
    let startTs = explicitStart ? validDate(explicitStart, "start") : new Date(endTs.getTime() - days * 86_400_000);
    if (resume) {
      const last = readCheckpoint(checkpoint);
      if (last && last >= startTs) startTs = new Date(last.getTime() + tfMs);
    }
    if (startTs >= endTs) {
      console.log(`[liquidity-v2-backfill] Nothing to do: ${startTs.toISOString()} >= ${endTs.toISOString()}`);
      return;
    }

    // Bootstrap exact FK lineage by processing enough pre-range anchors for any
    // level referenced by an in-range event. These rows remain valid historical
    // shadow evidence; no synthetic level insertion or nearest-price repair.
    const queryStartTs = resume ? startTs : new Date(startTs.getTime() - warmupBars * tfMs * 2);
    const anchorsResult = await pool.query(
      `SELECT ts + ($4::bigint * interval '1 millisecond') AS anchor_ts
       FROM ${table}
       WHERE symbol = $1 AND ts >= $2 AND ts < $3
       ORDER BY ts`,
      [symbol, new Date(queryStartTs.getTime() - tfMs), new Date(endTs.getTime() - tfMs), tfMs]
    );
    const anchors = anchorsResult.rows.map((row) => new Date(row.anchor_ts));
    console.log(`[liquidity-v2-backfill] ${symbol} ${tf} ${anchors.length} anchors | requested=${startTs.toISOString()} -> ${endTs.toISOString()} | bootstrap=${queryStartTs.toISOString()} | lookback=${lookbackBars}`);
    if (anchors.length === 0) return;

    const runner = new DAGRunner(pool, globalDAG);
    const phases = [
      { name: "levels", features: ["features_session_range_v2", "features_liquidity_level_v2"] },
      { name: "events", features: FEATURES, anchors: anchors.filter(anchor => anchor >= startTs) },
    ];
    let errors = 0;
    for (const phase of phases) {
      const phaseAnchors = phase.anchors || anchors;
      const startedAt = Date.now();
      console.log(`[liquidity-v2-backfill] phase=${phase.name} anchors=${phaseAnchors.length}`);
      for (let i = 0; i < phaseAnchors.length; i++) {
        const anchor = phaseAnchors[i];
        try {
          await runner.run({
            symbol,
            tf,
            endTs: anchor,
            requestedFeatures: phase.features,
            lookbackBars,
            skipCache: true,
            skipEventGate: true,
            skipInvariant: true,
            batchInserts: false,
            skipLifecycle: true,
          });
        } catch (error) {
          errors++;
          console.error(`[liquidity-v2-backfill] phase=${phase.name} ${anchor.toISOString()}: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }

        if ((i + 1) % progressEvery === 0 || i + 1 === phaseAnchors.length) {
          const elapsedMs = Date.now() - startedAt;
          const rate = (i + 1) / Math.max(1, elapsedMs / 1000);
          writeCheckpoint(checkpoint, {
            symbol,
            tf,
            phase: phase.name,
            requestedFeatures: phase.features,
            lookbackBars,
            rangeStart: startTs.toISOString(),
            rangeEnd: endTs.toISOString(),
            lastCompletedTs: anchor.toISOString(),
            processed: i + 1,
            total: phaseAnchors.length,
            errors,
            updatedAt: new Date().toISOString(),
          });
          console.log(`[liquidity-v2-backfill] phase=${phase.name} ${i + 1}/${phaseAnchors.length} | ${rate.toFixed(2)} anchors/s | last=${anchor.toISOString()}`);
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[liquidity-v2-backfill] Fatal: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
