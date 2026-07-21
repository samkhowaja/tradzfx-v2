#!/usr/bin/env node
/** Read-only probe: verify stored pip_size in features_pricing across majors. */
require("dotenv").config({path:require("path").join(__dirname,"..",".env.local"),quiet:true});
const {Pool}=require("pg");
const pool=new Pool({host:process.env.TM_DB_HOST||"localhost",port:+(process.env.TM_DB_PORT||5432),database:process.env.TM_DB_NAME||"tradzfx_v2",user:process.env.TM_DB_USER||"postgres",password:process.env.TM_DB_PASSWORD});
(async()=>{
  const {rows}=await pool.query(`
    SELECT symbol, pip_size, COUNT(*)::int n, MIN(ts)::text mn, MAX(ts)::text mx
    FROM features_pricing
    WHERE symbol IN ('EURUSD','GBPUSD','AUDUSD','NZDUSD','USDCAD','USDCHF','USDJPY','XAUUSD')
    GROUP BY symbol, pip_size
    ORDER BY symbol, n DESC`);
  console.table(rows);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
