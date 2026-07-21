const { Pool } = require('pg');
require('dotenv').config({path:'.env.local'});
const pool = new Pool({
  host: process.env.TM_DB_HOST || 'localhost',
  port: +(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: process.env.TM_DB_USER || 'postgres',
  password: process.env.TM_DB_PASSWORD
});
pool.query(`SELECT id, version, spec_json->'risk' as risk, spec_json->'signalSource' as sigsrc, spec_json->>'entryType' as etype FROM strategy_specs WHERE id='watukushay_no1'`)
  .then(r => {
    console.log(JSON.stringify(r.rows[0], null, 2));
    pool.end();
  })
  .catch(e => { console.error(e); pool.end(); });
