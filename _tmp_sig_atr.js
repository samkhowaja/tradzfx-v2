require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT, database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD });
(async () => {
  const r = await p.query(
    "SELECT ts, side, atr_5 FROM backtest_signals WHERE variant_id=$1 AND symbol=$2 ORDER BY ts",
    ['10xroi_v1', 'XAUUSD']
  );
  console.log('signals:', r.rows.length);
  for (const s of r.rows) {
    const atrPips = s.atr_5 != null ? (Number(s.atr_5) / 0.01) : null;
    const over300 = atrPips != null && atrPips > 300 ? ' *** OVER 300 ***' : '';
    console.log(s.ts, s.side, 'atr5:', s.atr_5, 'pips:', atrPips?.toFixed(1), over300);
  }
  await p.end();
})();
