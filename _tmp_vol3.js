const { Pool } = require('pg');
const p = new Pool({ host: 'localhost', port: 5432, database: 'tradzfx_v2', user: 'postgres', password: '2k16Dub@i' });
(async () => {
  const r = await p.query("SELECT DISTINCT tf, period, session, p95 FROM market_volatility_profile WHERE symbol = 'XAUUSD' ORDER BY tf, period, session");
  for (const x of r.rows) console.log(x.tf, 'p' + x.period, x.session, 'p95:', x.p95);
  await p.end();
})();
