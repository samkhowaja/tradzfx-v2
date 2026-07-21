#!/usr/bin/env node
/** Disabled-by-default scheduler for shadow-only causal ORB evaluation. */
const {spawn}=require("child_process"),path=require("path");
const enabled=String(process.env.ORB_CAUSAL_SHADOW_ENABLED||"false").toLowerCase()==="true";
const interval=Math.max(60000,parseInt(process.env.ORB_CAUSAL_SHADOW_INTERVAL_MS||"60000",10));
const script=path.join(__dirname,"orb-causal-shadow.js"),reportScript=path.join(__dirname,"report-orb-causal-shadow.js");let running=false,lastReportHour=null;
function utcHourKey(date=new Date()){return date.toISOString().slice(0,13)}
function runReport(date=new Date()){const hour=utcHourKey(date);if(hour===lastReportHour)return;lastReportHour=hour;const child=spawn(process.execPath,[reportScript,`--date=${date.toISOString().slice(0,10)}`],{cwd:path.join(__dirname,".."),env:process.env,stdio:"inherit"});child.on("close",code=>{if(code){lastReportHour=null;console.error(`[orb-causal-shadow-cron] report exit=${code}`)}});child.on("error",err=>{lastReportHour=null;console.error("[orb-causal-shadow-cron] report spawn failed",err)})}
function runOnce(){if(running)return;running=true;const child=spawn(process.execPath,[script],{cwd:path.join(__dirname,".."),env:process.env,stdio:"inherit"});child.on("close",code=>{running=false;if(code)console.error(`[orb-causal-shadow-cron] evaluator exit=${code}`);else runReport()});child.on("error",err=>{running=false;console.error("[orb-causal-shadow-cron] spawn failed",err)})}
function main(){if(!enabled){console.log("[orb-causal-shadow-cron] disabled; set ORB_CAUSAL_SHADOW_ENABLED=true to collect shadow evidence");return}console.log(`[orb-causal-shadow-cron] enabled interval=${interval}ms; shadow-only, no order path`);runOnce();setInterval(runOnce,interval)}
module.exports={utcHourKey};
if(require.main===module)main();
