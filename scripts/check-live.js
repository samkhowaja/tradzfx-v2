const { Pool } = require('pg');
const { getDbConfig } = require('./db-config.cjs');
const pool = new Pool(getDbConfig());

pool.query(`SELECT id, is_active, overrides->'live'->>'mode' AS mode, family_id 
  FROM strategy_variants WHERE is_active = true ORDER BY id`)
  .then(r => {
    r.rows.forEach(row => console.log(row.id, '| active:', row.is_active, '| mode:', row.mode, '| family:', row.family_id));
    pool.end();
  });
