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
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    console.log(`\n--- ${text.split('\n')[0].trim()} (${Date.now() - start}ms) ---`);
    console.table(res.rows);
    return res.rows;
  } catch (e) {
    console.error(`\n--- ERROR: ${text.split('\n')[0].trim()} ---`);
    console.error(e.message);
    return [];
  }
}

(async () => {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // last 6h
  console.log('Investigation window:', since, 'to now');

  await q(`SELECT symbol, MAX(ts) as latest_1m, COUNT(*) as bars_6h FROM candles_1m WHERE ts >= $1 GROUP BY symbol ORDER BY symbol`, [since]);

  await q(`SELECT symbol, tf, MAX(ts) as latest_pricing FROM features_pricing WHERE ts >= $1 GROUP BY symbol, tf ORDER BY symbol, tf`, [since]);

  await q(`SELECT symbol, tf, MAX(ts) as latest_liquidity FROM features_liquidity_pools WHERE ts >= $1 GROUP BY symbol, tf ORDER BY symbol, tf`, [since]);

  await q(`SELECT symbol, tf, MAX(ts) as latest_structure FROM features_structure WHERE ts >= $1 GROUP BY symbol, tf ORDER BY symbol, tf`, [since]);

  await q(`SELECT symbol, MAX(ts) as latest_htf_bias, by_time_frame, COUNT(*) as rows_6h FROM features_htf_bias WHERE ts >= $1 GROUP BY symbol, by_time_frame ORDER BY symbol`, [since]);

  await q(`SELECT id, symbol, strategy_key, side, grade, confidence, state, created_at, filled_at, reject_reason FROM orders WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 50`, [since]);

  await q(`SELECT id, symbol, strategy_key, side, grade, confidence, state, created_at FROM signals WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 50`, [since]);

  await q(`SELECT id, symbol, tf, setup_type, grade, confidence, state, created_at FROM setup_evaluations WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 50`, [since]);

  await q(`SELECT state, COUNT(*) FROM orders WHERE created_at >= $1 GROUP BY state`, [since]);

  await q(`SELECT reject_reason, COUNT(*) FROM orders WHERE created_at >= $1 AND state='rejected' GROUP BY reject_reason ORDER BY COUNT DESC`, [since]);

  await q(`SELECT name, key, spec->'entry' as entry, spec->'gates' as gates, active FROM strategy_specs WHERE key LIKE 'waqar%' OR key LIKE 'ninja%' ORDER BY key`);

  await q(`SELECT COUNT(*) as total FROM zone_outcomes`);

  await pool.end();
})();
