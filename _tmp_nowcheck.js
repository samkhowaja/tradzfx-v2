require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST,port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME,user:process.env.TM_DB_USER,password:process.env.TM_DB_PASSWORD});
(async()=>{
  console.log('NOW:',new Date().toISOString());
  
  // Current candles
  let r=await p.query("SELECT symbol, max(ts) as last_ts, count(*) as bars FROM candles_1m WHERE ts >= now() - interval '30 minutes' GROUP BY symbol ORDER BY symbol");
  console.log('CANDLES_1M_30MIN:',JSON.stringify(r.rows,0,2));
  
  r=await p.query("SELECT symbol, max(ts) as last_ts FROM candles_5m WHERE ts >= now() - interval '30 minutes' GROUP BY symbol ORDER BY symbol");
  console.log('CANDLES_5M_30MIN:',JSON.stringify(r.rows,0,2));
  
  // Ingestion server health
  r=await p.query("SELECT max(ts) as last_ingest_ts FROM candles_1m WHERE symbol='EURUSD'");
  console.log('EURUSD_LAST_CANDLE:',r.rows[0]);
  
  r=await p.query("SELECT count(*) FROM candles_1m WHERE symbol='EURUSD' AND ts >= now() - interval '6 hours'");
  console.log('EURUSD_CANDLES_6H:',r.rows[0]);
  
  await p.end();
})();
