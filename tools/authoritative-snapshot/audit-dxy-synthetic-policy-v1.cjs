'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = 'C:\\tradzfx-v2';
const AUDIT = 'C:\\Users\\Salman\\AppData\\Local\\Temp\\tradzfx-frozen-audit';
const diffFile = path.join(AUDIT, 'blocker-equivalence-normalized-2026-08-10.v1.json');
const outputFile = path.join(AUDIT, 'dxy-synthetic-policy-audit-2026-08-10.v1.json');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const text = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const diff = read(diffFile);
const sources = {
  formula: 'scripts/backfill-dxy-synthetic.js',
  live_generator: 'scripts/run-dxy-synthetic-cron.js',
  detector: 'scripts/freeze-detector-v3-dated.js',
  detector_v4: 'scripts/freeze-detector-v4-calibrated.js',
  policy_evidence: 'scripts/certify-trusted-windows.js',
  anomaly_report: 'PER_PAIR_ANOMALY_REPORT.md'
};
const sourceHashes = Object.fromEntries(Object.entries(sources).map(([name, file]) => [name, { file, sha256: sha256(text(file)) }]));
const addedDxy = diff.added.rows.filter((row) => row.symbol === 'DXY' && row.broker === 'synthetic');
const formulaRulesPresent = text(sources.formula).includes('50.14348112') && text(sources.formula).includes('EURUSD') && text(sources.formula).includes('USDCHF');
const policyRulesPresent = text(sources.policy_evidence).includes('boundary candidate >=2 components @0.1%') && text(sources.policy_evidence).includes('deviates >0.5% from formula');
const report = {
  schema: 'dxy-synthetic-policy-audit-v1', status: 'BLOCKED', authority: 'NON_AUTHORITATIVE',
  decision: 'KEEP_BLOCKED_UNKNOWN',
  policy: { series: 'DXY', broker: 'synthetic', construction: 'formula-derived from six FX components', constant: 50.14348112, components: ['EURUSD','USDJPY','GBPUSD','USDCAD','USDSEK','USDCHF'], boundary_candidate: 'at least two components move >= 0.1%', unresolved_rule: 'DXY row present and formula deviation > 0.5%', no_source_mutation: true },
  evidence: { source_hashes: sourceHashes, formula_rules_present: formulaRulesPresent, policy_rules_present: policyRulesPresent, anomaly_report_says_zero_volume_and_not_live_feed: text(sources.anomaly_report).includes('ZERO volume') && text(sources.anomaly_report).includes('not production-ready') },
  residual_rows: { count: addedDxy.length, rows: addedDxy, classification: 'UNRESOLVED_SYNTHETIC_SCOPE' },
  rationale: ['DXY is synthetic, not broker-feed evidence.', 'Existing policy defines formula and unresolved boundary criteria.', 'Available evidence does not prove these three rows are safe to exclude or keep.', 'Fail closed: retain UNKNOWN blocker status.'],
  freeze_state: diff.freeze_state, db_writes: 0
};
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ file: outputFile, status: report.status, authority: report.authority, decision: report.decision, residual_dxy: addedDxy.length, db_writes: 0 }, null, 2));
