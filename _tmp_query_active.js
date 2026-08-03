const { Pool } = require('pg');
const pool = new Pool({ host:'localhost', port:5432, database:'tradzfx_v2', user:'postgres', password:'2k16Dub@i' });
(async()=>{
  const {rows} = await pool.query(`SELECT id, name, is_active, family_id, symbols FROM strategy_variants WHERE is_active = true ORDER BY name`);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
})();
