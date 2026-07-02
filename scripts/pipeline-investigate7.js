const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.TM_DB_HOST || 'localhost',
  port: parseInt(process.env.TM_DB_PORT || '5432', 10),
  database: process.env.TM_DB_NAME || (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: process.env.TM_DB_USER || 'postgres',
  password: process.env.TM_DB_PASSWORD || process.env.TM_DB_PASSWORD,
  max: 5,
});

async function q(text, params) {
  try {
    const res = await pool.query(text, params);
    console.log(`\n--- ${text.split('\n')[0].trim()} ---`);
    console.table(res.rows);
    return res.rows;
  } catch (e) {
    console.error(`\n--- ERROR: ${text.split('\n')[0].trim()} ---`);
    console.error(e.message);
    return [];
  }
}

(async () => {
  await q(`SELECT symbol, tf, ts, spread, samples FROM features_spread WHERE ts >= NOW() - INTERVAL '30 minutes' ORDER BY ts DESC LIMIT 40`);

  await q(`SELECT symbol, ts, spread FROM candles_1m WHERE ts >= NOW() - INTERVAL '10 minutes' ORDER BY ts DESC LIMIT 40`);

  await pool.end();
})();
