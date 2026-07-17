/**
 * Drain lifecycle columns for all symbols after a historical feature backfill.
 *
 * The per-table lifecycle refresh functions are checkpointed, so calling them
 * repeatedly with a small lookback window drains the full history in fast
 * increments instead of one massive scan.
 *
 * Usage:
 *   node scripts/drain-lifecycle.js [symbol1,symbol2,...]
 */

require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const { updateLifecycleForSymbol } = require("../apps/engine/dist/index.js");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
  options: `-c statement_timeout=${Number(process.env.TM_LIFECYCLE_DRAIN_STATEMENT_TIMEOUT ?? "30000")}`,
});

async function getSymbols(arg) {
  if (arg && arg !== "all") return arg.split(",").map((s) => s.trim().toUpperCase());
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM market.candles_1m_canonical ORDER BY symbol");
  return rows.map((r) => r.symbol);
}

async function getRange(symbol) {
  const { rows } = await pool.query(
    `SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts FROM market.candles_1m_canonical WHERE symbol = $1`,
    [symbol]
  );
  return {
    minTs: rows[0].min_ts ? new Date(rows[0].min_ts) : null,
    maxTs: rows[0].max_ts ? new Date(rows[0].max_ts) : null,
  };
}

async function tableExists(tableName) {
  const { rows } = await pool.query(
    `SELECT to_regclass($1) AS table_name`,
    [`public.${tableName}`]
  );
  return Boolean(rows[0]?.table_name);
}

async function getLifecycleState(symbol, opts) {
  const rows = [];
  const legacy = await pool.query(
    `SELECT table_name, NULL::text AS tf, last_processed_ts
     FROM lifecycle_refresh_state
     WHERE symbol = $1`,
    [symbol]
  );
  rows.push(...legacy.rows);
  if (opts?.tf && await tableExists("lifecycle_refresh_state_tf")) {
    const tfRows = await pool.query(
      `SELECT table_name, tf, last_processed_ts
       FROM lifecycle_refresh_state_tf
       WHERE symbol = $1 AND tf = $2`,
      [symbol, opts.tf]
    );
    rows.push(...tfRows.rows);
  }
  return new Map(rows.map((r) => [stateKey(r.table_name, r.tf), r.last_processed_ts ? new Date(r.last_processed_ts) : null]));
}

async function refreshTable(symbol, tableName, asOfTs, opts) {
  if (tableName === "features_zone") {
    const { rows } = await pool.query(
      `SELECT refresh_zone_lifecycle($1, $2::timestamptz, make_interval(days => $3), $4, $5, $6) AS rows_updated`,
      [symbol, asOfTs, opts.lookbackDays, opts.limit, opts.tf ?? null, opts.ignoreCheckpoint]
    );
    return [{ tableName, rowsUpdated: Number(rows[0]?.rows_updated ?? 0) }];
  }
  const fnByTable = {
    features_order_block: "refresh_order_block_lifecycle",
    features_ifvg: "refresh_ifvg_lifecycle",
    features_sweep: "refresh_sweep_lifecycle",
    features_structure: "refresh_structure_lifecycle",
  };
  const fn = fnByTable[tableName];
  if (!fn) throw new Error(`Unsupported targeted lifecycle table: ${tableName}`);
  const { rows } = await pool.query(
    `SELECT ${fn}($1, $2::timestamptz, make_interval(days => $3), $4) AS rows_updated`,
    [symbol, asOfTs, opts.lookbackDays, opts.limit]
  );
  return [{ tableName, rowsUpdated: Number(rows[0]?.rows_updated ?? 0) }];
}

function checkpointAdvanced(before, after, tableName) {
  const b = before.get(tableName);
  const a = after.get(tableName);
  if (!a) return false;
  if (!b) return true;
  return a.getTime() > b.getTime();
}

function stateKey(tableName, tf) {
  return tf ? `${tableName}:${tf}` : tableName;
}

function resultStateKey(result, opts) {
  if (result.tableName === "features_zone" && opts.tf) return stateKey(result.tableName, opts.tf);
  return stateKey(result.tableName, null);
}

