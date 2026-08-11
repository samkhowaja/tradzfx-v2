#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reports = path.join(root, 'reports');
const required = ['summary.md','manifest.json','commands.md','db-before.json','db-after.json','validation.json','blockers.json'];
const sensitive = /(^|[\\/])(?:\.env(?:\.|$)|.*\.(dump|sql|pem|key|crt)|node_modules|backups|logs)(?:$|[\\/])/i;
const reportDirs = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
        for (const change of fs.readdirSync(full, { withFileTypes: true })) if (change.isDirectory()) reportDirs.push(path.join(full, change.name));
      } else if (entry.name !== 'artifacts') walk(full);
    }
  }
}
walk(reports);
const errors = [];
for (const dir of reportDirs) {
  for (const file of required) if (!fs.existsSync(path.join(dir, file))) errors.push(`${path.relative(root, dir)} missing ${file}`);
  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const key of ['schema_version','change_id','timestamp','branch','commit_sha','status','artifacts']) if (!(key in m)) errors.push(`${path.relative(root, manifestPath)} missing ${key}`);
      if (!['PASS','INCOMPLETE','BLOCKED','PENDING'].includes(m.status)) errors.push(`${path.relative(root, manifestPath)} invalid status`);
      if (!Array.isArray(m.artifacts)) errors.push(`${path.relative(root, manifestPath)} artifacts must be array`);
    } catch (e) { errors.push(`${path.relative(root, manifestPath)} invalid JSON: ${e.message}`); }
  }
  const artifactRoot = path.join(dir, 'artifacts');
  if (fs.existsSync(artifactRoot)) {
    const stack = [artifactRoot];
    while (stack.length) for (const entry of fs.readdirSync(stack.pop(), { withFileTypes: true })) {
      const full = path.join(artifactRoot, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (sensitive.test(path.relative(root, full))) errors.push(`${path.relative(root, full)} sensitive artifact path`);
    }
  }
}
if (!reportDirs.length) errors.push('No dated report directories found');
if (errors.length) { console.error(errors.map((x) => `REPORT_VALIDATION_ERROR: ${x}`).join('\n')); process.exit(1); }
console.log(`Validated ${reportDirs.length} development report(s)`);
