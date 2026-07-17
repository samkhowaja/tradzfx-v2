require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{
  let r=await p.query("SELECT * FROM setup_evaluations LIMIT 1");
  console.log('SETUP_EVALS sample:',JSON.stringify(r.rows[0],0,2));
  console.log('SETUP_EVALS keys:',Object.keys(r.rows[0]||{}).join(', '));
  
  r=await p.query("SELECT count(*) as c FROM setup_evaluations");
  console.log('TOTAL_EVALS:',r.rows[0].c);
  
  r=await p.query("SELECT max(created_at) as last_ts FROM setup_evaluations");
  console.log('LAST_EVAL:',r.rows[0].last_ts);
  
  r=await p.query("SELECT count(*) as c FROM setup_evaluations WHERE created_at >= now() - interval '24 hours'");
  console.log('TOTAL_EVALS:',r.rows[0].c);
  
  r=await p.query("SELECT max(created_at) as last_ts FROM setup_evaluations");
  console.log('LAST_EVAL:',r.rows[0].last_ts);
  
  r=await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%deploy%' ORDER BY table_name");
  console.log('DEPLOY_TABLES:',r.rows.map(t=>t.table_name).join(', '));
  
  await p.end();
})();
