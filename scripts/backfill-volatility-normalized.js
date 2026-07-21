#!/usr/bin/env node
/** PIT-safe, read-only-source backfill for features_volatility_normalized. */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const {
  getCandleTableForTf,
  getRegistryPipSize,
  getSession,
  sha256,
} = require("../packages/shared/dist/index.js");

const WINDOW_SIZE = 1000;
const MIN_SAMPLE_COUNT = 100;
const VERSION = "1.0.0";
const PERIOD = 5;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function regime(rank) {
  if (rank < 0.05) return "extreme_low";
  if (rank < 0.25) return "low";
  if (rank < 0.75) return "normal";
  if (rank < 0.95) return "high";
  return "extreme_high";
}

async function main() {
  const symbol = (process.argv[2] || "XAUUSD").toUpperCase();
  const tf = process.argv[3] || "5m";
  const days = Number(process.argv[4] || 90);
  if (!Number.isFinite(days) || days <= 0) throw new Error(`Invalid days: ${process.argv[4]}`);

  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
    max: 2,
  });

  const candleTable = getCandleTableForTf(tf);
  const pipSize = getRegistryPipSize(symbol);
  const edgeResult = await pool.query(
    `SELECT MAX(ts) edge FROM ${candleTable} WHERE symbol=$1`, [symbol]
  );
  const edge = edgeResult.rows[0]?.edge;
  if (!edge) throw new Error(`No canonical ${tf} candles for ${symbol}`);
  const start = new Date(new Date(edge).getTime() - days * 86400000);
  const sourceStart = new Date(start.getTime() - days * 86400000);

  const { rows } = await pool.query(
    `SELECT a.ts, a.value, COALESCE(a.effective_value,a.value) effective_value,
            a.engine_ver source_atr_engine_ver, c.c close_price
       FROM features_atr a
       JOIN ${candleTable} c ON c.symbol=a.symbol AND c.ts=a.ts
      WHERE a.symbol=$1 AND a.tf=$2 AND a.period=$3
        AND a.ts >= $4 AND a.ts <= $5
        AND a.value > 0 AND COALESCE(a.effective_value,a.value) > 0
      ORDER BY a.ts`,
    [symbol, tf, PERIOD, sourceStart, edge]
  );

  const history = new Map();
  const output = [];
  for (const row of rows) {
    const ts = new Date(row.ts);
    const session = getSession(ts.getUTCHours());
    const values = history.get(session) || [];
    const effective = Number(row.effective_value);
    values.push({ ts, effective });
    if (values.length > WINDOW_SIZE) values.shift();
    history.set(session, values);
    if (ts < start) continue;

    const atrPips = effective / pipSize;
    const logs = values.map((item) => Math.log(item.effective / pipSize));
    const current = Math.log(atrPips);
    const med = median(logs);
    const mad = median(logs.map((value) => Math.abs(value - med)));
    const rank = logs.filter((value) => value <= current).length / logs.length;
    const valid = logs.length >= MIN_SAMPLE_COUNT;
    const inputHash = `${VERSION}:${sha256(`${symbol}:${tf}:${ts.toISOString()}:${row.value}:${effective}:${row.close_price}:${session}:${values[0].ts.toISOString()}:${values.length}`)}`;
    output.push([
      symbol, tf, ts, PERIOD, session, Number(row.value), effective, pipSize,
      Number(row.close_price), atrPips, 10000 * effective / Number(row.close_price),
      rank, mad > 0 ? 0.67448975 * (current - med) / mad : 0, regime(rank),
      logs.length, values[0].ts, row.source_atr_engine_ver, valid,
      valid ? (mad === 0 ? "zero_mad" : null) : "warmup", VERSION, inputHash,
    ]);
  }

  const columns = ["symbol","tf","ts","period","session","atr_raw","atr_effective","pip_size","close_price","atr_pips","atr_bps","percentile_rank","robust_z","regime","sample_count","sample_start","source_atr_engine_ver","is_valid","quality_reason","engine_ver","input_hash"];
  let inserted = 0;
  for (let offset = 0; offset < output.length; offset += 500) {
    const batch = output.slice(offset, offset + 500);
    const params = batch.flat();
    const tuples = batch.map((_, rowIndex) =>
      `(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(",")})`
    ).join(",");
    await pool.query(
      `INSERT INTO features_volatility_normalized (${columns.join(",")}) VALUES ${tuples}
       ON CONFLICT (symbol,tf,period,session,ts) DO UPDATE SET
         atr_raw=EXCLUDED.atr_raw, atr_effective=EXCLUDED.atr_effective,
         pip_size=EXCLUDED.pip_size, close_price=EXCLUDED.close_price,
         atr_pips=EXCLUDED.atr_pips, atr_bps=EXCLUDED.atr_bps,
         percentile_rank=EXCLUDED.percentile_rank, robust_z=EXCLUDED.robust_z,
         regime=EXCLUDED.regime, sample_count=EXCLUDED.sample_count,
         sample_start=EXCLUDED.sample_start,
         source_atr_engine_ver=EXCLUDED.source_atr_engine_ver,
         is_valid=EXCLUDED.is_valid, quality_reason=EXCLUDED.quality_reason,
         engine_ver=EXCLUDED.engine_ver, input_hash=EXCLUDED.input_hash`,
      params
    );
    inserted += batch.length;
  }

  const sourceMinTs = rows[0]?.ts || start;
  const sourceMaxTs = rows[rows.length - 1]?.ts || edge;
  await pool.query(
    `INSERT INTO feature_producer_runs
      (producer,feature_table,symbol,tf,source_min_ts,source_max_ts,rows_seen,
       rows_inserted,started_at,finished_at,status,producer_version,watermark_ts,quality_json)
     VALUES ('historical_backfill','features_volatility_normalized',$1,$2,$3,$4,$5,$6,
       NOW(),NOW(),'done',$7,$4,$8::jsonb)`,
    [symbol, tf, sourceMinTs, sourceMaxTs, rows.length, inserted, VERSION,
      JSON.stringify({ rows_seen: rows.length, rows_attempted: output.length, rows_inserted: inserted, rows_rejected: 0, warmup_rows: output.filter((r) => !r[17]).length })]
  );

  console.log(JSON.stringify({ symbol, tf, days, sourceRows: rows.length, inserted, start, edge, sourceMaxTs }, null, 2));
  await pool.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
