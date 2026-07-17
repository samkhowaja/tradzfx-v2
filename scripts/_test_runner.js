const { globalDAG } = require('../apps/engine/dist/index.js');
const { DAGRunner } = require('../apps/engine/dist/dag/runner.js');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });

async function test() {
  const runner = new DAGRunner(pool, globalDAG);
  
  // Test with a simple job
  try {
    const result = await runner.run({
      symbol: 'EURUSD',
      tf: '5m',
      endTs: new Date('2026-07-03T17:35:00.000Z'),
      requestedFeatures: ['features_pricing', 'features_atr', 'features_bias'],
      lookbackBars: 500,
      batchInserts: true,
      skipLifecycle: true,
    });
    console.log('Result keys:', Object.keys(result));
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

test();