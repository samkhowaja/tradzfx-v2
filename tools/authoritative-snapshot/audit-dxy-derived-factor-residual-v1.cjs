'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = 'C:\\tradzfx-v2';
const AUDIT = 'C:\\Users\\Salman\\AppData\\Local\\Temp\\tradzfx-frozen-audit';
const POLICY_COMMIT = '8f90f518ff1bfcd205398be268c6159e279f62f1';
const TOLERANCE = 0.0005;
const LEG_ORDER = ['EURUSD','USDJPY','GBPUSD','USDCAD','USDSEK','USDCHF'];
const PARAMS = { formula:'dxy-geometric-v1', constant:50.14348112, exponents:{EURUSD:-0.576,USDJPY:0.136,GBPUSD:-0.119,USDCAD:0.091,USDSEK:0.042,USDCHF:0.036}, tolerance:TOLERANCE, leg_order:LEG_ORDER };
const sha256 = x => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const read = n => fs.readFileSync(path.join(AUDIT,n),'utf8');
const residual = JSON.parse(read('residual-detector-differences-2026-08-10.v1.json'));
const evidence = JSON.parse(read('dxy-residual-component-evidence-2026-08-10.v1.json'));
const byTs = new Map(evidence.evidence.map(x => [x.timestamp,x]));
const records = residual.findings.slice().sort((a,b)=>a.identity.event_time.localeCompare(b.identity.event_time)||JSON.stringify(a.identity.flags).localeCompare(JSON.stringify(b.identity.flags))).map((r,i)=>{
  const e=byTs.get(r.identity.event_time); const legs=LEG_ORDER.map(pair=>{const row=e.components.find(x=>x.symbol===pair); return {pair,canonical_row_id:row ? sha256(row).slice(0,24) : null,broker:row?.broker??null,source_key:null,quarantine_decision:'NONE',close:row?.c??null,row_hash:row?sha256(row):null};});
  const formulaInputs=Object.fromEntries(legs.map(x=>[x.pair,x.close]));
  const provenance_hash=sha256({leg_hashes:legs.map(x=>x.row_hash),params:PARAMS});
  return {residual_row_id:sha256(r.identity).slice(0,24),ts_utc:r.identity.event_time,detector_flag:r.identity.flags,legs,utc_alignment:legs.every(x=>x.close!==null)?'ALIGNED':'LEG_MISSING',calendar_class:'UNKNOWN',formula_inputs:formulaInputs,formula_output:e.formula.close,stored_value:null,residual:null,jump_flags:r.identity.flags,detector_version:r.detector,provenance_hash,classification:'UNKNOWN_BLOCKED',classification_reason:'LEG_MISSING_STORED_DXY; stored derived row absent, so residual comparison and calendar-qualified KEEP/EXCLUDE proof unavailable.'};
});
const report={schema:'dxy-derived-factor-residual-audit-v1',mode:'READ_ONLY',formula:PARAMS,policy_commit:POLICY_COMMIT,authority:'NON_AUTHORITATIVE',writes_allowed:0,records,summary:{total_residual_rows:records.length,keep_derived_recommended:0,exclude_derived_recommended:0,unknown_blocked:records.length,locked_rows_status:'KEEP_BLOCKED_UNKNOWN (unchanged)',writes:0,gates:'UNCHANGED'},non_actions:['No retroactive reconstruction of legs or DXY values.','No canonical promotion of DXY.','No DB writes, migrations, gate changes, feature jobs, replay, or execution.'],freeze_state:evidence.freeze_state};
const out=path.join(ROOT,'docs/checkpoints/dxy-residual-audit-dxy-geometric-v1-2026-08-10.md'); const json=path.join(AUDIT,'dxy-residual-audit-dxy-geometric-v1-2026-08-10.v1.json');
const recordSections = records.map((x,i) => [
  `## Residual ${i + 1} — ${x.ts_utc} — ${JSON.stringify(x.detector_flag)}`,
  '',
  `- legs: ${x.legs.length}; formula output: ${x.formula_output}; stored value: absent`,
  `- provenance hash: ${x.provenance_hash}`,
  `- classification: **${x.classification}**`,
  `- reason: ${x.classification_reason}`
].join('\n'));
const lines = [
  '# DXY Residual Audit — dxy-geometric-v1 — 2026-08-10', '', '```text',
  'mode            = READ_ONLY', 'formula         = dxy-geometric-v1',
  'authority       = NON_AUTHORITATIVE', 'writes_allowed  = 0',
  `tolerance       = ${TOLERANCE} (0.05%)`, '```', '',
  `Evidence JSON: ${json}`, '', ...recordSections, '', '## Summary', '',
  ...Object.entries(report.summary).map(([k,v]) => `${k} = ${v}`), '',
  'No state changed. Locked rows remain KEEP_BLOCKED_UNKNOWN.'
];
fs.writeFileSync(json,JSON.stringify(report,null,2)+'\n',{flag:'wx'}); fs.writeFileSync(out,lines.join('\n')+'\n',{flag:'wx'}); console.log(JSON.stringify({artifact:out,json,summary:report.summary},null,2));
