const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', database: 'tradzfx_v2', user: 'postgres', password: '2k16Dub@i' });

pool.query(`SELECT id, is_active, overrides->'live'->>'mode' AS mode, family_id 
  FROM strategy_variants WHERE is_active = true ORDER BY id`)
  .then(r => {
    r.rows.forEach(row => console.log(row.id, '| active:', row.is_active, '| mode:', row.mode, '| family:', row.family_id));
    pool.end();
  });
