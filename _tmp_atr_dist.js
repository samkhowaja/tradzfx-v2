require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT, database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD });
(async () => {
  // Find ATR5 values at signal timestamps from the signal SQL
  // The signals join features_atr. Let's query features_atr directly at those timestamps
  // First, find potential signal timestamps from the compiler view
  const r = await p.query(`
    SELECT DISTINCT a.ts, a.value 
    FROM features_atr a 
    WHERE a.symbol = 'XAUUSD' AND a.tf = '5m' AND a.period = 5
      AND a.ts >= '2026-05-02' AND a.ts <= '2026-07-21'
    ORDER BY a.ts
  `);
  console.log('ATR5 rows:', r.rows.length);
  // Show distribution
  const values = r.rows.map(x => Number(x.value) / 0.01);
  const over200 = values.filter(v => v > 200).length;
  const over300 = values.filter(v => v > 300).length;
  const over400 = values.filter(v => v > 400).length;
  console.log(`total: ${values.length}, >200p: ${over200}, >300p: ${over300}, >400p: ${over400}`);
  console.log('min pips:', Math.min(...values).toFixed(1));
  console.log('max pips:', Math.max(...values).toFixed(1));
  console.log('p95 pips:', values.sort((a,b)=>a-b)[Math.floor(values.length*0.95)].toFixed(1));
  
  await p.end();
})();
