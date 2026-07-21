#!/usr/bin/env node
/** Read-only monthly XAUUSD 1m coverage density probe. */
require("dotenv").config({path:require("path").join(__dirname,"..",".env.local"),quiet:true});
const {Pool}=require("pg");
const pool=new Pool({host:process.env.TM_DB_HOST||"localhost",port:+(process.env.TM_DB_PORT||5432),database:process.env.TM_DB_NAME||"tradzfx_v2",user:process.env.TM_DB_USER||"postgres",password:process.env.TM_DB_PASSWORD});
(async()=>{
  const {rows}=await pool.query(`
    SELECT to_char(date_trunc('month', ts), 'YYYY-MM') AS month,
           COUNT(*)::int AS bars,
           MIN(ts)::text AS first_ts, MAX(ts)::text AS last_ts
    FROM market.candles_1m_canonical
    WHERE symbol='XAUUSD'
    GROUP BY 1 ORDER BY 1`);
  console.table(rows);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
