require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT, database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD });
(async () => {
  const sigs = await p.query("SELECT ts,atr_5,side FROM backtest_signals WHERE variant_id=$1 AND symbol=$2 ORDER BY ts LIMIT 20", ['10xroi_v1','XAUUSD']);
  console.log('signals:', sigs.rows.length);
  for (const s of sigs.rows) {
    const pips = s.atr_5 != null ? Number(s.atr_5) / 0.01 : null;
    console.log(s.ts, s.side, 'atr5:', s.atr_5, 'pips:', pips);
  }
  // Check variant gates
  const v = await p.query("SELECT spec->'gates' AS gates FROM strategy_variants WHERE variant_id=$1", ['10xroi_v1']);
  if (v.rows.length > 0) console.log('variant gates:', JSON.stringify(v.rows[0].gates));
  else console.log('no variant');
  await p.end();
})();
