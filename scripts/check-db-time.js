/**
 * Check the latest candle timestamp in tradzfx_v2 against the current
 * system UTC clock. Run with: node scripts/check-db-time.js [SYMBOL]
 */
const { Pool } = require('pg');

const symbol = process.argv[2] || process.env.SYMBOL || 'XAUUSD';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  const { rows } = await pool.query(
    `SELECT
       $1::text AS symbol,
       MAX(ts) AS last_bar,
       NOW() AS db_now,
       EXTRACT(EPOCH FROM (NOW() - MAX(ts))) / 60.0 AS minutes_behind_now
     FROM candles_1m
     WHERE symbol = $1`,
    [symbol]
  );
  console.table(rows);

  const systemUtc = new Date();
  console.log('System UTC now:', systemUtc.toISOString());

  const row = rows[0];
  if (row && row.last_bar) {
    const diffMin = (systemUtc - new Date(row.last_bar)) / 60000;
    console.log(`System UTC - DB last bar = ${diffMin.toFixed(2)} minutes`);

    const dbNowMin = (systemUtc - new Date(row.db_now)) / 60000;
    console.log(`System UTC - DB NOW()     = ${dbNowMin.toFixed(2)} minutes (clock drift)`);

    if (Math.abs(dbNowMin) > 1) {
      console.log('WARNING: DB NOW() differs from system UTC by more than 1 minute; check PostgreSQL/Windows clock.');
    }
    if (diffMin > 5) {
      console.log('WARNING: data is more than 5 minutes behind system UTC; MT5 feed may be stale.');
    } else if (diffMin < -5) {
      console.log('INFO: DB bar time is ahead of UTC. This usually means MT5 server time is east of UTC (e.g. UTC+2/+3).');
    } else {
      console.log('OK: DB is within 5 minutes of system UTC.');
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
