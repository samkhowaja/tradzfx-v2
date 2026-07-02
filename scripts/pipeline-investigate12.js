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
  await q(`SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public' AND tc.table_name IN ('features_pivot','features_structure','features_zone_retest','features_candle_pattern','features_bollinger','features_bias','features_opening_range','features_sweep','features_sma_cross','features_keltner','features_ifvg') ORDER BY tc.table_name, kcu.ordinal_position`);

  await q(`SELECT table_name, constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_schema='public' AND table_name IN ('features_pivot','features_structure') ORDER BY table_name, constraint_name`);

  await pool.end();
})();
