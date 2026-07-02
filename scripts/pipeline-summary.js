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
  const res = await pool.query(text, params);
  console.log(`\n--- ${text.split('\n')[0].trim()} ---`);
  console.table(res.rows);
}

(async () => {
  console.log('NOW (DB):', (await pool.query('SELECT NOW() as now')).rows[0].now);
  await q(`SELECT symbol, side, ts, entry_price, take_profit, stop_loss, confidence, created_at, gate_trace_run_id IS NOT NULL AS has_trace FROM live_signal WHERE created_at >= NOW() - INTERVAL '6 hours' ORDER BY created_at DESC LIMIT 30`);
  await q(`SELECT symbol, COUNT(*) as signals_6h FROM live_signal WHERE created_at >= NOW() - INTERVAL '6 hours' GROUP BY symbol ORDER BY symbol`);
  await q(`SELECT status, COUNT(*) FROM orders WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY status`);
  await q(`SELECT status, COUNT(*) FROM orders WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY status`);
  await q(`SELECT id, symbol, strategy_id, status, reject_reason, created_at FROM orders WHERE created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 10`);
  await q(`SELECT id, last_seen_at, NOW()-last_seen_at as ago FROM mt5_terminals ORDER BY last_seen_at DESC LIMIT 5`);
  await pool.end();
})();
