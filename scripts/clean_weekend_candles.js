const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

async function run() {
  try {
    const fxSymbols = ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK'];
    let totalDeleted = 0;
    
    for (const symbol of fxSymbols) {
      // Delete in small batches to avoid lock issues
      let deleted = 0;
      while (true) {
        const result = await pool.query(`
          DELETE FROM candles_1m
          WHERE symbol = $1
            AND (
              EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 6
              OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 0 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') < 21)
              OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 5 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') >= 21)
            )
            AND ctid IN (
              SELECT ctid
              FROM candles_1m
              WHERE symbol = $1
                AND (
                  EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 6
                  OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 0 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') < 21)
                  OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 5 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') >= 21)
                )
              LIMIT 1000
            )
        `, [symbol]);
        
        if (result.rowCount === 0) break;
        deleted += result.rowCount;
        console.log(`  ${symbol}: deleted ${result.rowCount} (total ${deleted})`);
      }
      console.log(`Completed ${symbol}: ${deleted} rows deleted`);
      totalDeleted += deleted;
    }
    console.log('Total deleted:', totalDeleted);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
run();