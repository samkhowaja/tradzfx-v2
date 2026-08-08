#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
function stable(v) { if (Array.isArray(v)) return v.map(stable); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])); return v; }
function sha(v) { return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex'); }
const input = process.argv.find((x) => x.startsWith('--report='))?.slice(9);
if (!input) throw new Error('Usage: node scripts/report-xauusd-15m-overlap.cjs --report=reports/...json');
const reportPath = path.resolve(root, input); const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const checks = new Map(report.checks.map((x) => [x.code, new Set((x.affected || []).map((y) => y.identity))]));
const all = [...new Set([...checks.values()].flatMap((x) => [...x]))].sort();
const names = ['NO_INGESTION_RUN_EVIDENCE','OFF_SESSION_PARENT','MISSING_REQUIRED_CHILD','UNKNOWN_QUARANTINE_STATE','CANONICAL_BLOCKER','ATR_EDGE_MISALIGNMENT'];
const cells = {}; for (const a of names) for (const b of names) cells[`${a}&${b}`] = all.filter((id) => checks.get(a)?.has(id) && checks.get(b)?.has(id)).length;
const rows = Array.isArray(report.rows) ? report.rows : [];
const classifications = all.map((identity) => { const flags = Object.fromEntries(names.map((n) => [n, checks.get(n)?.has(identity) || false])); const row = rows.find((x) => x.identity === identity); return { identity, flags, session_state: row?.session_state || null, missing_child_count: row?.missing_child_timestamps?.length || 0, missing_child_timestamps: row?.missing_child_timestamps || [], source_policy_broker: row?.source_policy_broker || null }; });
const output = { report_schema: 'xauusd-15m-overlap-v1', source_report: path.relative(root, reportPath).replaceAll('\\','/'), source_output_fingerprint: report.output_fingerprint, source_input_fingerprint: report.input_fingerprint, generated_at: new Date().toISOString(), counts: Object.fromEntries(names.map((n) => [n, checks.get(n)?.size || 0])), union_count: all.length, overlap_matrix: cells, classifications };
const outPath = path.join(path.dirname(reportPath), `${path.basename(reportPath,'.json')}-overlap.json`); fs.writeFileSync(outPath, Buffer.from(`${JSON.stringify(output,null,2)}\n`,'utf8')); console.log(outPath); console.log(JSON.stringify({counts:output.counts,union_count:output.union_count,overlap_matrix:cells}));
