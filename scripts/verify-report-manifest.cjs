#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verifyOutputFingerprint } = require('./report-framework.cjs');
const root = path.resolve(__dirname, '..');
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const canonical = (v) => JSON.stringify(Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])));
const manifest = path.join(root, 'reports', 'report-manifest.jsonl');
if (!fs.existsSync(manifest)) throw new Error('manifest missing');
let previous = null; const hashes = new Set();
for (const line of fs.readFileSync(manifest, 'utf8').split(/\r?\n/).filter(Boolean)) {
  const entry = JSON.parse(line); if (hashes.has(entry.report_sha256)) throw new Error('duplicate report_sha256'); hashes.add(entry.report_sha256);
  if (entry.previous_manifest_entry_hash !== (previous ? previous.manifest_entry_hash : null)) throw new Error('manifest chain mismatch');
  if (entry.manifest_entry_hash !== sha256(canonical(Object.fromEntries(Object.entries(entry).filter(([k]) => k !== 'manifest_entry_hash'))))) throw new Error('manifest entry hash mismatch');
  const reportPath = path.join(root, entry.report_path); const bytes = fs.readFileSync(reportPath); if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error('REPORT_UTF8_BOM_FORBIDDEN'); const report = JSON.parse(bytes.toString('utf8'));
  if (sha256(bytes) !== entry.report_sha256 || report.input_fingerprint !== entry.input_fingerprint || report.output_fingerprint !== entry.output_fingerprint || report.certification.status !== entry.certification_status || !verifyOutputFingerprint(report)) throw new Error(`manifest/report mismatch: ${entry.report_path}`);
  previous = entry;
}
console.log(`manifest valid: ${hashes.size} entries`);
