process.env.TM_DB_HOST = 'localhost';
process.env.TM_DB_PORT = '5432';
process.env.TM_DB_NAME = 'tradzfx_v2';
process.env.TM_DB_USER = 'postgres';
process.env.TM_DB_PASSWORD = '2k16Dub@i';
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.TM_DB_HOST,
  port: parseInt(process.env.TM_DB_PORT),
  database: process.env.TM_DB_NAME,
  user: process.env.TM_DB_USER,
  password: process.env.TM_DB_PASSWORD,
});
(async () => {
  const q = [
    "SELECT symbol, ts, value, percentile",
    "FROM features_atr",
    "WHERE tf='1h' AND symbol='XAUUSD' AND ts >= '2026-05-01'",
    "ORDER BY ts DESC LIMIT 100",
  ].join('\n');
  const { rows } = await pool.query(q);
  for (const r of rows) {
    const ts = new Date(r.ts).toISOString();
    console.log(ts, 'atr:', r.value, 'pct:', r.percentile);
  }
  await pool.end();
})();
