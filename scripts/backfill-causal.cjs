#!/usr/bin/env node
/**
 * Controlled causal backfill entry point.
 * Write mode remains disabled until DAGRunner persistence integration is complete.
 */
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
if (args.includes('--write')) {
  console.error('WRITE BLOCKED: use DAGRunner persistence path; raw SQL backfill is not enabled.');
  process.exit(2);
}

const result = spawnSync(process.execPath, [
  require('node:path').join(__dirname, 'backfill-causal-dryrun.cjs'),
  ...args.filter((arg) => arg !== '--dry-run'),
], { stdio: 'inherit', cwd: require('node:path').resolve(__dirname, '..') });
process.exit(result.status ?? 1);
