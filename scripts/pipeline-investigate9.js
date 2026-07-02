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
  // analysis_signal columns: no created_at; use ts
  await q(`SELECT * FROM analysis_signal WHERE ts >= NOW() - INTERVAL '6 hours' ORDER BY ts DESC LIMIT 20`);

  // terminal heartbeat
  await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%terminal%' OR table_name ILIKE '%heartbeat%' OR table_name ILIKE '%mt5%') ORDER BY table_name`);

  // feature_cache stats
  await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='feature_cache'`);

  await q(`SELECT feature_name, tf, COUNT(*) as rows FROM feature_cache WHERE ts >= NOW() - INTERVAL '2 hours' GROUP BY feature_name, tf ORDER BY feature_name, tf`);

  await q(`SELECT * FROM feature_cache WHERE feature_name='features_pricing' AND ts >= NOW() - INTERVAL '1 hour' ORDER BY ts DESC LIMIT 5`);

  await pool.end();
})();
