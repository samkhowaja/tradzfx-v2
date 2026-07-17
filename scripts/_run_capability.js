const { collectCapabilityMatrix } = require('./feature-capability.js');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });

(async () => {
  try {
    const matrix = await collectCapabilityMatrix(pool, {
      symbols: ['EURUSD'],
      tfs: ['5m'],
      from: new Date('2026-04-14'),
      to: new Date('2026-07-13'),
      producerMaxAgeHours: 2,
      lifecycleMaxAgeHours: 2,
    });
    
    // Filter for pricing, atr, bias
    const relevant = matrix.rows.filter(r => 
      ['features_pricing', 'features_atr', 'features_bias'].includes(r.table) && r.symbol === 'EURUSD' && r.tf === '5m'
    );
    
    console.table(relevant.map(r => ({
      feature: r.feature,
      table: r.table,
      tf: r.tf,
      verdict: r.verdict,
      producerAgeHours: r.producerAgeHours,
      producerMaxAgeHours: r.producerMaxAgeHours,
      producerFinishedAt: r.producerFinishedAt,
      producerWatermarkTs: r.producerWatermarkTs,
      latestAgeHours: r.latestAgeHours,
      maxFreshnessMinutes: r.maxFreshnessMinutes,
      rows90d: r.rows90d,
    })));
  } finally {
    await pool.end();
  }
})();