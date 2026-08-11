#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verifyOutputFingerprint } = require('./report-framework.cjs');

const root = path.resolve(__dirname, '..');
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function canonical(value) { return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]))); }
function main() {
  const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice('--report='.length) || process.argv[2];
  if (!reportPath) throw new Error('Usage: node scripts/append-report-manifest.cjs <report.json>');
  const absolute = path.resolve(root, reportPath);
  const bytes = fs.readFileSync(absolute);
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error('REPORT_UTF8_BOM_FORBIDDEN');
  const report = JSON.parse(bytes.toString('utf8'));
  if (!verifyOutputFingerprint(report)) throw new Error('report output_fingerprint mismatch');
  const reportSha = sha256(bytes);
  const manifestPath = path.join(root, 'reports', 'report-manifest.jsonl');
  const entries = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  const previous = entries.at(-1);
  const entry = { report_path: path.relative(root, absolute).replaceAll('\\', '/'), report_sha256: reportSha, input_fingerprint: report.input_fingerprint, output_fingerprint: report.output_fingerprint, certification_status: report.certification.status, scope: report.scope, generated_at: report.generated_at, previous_manifest_entry_hash: previous ? previous.manifest_entry_hash : null };
  entry.manifest_entry_hash = sha256(canonical(entry));
  const sameIdentity = entries.find((x) => x.report_path === entry.report_path && x.input_fingerprint === entry.input_fingerprint);
  if (sameIdentity && sameIdentity.report_sha256 !== entry.report_sha256) throw new Error('rejection: logical report identity has different report_sha256');
  if (sameIdentity) { console.log('manifest unchanged: identical report identity already recorded'); return; }
  fs.appendFileSync(manifestPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', flag: 'a' });
  console.log(`manifest appended: ${entry.manifest_entry_hash}`);
}
main();
