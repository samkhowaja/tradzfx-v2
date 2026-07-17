// Set scalper_20sma_1m to live mode
const { Pool } = require('pg');
const { getDbConfig } = require('./db-config.cjs');

async function main() {
  const pool = new Pool(getDbConfig());

  await pool.query(
    `UPDATE strategy_variants SET overrides = '{"live": {"mode": "live"}}'::jsonb WHERE id = 'scalper_20sma_1m'`
  );
  
  const { rows } = await pool.query(
    `SELECT id, is_active, overrides->'live'->>'mode' AS mode FROM strategy_variants WHERE id = 'scalper_20sma_1m'`
  );
  console.log('Result:', JSON.stringify(rows[0], null, 2));
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
