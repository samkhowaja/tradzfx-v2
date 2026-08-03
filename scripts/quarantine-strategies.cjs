#!/usr/bin/env node
const fs = require('node:fs');
const inputIndex = process.argv.indexOf('--input');
const outputIndex = process.argv.indexOf('--output');
const input = inputIndex >= 0 ? process.argv[inputIndex + 1] : 'temp/strategy-dependency-matrix.json';
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : 'temp/quarantine-list.json';
const reasonIndex = process.argv.indexOf('--reason');
const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : 'CONTAMINATED_FEATURE';
const report = JSON.parse(fs.readFileSync(input, 'utf8'));
const quarantined = report.strategies.filter((strategy) => strategy.status === 'BLOCKED_CONTAMINATED_DEPENDENCY').map((strategy) => ({ id: strategy.id, file: strategy.file, features: strategy.features, reason, action: 'BLOCK_BACKTEST_AND_LIVE' }));
const result = { generatedAt: new Date().toISOString(), source: input, reason, count: quarantined.length, strategies: quarantined };
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