async function drainSymbol(symbol, asOfTs, opts) {
  let total = 0;
  let iterations = 0;
  let stalledIterations = 0;

  while (true) {
    try {
      const before = await getLifecycleState(symbol, opts);
      const results = opts.table
        ? await refreshTable(symbol, opts.table, asOfTs, opts)
        : await updateLifecycleForSymbol(pool, symbol, {
            asOf: asOfTs,
            lookbackDays: opts.lookbackDays,
            limit: opts.limit,
            ignoreCheckpoint: opts.ignoreCheckpoint,
          });
      const after = await getLifecycleState(symbol, opts);
      const rowsUpdated = results.reduce((s, r) => s + (r.rowsUpdated || 0), 0);
      const advanced = results.filter((r) => checkpointAdvanced(before, after, resultStateKey(r, opts))).map((r) => resultStateKey(r, opts));
      const parts = results.map((r) => {
        const key = resultStateKey(r, opts);
        const beforeTs = before.get(key)?.toISOString() ?? "-";
        const afterTs = after.get(key)?.toISOString() ?? "-";
        const moved = checkpointAdvanced(before, after, key) ? "moved" : "same";
        return `${key}=${r.rowsUpdated || 0}:${moved}:${beforeTs}->${afterTs}`;
      });
      total += rowsUpdated;
      iterations++;
      console.log(`[drain] ${symbol}: iteration ${iterations} | +${rowsUpdated} | advanced=${advanced.join(",") || "-"} | total ${total}`);
      console.log(`        ${parts.join(" | ")}`);
      if (rowsUpdated === 0) break;
      if (advanced.length === 0) {
        stalledIterations++;
        if (stalledIterations >= opts.maxStallIterations) {
          throw new Error(
            `lifecycle drain stalled for ${symbol}: ${stalledIterations} iterations updated rows but no checkpoint advanced`
          );
        }
      } else {
        stalledIterations = 0;
      }
    } catch (err) {
      console.error(`[drain] ${symbol}: error:`, err.message);
      throw err;
    }
  }

  console.log(`[drain] ${symbol}: done | ${total} rows updated in ${iterations} iterations`);
  return total;
}

async function main() {
  const arg = process.argv[2];
  const opts = {
    lookbackDays: Number(process.argv[3] ?? "10"),
    limit: Number(process.argv[4] ?? "5000"),
    maxStallIterations: Number(process.env.TM_LIFECYCLE_MAX_STALL_ITERATIONS ?? "2"),
    ignoreCheckpoint: process.argv.includes("--ignore-checkpoint"),
    table: (process.argv.find((a) => a.startsWith("--table=")) ?? "").slice("--table=".length) || null,
    tf: (process.argv.find((a) => a.startsWith("--tf=")) ?? "").slice("--tf=".length) || null,
  };
  if (!Number.isFinite(opts.lookbackDays) || opts.lookbackDays <= 0) throw new Error("lookbackDays must be positive");
  if (!Number.isFinite(opts.limit) || opts.limit <= 0) throw new Error("limit must be positive");
  const symbols = await getSymbols(arg);
  console.log(`[drain] Symbols: ${symbols.join(", ")}`);
  console.log(`[drain] Options: lookbackDays=${opts.lookbackDays} limit=${opts.limit} ignoreCheckpoint=${opts.ignoreCheckpoint} table=${opts.table ?? "*"} tf=${opts.tf ?? "*"}`);

  let grandTotal = 0;
  for (const symbol of symbols) {
    const { maxTs } = await getRange(symbol);
    if (!maxTs) {
      console.warn(`[drain] ${symbol}: no candle data, skipping`);
      continue;
    }
    console.log(`\n[drain] === ${symbol} | asOf ${maxTs.toISOString()} ===`);
    grandTotal += await drainSymbol(symbol, maxTs, opts);
  }

  console.log(`\n[drain] === ALL DONE === | ${grandTotal} rows updated`);
  await pool.end();
}

main().catch((err) => {
  console.error("[drain] Fatal:", err);
  process.exit(1);
});
