#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const strategies = require("../packages/strategies/dist");

const ROOT = path.join(__dirname, "..", "packages", "strategies", "src", "specs");
const STRUCTURE = new Set(["features_structure"]);
const ZONES = new Set(["features_zone", "features_fvg", "features_ifvg", "features_order_block", "features_breaker_block"]);
const CONTEXT = new Set(["features_direction_state", "features_bias", "features_htf_bias"]);
const ENTRY_EVENT = new Set(["features_structure", "features_displacement", "features_sweep"]);

function required(spec, stage) { return (spec[stage] || []).filter((condition) => condition.required !== false); }
function classify(spec) {
  const setup = required(spec,"setup"), entry = required(spec,"entry"), all=[...setup,...entry];
  const features=[...new Set(all.map((condition)=>condition.feature))];
  const setupStructures=setup.filter((condition)=>STRUCTURE.has(condition.feature));
  const entryEvents=entry.filter((condition)=>ENTRY_EVENT.has(condition.feature));
  const zones=all.filter((condition)=>ZONES.has(condition.feature));
  const contexts=setup.filter((condition)=>CONTEXT.has(condition.feature));
  let template="unsupported", status="BLOCKED_MAPPING";
  if(spec.staged?.enabled) { template="declared_staged"; status="READY"; }
  else if(spec.signalSource==="orb" || features.includes("features_opening_range")) template="orb_breakout";
  else if(spec.signalSource==="moving_average" || features.includes("features_moving_average")) template="trend_cross";
  else if(spec.signalSource==="indicator" || features.some((feature)=>["features_rsi","features_macd","features_bollinger"].includes(feature))) template="indicator_trigger";
  else if(features.includes("features_sweep")) template="liquidity_sweep_reversal";
  else if(zones.length && setupStructures.length && entryEvents.length) template="zone_setup_entry";
  else if(zones.length && entryEvents.length) template="zone_entry";
  else if(setupStructures.length && entryEvents.length) template="structure_continuation";
  const blockers=[];
  if(status!=="READY") blockers.push(`staged template '${template}' not implemented`);
  if(!contexts.length) blockers.push("no explicit directional context condition");
  if(!entryEvents.length && !["trend_cross","indicator_trigger","orb_breakout"].includes(template)) blockers.push("no causal entry event condition");
  return { template,status,features,contexts:contexts.map(c=>`${c.feature}@${c.tf}`),setupEvents:setupStructures.map(c=>`${c.feature}@${c.tf}`),zones:zones.map(c=>`${c.feature}@${c.tf}`),entryEvents:entryEvents.map(c=>`${c.feature}@${c.tf}`),blockers };
}

const rows=[];
for(const file of fs.readdirSync(ROOT).filter((name)=>name.endsWith(".yaml")).sort()) {
  try {
    const spec=strategies.loadStrategyFromYaml(path.join(ROOT,file));
    const validation=strategies.validateSpec(spec);
    rows.push({file,id:spec.id,familyId:spec.familyId||spec.id,active:spec.active!==false,signalSource:spec.signalSource||"zone",symbols:(spec.filters?.symbols||[]).join(",")||"ALL",...classify(spec),validationErrors:validation});
  } catch(error) { rows.push({file,id:file.replace(/\.yaml$/, ""),status:"BLOCKED_LOAD",blockers:[error.message],validationErrors:[]}); }
}
const summary={generatedAt:new Date().toISOString(),total:rows.length,ready:rows.filter(r=>r.status==="READY").length,blocked:rows.filter(r=>r.status!=="READY").length,byTemplate:Object.fromEntries([...new Set(rows.map(r=>r.template||"load_error"))].map(t=>[t,rows.filter(r=>(r.template||"load_error")===t).length])),rows};
const out=process.argv.find(a=>a.startsWith("--out="))?.slice(6);
if(out) fs.writeFileSync(path.resolve(out),JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify({total:summary.total,ready:summary.ready,blocked:summary.blocked,byTemplate:summary.byTemplate},null,2));
console.table(rows.map(r=>({id:r.id,active:r.active,template:r.template,status:r.status,symbols:r.symbols})));
if(rows.some(r=>r.status==="BLOCKED_LOAD")) process.exitCode=2;
