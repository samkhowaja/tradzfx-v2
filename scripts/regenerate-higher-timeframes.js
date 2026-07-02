/**
 * Regenerate candles_5m/15m/1h/4h/1d_utc/1d_ny from candles_1m.
 * Usage: node scripts/regenerate-higher-timeframes.js [symbol1,symbol2,...]
 * If no symbols provided, regenerates for every symbol present in candles_1m.
 */
const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const TIMEFRAMES = [
  {
    name: "5m",
    table: "candles_5m",
    labelSql: "date_trunc('hour', ts) + interval '5 min' * floor(extract(minute from ts) / 5)",
  },
  {
    name: "15m",
    table: "candles_15m",
    labelSql: "date_trunc('hour', ts) + interval '15 min' * floor(extract(minute from ts) / 15)",
  },
  {
    name: "1h",
    table: "candles_1h",
    labelSql: "date_trunc('hour', ts)",
  },
  {
    name: "4h",
    table: "candles_4h",
    labelSql: "date_trunc('day', ts) + interval '4 hour' * floor(extract(hour from ts) / 4)",
  },
  {
    name: "1d_utc",
    table: "candles_1d_utc",
    labelSql: "date_trunc('day', ts)",
  },
  {
    name: "1d_ny",
    table: "candles_1d_ny",
    labelSql: "date_trunc('day', ts - interval '21 hours') + interval '21 hours'",
  },
];

async function getSymbols(arg) {
  if (arg) return arg.split(",").map((s) => s.trim().toUpperCase());
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol");
  return rows.map((r) => r.symbol);
}

async function regenerate(symbol, tf) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const del = await client.query(`DELETE FROM ${tf.table} WHERE symbol = $1`, [symbol]);

    const sql = `
      INSERT INTO ${tf.table} (symbol, ts, o, h, l, c, v, tick_count)
      WITH labeled AS (
        SELECT
          ${tf.labelSql} AS ts_label,
          o, h, l, c, v,
          row_number() OVER (PARTITION BY ${tf.labelSql} ORDER BY ts ASC) AS rn_asc,
          row_number() OVER (PARTITION BY ${tf.labelSql} ORDER BY ts DESC) AS rn_desc
        FROM candles_1m
        WHERE symbol = $1
      )
      SELECT
        $1 AS symbol,
        ts_label,
        MIN(CASE WHEN rn_asc = 1 THEN o END) AS o,
        MAX(h) AS h,
        MIN(l) AS l,
        MIN(CASE WHEN rn_desc = 1 THEN c END) AS c,
        COALESCE(SUM(v), 0) AS v,
        COUNT(*) AS tick_count
      FROM labeled
      GROUP BY ts_label
      ORDER BY ts_label
    `;
    const ins = await client.query(sql, [symbol]);
    await client.query("COMMIT");
    return { deleted: del.rowCount, inserted: ins.rowCount };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const symbols = await getSymbols(process.argv[2]);
  console.log("Regenerating for symbols:", symbols.join(", "));
  for (const symbol of symbols) {
    console.log(`\n${symbol}:`);
    for (const tf of TIMEFRAMES) {
      const { deleted, inserted } = await regenerate(symbol, tf);
      console.log(`  ${tf.name.padEnd(6)} deleted=${deleted} inserted=${inserted}`);
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
