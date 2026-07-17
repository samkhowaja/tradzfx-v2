#!/usr/bin/env node
/**
 * Remove feature rows whose dense snapshot timestamp matches neither canonical
 * nor raw candle buckets for its declared timeframe.
 *
 * Dry-run by default. Pass --apply to delete inside one transaction.
 * Sparse/event/session-scoped producers are intentionally excluded.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");

const SYMBOLS = ["AUDUSD", "EURUSD", "GBPUSD", "NZDUSD", "USDCAD", "USDCHF"];
const DENSE_TABLES = [
  "features_atr",
  "features_bias",
  "features_bollinger",
  "features_correlation",
  "features_direction_state",
  "features_displacement",
  "features_htf_bias",
  "features_indicator",
  "features_keltner",
  "features_liquidity_pools",
  "features_moving_average",
  "features_pricing",
  "features_session",
  "features_session_hl",
  "features_spread",
  "features_time_of_day_edge",
];
const CANDLES = {
  "1m": ["market.candles_1m_canonical", "candles_1m"],
  "5m": ["market.candles_5m_canonical", "candles_5m"],
  "15m": ["market.candles_15m_canonical", "candles_15m"],
  "1h": ["market.candles_1h_canonical", "candles_1h"],
  "4h": ["market.candles_4h_canonical", "candles_4h"],
  "1d": ["market.candles_1d_utc_canonical", "candles_1d_utc"],
};

function assertIdentifier(value) {
  if (!/^[a-z_][a-z0-9_.]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
    max: 1,
  });
  const client = await pool.connect();
  const manifest = [];
  try {
    await client.query("SET statement_timeout = '15min'");
    if (apply) await client.query("BEGIN");
    for (const tableName of DENSE_TABLES) {
      const table = assertIdentifier(tableName);
      const validAnchorsSql = Object.entries(CANDLES)
        .flatMap(([tf, candleTables]) => candleTables.map((candleTable) => {
          const source = assertIdentifier(candleTable);
          return `SELECT c.symbol, '${tf}'::text AS tf, c.ts
                    FROM candidates c
                    JOIN ${source} s ON s.symbol = c.symbol AND s.ts = c.ts
                   WHERE c.tf = '${tf}'`;
        }))
        .join("\nUNION\n");
      const invalidCte = `WITH candidates AS MATERIALIZED (
          SELECT f.ctid, f.symbol, f.tf, f.ts
            FROM ${table} f
           WHERE f.symbol = ANY($1) AND f.tf = ANY($2)
        ), valid_anchors AS MATERIALIZED (${validAnchorsSql}),
        invalid AS MATERIALIZED (
          SELECT c.ctid, c.tf, c.ts
            FROM candidates c
            LEFT JOIN valid_anchors v ON v.symbol = c.symbol AND v.tf = c.tf AND v.ts = c.ts
           WHERE v.ts IS NULL
        )`;
      const countResult = await client.query(
        `${invalidCte}
         SELECT tf, count(*)::int AS rows, min(ts) AS first_ts, max(ts) AS last_ts
           FROM invalid GROUP BY tf ORDER BY tf`,
        [SYMBOLS, Object.keys(CANDLES)]
      );
      const items = countResult.rows.map((row) => ({ table, ...row }));
      if (apply && items.length > 0) {
        const backupTable = assertIdentifier(`repair_audit_20260717.${table}`);
        await client.query("CREATE SCHEMA IF NOT EXISTS repair_audit_20260717");
        const exists = await client.query("SELECT to_regclass($1) AS name", [backupTable]);
        if (exists.rows[0].name) throw new Error(`Backup table already exists: ${backupTable}`);
        const backedUp = await client.query(
          `${invalidCte} SELECT f.* INTO ${backupTable} FROM ${table} f JOIN invalid i ON f.ctid = i.ctid`,
          [SYMBOLS, Object.keys(CANDLES)]
        );
        const expected = items.reduce((sum, item) => sum + item.rows, 0);
        if (backedUp.rowCount !== expected) {
          throw new Error(`${table}: manifest ${expected} rows but backed up ${backedUp.rowCount}`);
        }
        const deleted = await client.query(
          `${invalidCte} DELETE FROM ${table} f USING invalid i WHERE f.ctid = i.ctid`,
          [SYMBOLS, Object.keys(CANDLES)]
        );
        if (deleted.rowCount !== expected) {
          throw new Error(`${table}: manifest ${expected} rows but deleted ${deleted.rowCount}`);
        }
        for (const item of items) item.deleted = item.rows;
      }
      manifest.push(...items);
      console.log(`${table}: ${items.reduce((sum, item) => sum + item.rows, 0)} invalid rows`);
    }
    if (apply) await client.query("COMMIT");
    console.table(manifest);
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      symbols: SYMBOLS,
      groups: manifest.length,
      rows: manifest.reduce((sum, item) => sum + item.rows, 0),
      deleted: manifest.reduce((sum, item) => sum + (item.deleted || 0), 0),
    }));
  } catch (error) {
    if (apply) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
