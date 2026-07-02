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
    res.rows.forEach((r, i) => {
      console.log(`Row ${i}:`);
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'object' && v !== null) {
          console.log(`  ${k}: ${JSON.stringify(v, null, 2)}`);
        } else {
          console.log(`  ${k}: ${v}`);
        }
      }
    });
    return res.rows;
  } catch (e) {
    console.error(`\n--- ERROR: ${text.split('\n')[0].trim()} ---`);
    console.error(e.message);
    return [];
  }
}

(async () => {
  await q(`SELECT id, jsonb_pretty(spec_json->'gates') as gates, jsonb_pretty(spec_json->'filters') as filters, jsonb_pretty(spec_json->'live') as live, jsonb_pretty(spec_json->'entry') as entry FROM strategy_specs WHERE id='waqar_v2_15m'`);

  await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='features_spread' ORDER BY ordinal_position`);

  await q(`SELECT symbol, tf, ts, value FROM features_spread WHERE ts >= NOW() - INTERVAL '30 minutes' ORDER BY ts DESC LIMIT 30`);

  await q(`SELECT * FROM features_session ORDER BY ts DESC LIMIT 5`);

  await pool.end();
})();
