require('dotenv').config({ path: 'c:\\tradzfx-v2\\.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ host:process.env.TM_DB_HOST||'localhost', port:parseInt(process.env.TM_DB_PORT||'5432'), database:process.env.TM_DB_NAME||'tradzfx_v2', user:process.env.TM_DB_USER||'postgres', password:process.env.TM_DB_PASSWORD });
(async()=>{
  let r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='strategy_variants' ORDER BY ordinal_position");
  console.log('VARIANTS:', r.rows.map(c=>c.column_name).join(', '));
  r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='strategy_families' ORDER BY ordinal_position");
  console.log('FAMILIES:', r.rows.map(c=>c.column_name).join(', '));
  r = await pool.query('SELECT * FROM strategy_families');
  console.log('ALL:', JSON.stringify(r.rows.map(r=>({id:r.id,name:r.name})),0,2));
  r = await pool.query('SELECT id, family_id, is_active FROM strategy_variants WHERE is_active=true ORDER BY id');
  console.log('ACTIVE VARIANTS:', JSON.stringify(r.rows,0,2));
  r = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%signal%' OR table_name LIKE '%trade%' OR table_name LIKE '%order%' OR table_name LIKE '%setup_eval%') ORDER BY table_name");
  console.log('SIG_TRADE_TABLES:', r.rows.map(t=>t.table_name).join(', '));
  await pool.end();
})();
