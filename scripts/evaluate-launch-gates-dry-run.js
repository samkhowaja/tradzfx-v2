#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const exists = (p) => fs.existsSync(path.join(root, p));
const checks = [
  ['detector_v3_1_spec', exists('reports/detector-v3.1-freeze-spec-2026-08-15.md')],
  ['blocker_adjudication_rules', exists('reports/alternate-broker-adjudication-rules-2026-08-15.md')],
  ['structural_hole_ruling', exists('reports/structural-hole-ruling-2026-08-15.md')],
  ['dxy_boundary_ruling', exists('reports/dxy-boundary-ruling-2026-08-15.md')],
  ['parity_plan', exists('reports/parity-harness-plan-2026-08-15.md')],
  ['atr_lineage_authoritative', false],
  ['unresolved_blockers_zero', false],
  ['detector_certified', false],
  ['operator_authorization', false],
];
const blocker = readJson('reports/candle-audit-2026-08-04/blocker-detector-v2-v3-readonly.json');
const result = {
  mode: 'read-only-dry-run',
  generatedAt: new Date().toISOString(),
  sideEffects: { databaseWrites: 0, sourceStateChanges: 0 },
  gates: checks.map(([name, pass]) => ({ name, status: pass ? 'PASS' : 'BLOCKED' })),
  blockerSummary: blocker.summary || blocker.blockers || null,
  decision: { permission: 'INACTIVE', technicalEligibility: 'BLOCKED_UNKNOWN', shadowRun: 'NO_SHADOW_RUN_YET', authority: 'NON_AUTHORITATIVE' },
};
console.log(JSON.stringify(result, null, 2));
