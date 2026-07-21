#!/usr/bin/env node
const fs=require("fs");
const s=process.argv[2]||"GBPUSD";
const file=fs.existsSync(`reports/waqar_v2_${s}_pit_trades_2026-07-19.json`)?`reports/waqar_v2_${s}_pit_trades_2026-07-19.json`:`reports/waqar_v2_${s}_pit_2026-07-19.json`;
const raw=fs.readFileSync(file,"utf16le");
const line=raw.split(/\r?\n/).filter(l=>l.trim().startsWith("{")).pop();
const j=JSON.parse(line);
console.log("file:",file);
console.log("top keys:",Object.keys(j).join(","));
const t=j.trades||j.executedTrades||j.results||j.tradeDetails||j.detail;
console.log("trades type:",Array.isArray(t)?("array len "+t.length):typeof t);
if(Array.isArray(t)&&t.length){
  console.log("sample keys:",Object.keys(t[0]).join(","));
  const key=(x)=>(x.r!=null?x.r:(x.rMultiple!=null?x.rMultiple:0));
  const byR=t.slice().sort((a,b)=>key(b)-key(a)).slice(0,8);
  for(const x of byR){
    console.log(JSON.stringify({ts:x.ts||x.entryTs,side:x.side||x.direction,entry:x.entry??x.entryPrice,sl:x.sl??x.stopLoss,tp:x.tp??x.takeProfit,outcome:x.outcome,r:key(x),close:x.closePrice,hold:x.holdBars,reason:x.reason}));
  }
}
