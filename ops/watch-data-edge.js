/**
 * watch-data-edge.js — data-edge alerting for monitor-v2-health.ps1
 *
 * Checks:
 *   1. Per active symbol: MAX(candles_1m.ts) age > 10 min while
 *      isTradableInstant(now, symbol) → alert.
 *   2. engine feature_producer_runs: MAX(finished_at) age > 20 min per symbol.
 *   3. No false alerts on weekends, XAU 21:00 daily break, etc.
 *
 * Usage:
 *   node ops/watch-data-edge.js
 *
 * Exit codes:
 *   0  — all edges fresh
 *   1  — one or more data-edge failures
 *
 * Env:
 *   TM_DATABASE_URL       — Postgres connection URL (default: derived from
 *                           TM_DB_HOST/TPORT/NAME/USER/PASSWORD)
 *   DATA_EDGE_MAX_AGE_MIN — max allowed age of latest 1m candle (default 10)
 *   PRODUCER_MAX_AGE_MIN  — max allowed age of engine producer run (default 20)
 */

const { Pool } = require("pg");
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const MAX_AGE_MIN = parseInt(process.env.DATA_EDGE_MAX_AGE_MIN || "10", 10);
const PRODUCER_MAX_AGE_MIN = parseInt(process.env.PRODUCER_MAX_AGE_MIN || "20", 10);

// Inline isTradableInstant logic to avoid depending on TS dist rebuild.
// Mirrors packages/shared/src/utils/marketCalendar.ts
const FX_WEEK_CLOSE_UTC_HOUR = 21;
const DAILY_BREAKS_BY_SYMBOL = {
  XAUUSD: [{ startHourUTC: 21, endHourUTC: 22 }],
};

function inDailyBreak(ts, symbol) {
  if (!symbol) return false;
  const breaks = DAILY_BREAKS_BY_SYMBOL[symbol];
  if (!breaks || breaks.length === 0) return false;
  const minutes = ts.getUTCHours() * 60 + ts.getUTCMinutes();
  for (const b of breaks) {
    const s = b.startHourUTC * 60;
    const e = b.endHourUTC * 60;
    if (s < e) {
      if (minutes >= s && minutes < e) return true;
    } else {
      if (minutes >= s || minutes < e) return true;
    }
  }
  return false;
}

function isTradableInstant(ts, symbol) {
  const dow = ts.getUTCDay();
  const h = ts.getUTCHours();
  if (dow === 6) return false; // Saturday
  if (dow === 0 && h < FX_WEEK_CLOSE_UTC_HOUR) return false; // Sunday before 21:00
  if (dow === 5 && h >= FX_WEEK_CLOSE_UTC_HOUR) return false; // Friday >= 21:00
  if (inDailyBreak(ts, symbol)) return false;
  return true;
}

// Build connection string from env
function getConnectionString() {
  if (process.env.TM_DATABASE_URL) return process.env.TM_DATABASE_URL;
  const host = process.env.TM_DB_HOST || "localhost";
  const port = process.env.TM_DB_PORT || "5432";
  const db = process.env.TM_DB_NAME || "tradzfx_v2";
  const user = process.env.TM_DB_USER || "postgres";
  const password = process.env.TM_DB_PASSWORD || "";
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

async function main() {
  const pool = new Pool({ connectionString: getConnectionString(), max: 2, connectionTimeoutMillis: 5000 });

  const failures = [];
  const notes = [];

  try {
    // Step 1: Get active symbols from strategy_variants
    const activeSymbols = await pool.query(`
      SELECT DISTINCT sv.symbol
      FROM strategy_variants sv
      WHERE sv.is_active = true
      ORDER BY sv.symbol
    `);
    const symbols = activeSymbols.rows.map(r => r.symbol);

    if (symbols.length === 0) {
      notes.push("No active symbols found in strategy_variants");
    }

    // Step 2: Per-symbol candle edge check
    for (const symbol of symbols) {
      const now = new Date();
      if (!isTradableInstant(now, symbol)) {
        notes.push(`SKIP ${symbol}: outside tradable hours (no data expected)`);
        continue;
      }

      const result = await pool.query({
        text: `SELECT MAX(ts) AS last_ts FROM candles_1m WHERE symbol = $1`,
        values: [symbol],
      });
      const lastTs = result.rows[0]?.last_ts;
      if (!lastTs) {
        failures.push(`DATA_EDGE ${symbol}: candles_1m has NO rows`);
        continue;
      }

      const ageMin = (now.getTime() - new Date(lastTs).getTime()) / 60000;
      if (ageMin > MAX_AGE_MIN) {
        failures.push(
          `DATA_EDGE ${symbol}: last candle ${ageMin.toFixed(1)} min old (max ${MAX_AGE_MIN} min)`
        );
      } else {
        notes.push(`DATA_EDGE ${symbol}: ${ageMin.toFixed(1)} min old — OK`);
      }
    }

    // Step 3: Per-symbol feature_producer_runs engine freshness
    for (const symbol of symbols) {
      const now = new Date();
      if (!isTradableInstant(now, symbol)) continue;

      const result = await pool.query({
        text: `
          SELECT MAX(finished_at) AS last_finished
          FROM feature_producer_runs
          WHERE symbol = $1
            AND producer = 'engine'
            AND status = 'done'
        `,
        values: [symbol],
      });
      const lastFinished = result.rows[0]?.last_finished;
      if (!lastFinished) {
        failures.push(`PRODUCER_ENGINE ${symbol}: no completed engine runs found`);
        continue;
      }

      const ageMin = (now.getTime() - new Date(lastFinished).getTime()) / 60000;
      if (ageMin > PRODUCER_MAX_AGE_MIN) {
        failures.push(
          `PRODUCER_ENGINE ${symbol}: last run ${ageMin.toFixed(1)} min old (max ${PRODUCER_MAX_AGE_MIN} min)`
        );
      } else {
        notes.push(`PRODUCER_ENGINE ${symbol}: ${ageMin.toFixed(1)} min old — OK`);
      }
    }
  } finally {
    await pool.end();
  }

  // Output structured for PS1 parser
  for (const f of failures) console.error(`FAIL: ${f}`);
  for (const n of notes) console.log(`NOTE: ${n}`);

  if (failures.length > 0) {
    console.error(`EXIT_FAIL: ${failures.length} data-edge failure(s)`);
    process.exit(1);
  }
  console.log("PASS: all data edges fresh");
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(2);
});
