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
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  console.log('Window:', since);

  await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%signal%' OR table_name ILIKE '%live%' OR table_name ILIKE '%analyzer%' OR table_name ILIKE '%stream%' OR table_name ILIKE '%command%' OR table_name ILIKE '%fill%') ORDER BY table_name`);

  await q(`SELECT status, COUNT(*) FROM orders WHERE created_at >= $1 GROUP BY status`, [since]);

  await q(`SELECT status, reject_reason, COUNT(*) FROM orders WHERE created_at >= $1 GROUP BY status, reject_reason ORDER BY COUNT DESC`, [since]);

  await q(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 20`);

  await q(`SELECT * FROM setup_evaluations ORDER BY created_at DESC LIMIT 20`);

  await q(`SELECT id, name, spec_json->'entry' as entry, spec_json->'gates' as gates, spec_json->'filters' as filters, is_active FROM strategy_specs WHERE id IN ('waqar_v2_15m','ninja_turtle','ninja_turtle_scalper','smart_risk_ob_ifvg_1m_runon_15r','xauusd_v1')`);

  await q(`SELECT symbol, tf, MAX(ts) as latest FROM setup_evaluations GROUP BY symbol, tf ORDER BY symbol, tf`);

  await pool.end();
})();
