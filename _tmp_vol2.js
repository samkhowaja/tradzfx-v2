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
  const r = await pool.query(
    "SELECT symbol, tf, period, session, p95 FROM market_volatility_profile WHERE symbol = 'XAUUSD' ORDER BY tf, period, session"
  );
  console.log('rows:', r.rows.length);
  for (const rr of r.rows) console.log(rr.symbol, rr.tf, 'p' + rr.period, rr.session, 'p95:', rr.p95);

  // Check actual ATR5 at a signal timestamp
  const r2 = await pool.query(
    "SELECT value FROM features_atr WHERE symbol = 'XAUUSD' AND tf = '5m' AND period = 5 AND ts <= '2026-07-20 00:00:00+00' ORDER BY ts DESC LIMIT 1"
  );
  console.log('ATR5 at 2026-07-20:', r2.rows[0]?.value);

  await pool.end();
})();
