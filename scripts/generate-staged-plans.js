#!/usr/bin/env node
const fs=require("fs"),path=require("path"),strategies=require("../packages/strategies/dist");
const root=path.join(__dirname,"..","packages","strategies","src","specs");
const plans=[];
for(const file of fs.readdirSync(root).filter(f=>f.endsWith(".yaml")).sort()){
  try{const spec=strategies.loadStrategyFromYaml(path.join(root,file));const plan=strategies.planStagedStrategy(spec);plans.push({file,id:spec.id,active:spec.active!==false,symbols:spec.filters?.symbols||["ALL"],...plan});}
  catch(error){plans.push({file,id:file.replace(/\.yaml$/, ""),active:false,symbols:[],template:"custom",stages:[],blockers:[`load_error:${error.message}`],warnings:[]});}
}
const output={generatedAt:new Date().toISOString(),total:plans.length,replayable:plans.filter(p=>!p.blockers.length).length,blocked:plans.filter(p=>p.blockers.length).length,plans};
const out=path.resolve(process.argv.find(a=>a.startsWith("--out="))?.slice(6)||"reports/staged-causal-plans-2026-07-18.json");fs.writeFileSync(out,JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({output,total:output.total,replayable:output.replayable,blocked:output.blocked},null,2));
console.table(plans.map(p=>({id:p.id,template:p.template,stages:p.stages.length,blockers:p.blockers.join(",")||"none",warnings:p.warnings.length})));
