#!/usr/bin/env node
/** Read-only dependency coverage probe for ORB research. */
require("dotenv").config({path:require("path").join(__dirname,"..",".env.local"),quiet:true});
const {Pool}=require("pg");
const pool=new Pool({host:process.env.TM_DB_HOST||"localhost",port:+(process.env.TM_DB_PORT||5432),database:process.env.TM_DB_NAME||"tradzfx_v2",user:process.env.TM_DB_USER||"postgres",password:process.env.TM_DB_PASSWORD});
const queries=[
 ["candles","SELECT MIN(ts)::text min_ts, MAX(ts)::text max_ts, COUNT(*)::text count FROM market.candles_1m_canonical WHERE symbol='XAUUSD'"],
 ["opening_range","SELECT MIN(ts)::text min_ts, MAX(ts)::text max_ts, COUNT(*)::text count FROM features_opening_range WHERE symbol='XAUUSD' AND tf='15m' AND session='london' AND range_minutes=15"],
 ["bias","SELECT MIN(ts)::text min_ts, MAX(ts)::text max_ts, COUNT(*)::text count FROM features_bias WHERE symbol='XAUUSD' AND tf='15m'"],
 ["atr","SELECT MIN(ts)::text min_ts, MAX(ts)::text max_ts, COUNT(*)::text count FROM features_atr WHERE symbol='XAUUSD' AND tf='1m'"],
];
(async()=>{const rows=[];for(const [kind,sql] of queries)rows.push({kind,...(await pool.query(sql)).rows[0]});console.table(rows);})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
