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
  await q(`SELECT symbol, ts, session, utc_hour FROM features_session WHERE ts >= NOW() - INTERVAL '1 hour' ORDER BY ts DESC LIMIT 20`);

  await q(`SELECT symbol, ts, spread_pips FROM features_spread WHERE ts >= NOW() - INTERVAL '1 hour' ORDER BY ts DESC LIMIT 20`);

  await q(`SELECT symbol, tf, ts, value FROM features_atr WHERE ts >= NOW() - INTERVAL '1 hour' ORDER BY ts DESC LIMIT 20`);

  await q(`SELECT symbol, ts, position, in_ote, ote_low, ote_high FROM features_pricing WHERE ts >= NOW() - INTERVAL '1 hour' ORDER BY ts DESC LIMIT 20`);

  await q(`SELECT id, spec_json->'gates' as gates, spec_json->'filters' as filters, spec_json->'live' as live, spec_json->'entry' as entry FROM strategy_specs WHERE id='waqar_v2_15m'`);

  await q(`SELECT id, spec_json->'gates' as gates, spec_json->'filters' as filters, spec_json->'live' as live FROM strategy_specs WHERE id='ninja_turtle_scalper' OR id='ninja_turtle'`);

  await pool.end();
})();
