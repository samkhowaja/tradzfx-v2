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

  await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('orders','signals','trade_signals','setup_evaluations','strategy_specs','zone_outcomes','candles_1m') ORDER BY table_name`);

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' ORDER BY ordinal_position`);

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='setup_evaluations' ORDER BY ordinal_position`);

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='strategy_specs' ORDER BY ordinal_position`);

  await q(`SELECT * FROM orders WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 20`, [since]);

  await q(`SELECT * FROM setup_evaluations WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 20`, [since]);

  await q(`SELECT * FROM strategy_specs ORDER BY id`);

  await pool.end();
})();
