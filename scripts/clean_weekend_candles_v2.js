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
    
    // Use a PL/pgSQL function to delete in very small batches
    // This avoids the tuple decompression limit by processing in the database
    await pool.query(`
      CREATE OR REPLACE FUNCTION delete_weekend_fx_candles()
      RETURNS INTEGER AS $$
      DECLARE
        sym TEXT;
        deleted_count INTEGER := 0;
        batch_count INTEGER;
      BEGIN
        FOR sym IN SELECT unnest(ARRAY['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK'])
        LOOP
          LOOP
            DELETE FROM candles_1m
            WHERE ctid IN (
              SELECT ctid
              FROM candles_1m
              WHERE symbol = sym
                AND (
                  EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 6
                  OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 0 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') < 21)
                  OR (EXTRACT(DOW FROM ts AT TIME ZONE 'UTC') = 5 AND EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC') >= 21)
                )
              LIMIT 10
            );
            GET DIAGNOSTICS batch_count = ROW_COUNT;
            deleted_count := deleted_count + batch_count;
            EXIT WHEN batch_count = 0;
          END LOOP;
        END LOOP;
        RETURN deleted_count;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    console.log('Function created, running deletion...');
    const result = await pool.query('SELECT delete_weekend_fx_candles()');
    console.log('Total deleted:', result.rows[0].delete_weekend_fx_candles);
    
    // Clean up
    await pool.query('DROP FUNCTION delete_weekend_fx_candles()');
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
run();