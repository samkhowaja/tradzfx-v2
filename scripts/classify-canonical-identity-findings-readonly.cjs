#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const integrity = JSON.parse(fs.readFileSync(path.join(root, 'reports/canonical-identity-integrity-2026-08-15/integrity.json')));
const reconciliation = JSON.parse(fs.readFileSync(path.join(root, 'reports/canonical-blocker-reconciliation-2026-08-15.json')));
const category = (kind) => ({
  MULTIPLE_ACTIVE_EVIDENCE_ROWS: 'MULTIPLE_ACTIVE_EVIDENCE',
  MISSING_SOURCE_KEY: 'MISSING_RAW_HASH_CONTRACT',
  SOURCE_KEY_MISMATCH: 'MISSING_RAW_HASH_CONTRACT',
  MISSING_DETECTOR_VERSION: 'NO_DECISION_DIFF',
  CONFLICTING_DECISIONS: 'UNRESOLVED_REPLACEMENT',
  REPLACEMENT_EVIDENCE_GAP: 'UNRESOLVED_REPLACEMENT',
}[kind] || 'UNCLASSIFIED');
const byIdentity = new Map();
for (const f of integrity.findings) {
  const x = byIdentity.get(f.identity_key) || { identity_key: f.identity_key, categories: [], findings: [] };
  x.categories.push(category(f.kind)); x.findings.push({ kind: f.kind, detail: f.detail }); byIdentity.set(f.identity_key, x);
}
for (const x of byIdentity.values()) x.categories = [...new Set(x.categories)].sort();
const report = {
  schema: 'canonical-identity-finding-classification-readonly-v1',
  authority: 'NON_AUTHORITATIVE',
  source_hashes: {
    integrity: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'reports/canonical-identity-integrity-2026-08-15/integrity.json'))).digest('hex'),
    reconciliation: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'reports/canonical-blocker-reconciliation-2026-08-15.json'))).digest('hex'),
  },
  accounting: { database_writes: 0, source_state_changes: 0, artifact_writes: 2 },
  population: { findings: integrity.findings.length, affected_identities: byIdentity.size, active_rows: reconciliation.observed_population.active_rows, active_identities: reconciliation.observed_population.active_identities },
  category_counts: Object.fromEntries([...new Set(integrity.findings.map(f => category(f.kind)))].sort().map(c => [c, [...byIdentity.values()].filter(x => x.categories.includes(c)).length])),
  identities: [...byIdentity.values()].sort((a,b) => a.identity_key.localeCompare(b.identity_key)),
  decision_diff_status: 'UNPROVEN',
  status: 'BLOCKED_IDENTITY_INTEGRITY',
};
const outDir = path.join(root, 'reports/canonical-identity-classification-2026-08-15');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'classification.json'), JSON.stringify(report, null, 2) + '\n');
const lines = ['# Canonical Identity Finding Classification', '', '- Authority: `NON_AUTHORITATIVE`', '- Status: `BLOCKED_IDENTITY_INTEGRITY`', '- Database writes: `0`', `- Findings: ${report.population.findings}`, `- Affected identities: ${report.population.affected_identities}`, '', '| Category | Identity count |', '|---|---:|'];
for (const [k,v] of Object.entries(report.category_counts)) lines.push(`| ${k} | ${v} |`);
lines.push('', 'Decision diff status: `UNPROVEN`', '', 'No migration, approval, supersession, canonical change, or detector activation occurred.', '');
fs.writeFileSync(path.join(outDir, 'classification.md'), lines.join('\n'));
console.log(JSON.stringify({ output: outDir, findings: report.population.findings, identities: report.population.affected_identities, database_writes: 0 }, null, 2));
