#!/usr/bin/env node
/** Read-only coverage probe for waqar_v2 required features across FX majors. */
require("dotenv").config({path:require("path").join(__dirname,"..",".env.local"),quiet:true});
const {Pool}=require("pg");
const pool=new Pool({host:process.env.TM_DB_HOST||"localhost",port:+(process.env.TM_DB_PORT||5432),database:process.env.TM_DB_NAME||"tradzfx_v2",user:process.env.TM_DB_USER||"postgres",password:process.env.TM_DB_PASSWORD});
const SYMS=["EURUSD","GBPUSD","AUDUSD","NZDUSD","USDCAD","USDCHF","USDJPY"];
const FEATS=[
 ["candles_1m","SELECT symbol, MIN(ts)::text mn, MAX(ts)::text mx, COUNT(*)::int n FROM market.candles_1m_canonical WHERE symbol=ANY($1) GROUP BY symbol"],
 ["zone_1h","SELECT symbol, MIN(ts)::text mn, MAX(ts)::text mx, COUNT(*)::int n FROM features_zone WHERE symbol=ANY($1) AND tf='1h' GROUP BY symbol"],
 ["zone_1m","SELECT symbol, MIN(ts)::text mn, MAX(ts)::text mx, COUNT(*)::int n FROM features_zone WHERE symbol=ANY($1) AND tf='1m' GROUP BY symbol"],
 ["htf_bias_15m","SELECT symbol, MIN(ts)::text mn, MAX(ts)::text mx, COUNT(*)::int n FROM features_htf_bias WHERE symbol=ANY($1) AND tf='15m' GROUP BY symbol"],
 ["pricing_1h","SELECT symbol, MIN(ts)::text mn, MAX(ts)::text mx, COUNT(*)::int n FROM features_pricing WHERE symbol=ANY($1) AND tf='1h' GROUP BY symbol"],
 ["structure_1m","SELECT symbol, MIN(ts)::text mn, MAX(ts)::text mx, COUNT(*)::int n FROM features_structure WHERE symbol=ANY($1) AND tf='1m' GROUP BY symbol"],
 ["displacement_1m","SELECT symbol, MIN(ts)::text mn, MAX(ts)::text mx, COUNT(*)::int n FROM features_displacement WHERE symbol=ANY($1) AND tf='1m' GROUP BY symbol"],
];
(async()=>{
 for(const [name,sql] of FEATS){
   const {rows}=await pool.query(sql,[SYMS]);
   const have=new Set(rows.map(r=>r.symbol));
   console.log(`\n== ${name} ==  (${rows.length}/${SYMS.length} symbols)`);
   console.table(rows);
   const missing=SYMS.filter(s=>!have.has(s));
   if(missing.length)console.log("MISSING:",missing.join(", "));
 }
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
