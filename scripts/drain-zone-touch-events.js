/**
 * Drain zone touch/retest analytics into zone_touch_events.
 *
 * This is intentionally separate from refresh_zone_lifecycle(): touch/retest
 * analytics are useful for scoring, but they must never block critical
 * tradability state such as tapped/invalidated.
 *
 * Usage:
 *   node scripts/drain-zone-touch-events.js [symbol1,symbol2,...] [lookbackDays] [limit] [--tf=5m] [--ignore-checkpoint]
 */

require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || "5432"),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
  options: `-c statement_timeout=${Number(process.env.TM_ZONE_TOUCH_DRAIN_STATEMENT_TIMEOUT ?? "30000")}`,
});

async function getSymbols(arg) {
  if (arg && arg !== "all") return arg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol");
  return rows.map((r) => r.symbol);
}

async function getRange(symbol) {
  const { rows } = await pool.query(
    `SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts FROM candles_1m WHERE symbol = $1`,
    [symbol]
  );
  return {
    minTs: rows[0].min_ts ? new Date(rows[0].min_ts) : null,
    maxTs: rows[0].max_ts ? new Date(rows[0].max_ts) : null,
  };
}

async function getState(symbol, tf) {
  const { rows } = await pool.query(
    `SELECT last_processed_ts
     FROM zone_touch_event_refresh_state
     WHERE symbol = $1 AND tf = $2`,
    [symbol, tf ?? "*"]
  );
  return rows[0]?.last_processed_ts ? new Date(rows[0].last_processed_ts) : null;
}

async function refresh(symbol, asOfTs, opts) {
  const { rows } = await pool.query(
    `SELECT * FROM refresh_zone_touch_events($1, $2::timestamptz, make_interval(days => $3), $4, $5, $6)`,
    [symbol, asOfTs, opts.lookbackDays, opts.limit, opts.tf ?? null, opts.ignoreCheckpoint]
  );
  return {
    rowsInserted: Number(rows[0]?.rows_inserted ?? 0),
    zonesUpdated: Number(rows[0]?.zones_updated ?? 0),
  };
}

async function drainSymbol(symbol, asOfTs, opts) {
  let totalInserted = 0;
  let totalZones = 0;
  let iterations = 0;
  let stalled = 0;

  while (true) {
    const before = await getState(symbol, opts.tf);
    const out = await refresh(symbol, asOfTs, opts);
    const after = await getState(symbol, opts.tf);
    const moved = after && (!before || after.getTime() > before.getTime());
    iterations++;
    totalInserted += out.rowsInserted;
    totalZones += out.zonesUpdated;

    console.log(
      `[zone-touch] ${symbol}${opts.tf ? `@${opts.tf}` : ""}: iteration ${iterations} | +events=${out.rowsInserted} | zones=${out.zonesUpdated} | ${moved ? "moved" : "same"}:${before?.toISOString() ?? "-"}->${after?.toISOString() ?? "-"}`
    );

    if (out.zonesUpdated === 0) break;
    if (!moved) {
      stalled++;
      if (stalled >= opts.maxStallIterations) {
        throw new Error(`zone touch drain stalled for ${symbol}${opts.tf ? `@${opts.tf}` : ""}`);
      }
    } else {
      stalled = 0;
    }
  }

  console.log(`[zone-touch] ${symbol}${opts.tf ? `@${opts.tf}` : ""}: done | events=${totalInserted} zones=${totalZones} iterations=${iterations}`);
  return { events: totalInserted, zones: totalZones };
}

async function main() {
  const opts = {
    lookbackDays: Number(process.argv[3] ?? "10"),
    limit: Number(process.argv[4] ?? "500"),
    tf: (process.argv.find((a) => a.startsWith("--tf=")) ?? "").slice("--tf=".length) || null,
    ignoreCheckpoint: process.argv.includes("--ignore-checkpoint"),
    maxStallIterations: Number(process.env.TM_ZONE_TOUCH_MAX_STALL_ITERATIONS ?? "2"),
  };
  if (!Number.isFinite(opts.lookbackDays) || opts.lookbackDays <= 0) throw new Error("lookbackDays must be positive");
  if (!Number.isFinite(opts.limit) || opts.limit <= 0) throw new Error("limit must be positive");

  const symbols = await getSymbols(process.argv[2]);
  console.log(`[zone-touch] Symbols: ${symbols.join(", ")}`);
  console.log(`[zone-touch] Options: lookbackDays=${opts.lookbackDays} limit=${opts.limit} tf=${opts.tf ?? "*"} ignoreCheckpoint=${opts.ignoreCheckpoint}`);

  let events = 0;
  let zones = 0;
  for (const symbol of symbols) {
    const { maxTs } = await getRange(symbol);
    if (!maxTs) {
      console.warn(`[zone-touch] ${symbol}: no candle data, skipping`);
      continue;
    }
    const out = await drainSymbol(symbol, maxTs, opts);
    events += out.events;
    zones += out.zones;
  }

  console.log(`[zone-touch] ALL DONE | events=${events} zones=${zones}`);
  await pool.end();
}

main().catch((err) => {
  console.error("[zone-touch] Fatal:", err);
  pool.end().catch(() => {});
  process.exit(1);
});
