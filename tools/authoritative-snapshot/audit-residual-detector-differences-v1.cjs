'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AUDIT = 'C:\\Users\\Salman\\AppData\\Local\\Temp\\tradzfx-frozen-audit';
const input = path.join(AUDIT, 'blocker-equivalence-normalized-2026-08-10.v1.json');
const output = path.join(AUDIT, 'residual-detector-differences-2026-08-10.v1.json');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const report = JSON.parse(fs.readFileSync(input, 'utf8'));
const rows = report.added.rows;
const findings = rows.map((row) => ({
  identity: { symbol: row.symbol, broker: row.broker, event_time: row.event_time, flags: row.flags },
  detector: row.detector_version,
  stored_decision_in_fresh_output: row.decision,
  classification: 'UNRESOLVED',
  reason: row.decision === 'EXCLUDE'
    ? 'Fresh output exposes EXCLUDE, but audit policy forbids adopting decisions without independently bound scope/formula/calendar evidence.'
    : 'No independent detector evidence in frozen artifacts proves safe classification.'
}));
const result = {
  schema: 'residual-detector-differences-v1',
  status: 'BLOCKED',
  authority: 'NON_AUTHORITATIVE',
  input: { file: path.basename(input), sha256: sha256(fs.readFileSync(input)) },
  counts: { residual: findings.length, v2_calendar: findings.filter(x => x.detector === 'candle-detector-v2-calendar').length, v3_robust: findings.filter(x => x.detector === 'candle-detector-v3-robust').length },
  findings,
  decision: 'KEEP_BLOCKED_UNKNOWN',
  rationale: ['Detector label alone is not equivalence proof.', 'Stored EXCLUDE is not adopted as a canonical decision.', 'DXY synthetic scope and component-level formula evidence remain unresolved.', 'No source or canonical rows were modified.'],
  freeze_state: report.freeze_state,
  db_writes: 0
};
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ file: output, status: result.status, authority: result.authority, counts: result.counts, decision: result.decision, db_writes: 0 }, null, 2));
