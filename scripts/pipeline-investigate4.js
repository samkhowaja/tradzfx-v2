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

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='analysis_signal' ORDER BY ordinal_position`);
  await q(`SELECT * FROM analysis_signal WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 20`, [since]);

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='live_signal' ORDER BY ordinal_position`);
  await q(`SELECT * FROM live_signal WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 20`, [since]);

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='live_order' ORDER BY ordinal_position`);
  await q(`SELECT * FROM live_order WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 20`, [since]);

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='live_fill' ORDER BY ordinal_position`);
  await q(`SELECT * FROM live_fill WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 20`, [since]);

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='live_deployment' ORDER BY ordinal_position`);
  await q(`SELECT * FROM live_deployment`);

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='position_commands' ORDER BY ordinal_position`);
  await q(`SELECT * FROM position_commands WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 20`, [since]);

  await pool.end();
})();
