const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  const client = await pool.connect();
  try {
    // Delete the 39 incorrect XAUUSD 1m zero ATR rows (engine_ver=1.2.0, value=0)
    const { rowCount } = await client.query(`
      DELETE FROM features_atr
      WHERE symbol = 'XAUUSD'
        AND tf = '1m'
        AND value = 0
        AND engine_ver = '1.2.0'
    `);
    console.log(`Deleted ${rowCount} incorrect XAUUSD 1m zero ATR rows`);

    // Verify final state
    const { rows: zeros } = await client.query(`
      SELECT symbol, tf, period, COUNT(*) as cnt
      FROM features_atr
      WHERE value = 0
      GROUP BY symbol, tf, period
      ORDER BY symbol, tf, period
    `);
    console.log('\n=== Final zero ATR rows ===');
    if (zeros.length === 0) {
      console.log('  NONE — all zero rows removed!');
    } else {
      console.table(zeros);
    }

    // Check constraint violations
    const { rows: chk } = await client.query(`
      SELECT COUNT(*) FILTER (WHERE value = 0) as zero_violations,
             COUNT(*) FILTER (WHERE value IS NULL) as null_violations
      FROM features_atr
    `);
    console.log('\n=== Final constraint check ===');
    console.table(chk);

    // Sentinel rows summary
    const { rows: sentinel } = await client.query(`
      SELECT symbol, tf, period, COUNT(*) as cnt
      FROM features_atr
      WHERE value = 1e-10 AND is_valid = false
      GROUP BY symbol, tf, period
      ORDER BY symbol, tf, period
    `);
    console.log('\n=== Sentinel rows (zero-range, is_valid=false) ===');
    console.table(sentinel);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });