#!/usr/bin/env node
const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const schema=JSON.parse(fs.readFileSync(path.join(root,'reports/report-schema.json'),'utf8'));
const taxonomy=JSON.parse(fs.readFileSync(path.join(root,'reports/blocker-taxonomy.json'),'utf8'));
const { verifyOutputFingerprint } = require('./report-framework.cjs');
const codes=taxonomy.codes.map(x=>x.code); if(new Set(codes).size!==codes.length) throw new Error('duplicate blocker code');
for(const x of taxonomy.codes) if(!x.code||!x.severity||!x.remediation||!Array.isArray(x.blocks)||!x.blocks.length) throw new Error(`incomplete blocker taxonomy: ${x.code}`);
function validate(r){const req=schema.required; for(const k of req) if(!(k in r)) throw new Error(`missing report field: ${k}`); if(r.schema_version!==schema.properties.schema_version.const) throw new Error('schema version mismatch'); if(!/^[a-f0-9]{64}$/.test(r.input_fingerprint)) throw new Error('invalid input_fingerprint'); if(!/^[a-f0-9]{64}$/.test(r.output_fingerprint)) throw new Error('invalid output_fingerprint'); if(!verifyOutputFingerprint(r)) throw new Error('output_fingerprint mismatch'); if(!['READY','BLOCKED','INCOMPLETE'].includes(r.certification.status)) throw new Error('invalid certification status'); if(r.certification.status==='READY'&&r.certification.blocking_violation_count!==0) throw new Error('fail-closed violation'); return true;}
const file=process.argv[2]; if(file){validate(JSON.parse(fs.readFileSync(file,'utf8'))); console.log(`Validated ${file}`);} else console.log(`Contract and taxonomy valid; ${codes.length} blocker codes`);
