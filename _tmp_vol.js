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
  // Check market_volatility_profile for XAUUSD
  const r1 = await pool.query(
    "SELECT symbol, tf, period, percentile, value_pips FROM market_volatility_profile WHERE symbol='XAUUSD' ORDER BY tf, period, percentile"
  );
  console.log('=== market_volatility_profile ===');
  for (const rr of r1.rows) {
    console.log(rr.symbol, rr.tf, 'p', rr.period, 'pct', rr.percentile, '=', rr.value_pips, 'pips');
  }

  // Check ATR5 at signal timestamps
  const signalTs = [
    '2026-07-20 00:00:00+00',
    '2026-07-06 00:00:00+00',
    '2026-07-02 00:00:00+00',
    '2026-07-01 00:00:00+00',
    '2026-06-30 00:00:00+00',
  ];
  for (const ts of signalTs) {
    const r2 = await pool.query(
      "SELECT value FROM features_atr WHERE symbol='XAUUSD' AND tf='5m' AND period=5 AND ts <= $1 ORDER BY ts DESC LIMIT 1",
      [ts]
    );
    if (r2.rows.length > 0) {
      console.log(`${ts}: ATR5 = ${r2.rows[0].value}`);
    }
  }
  await pool.end();
})();
