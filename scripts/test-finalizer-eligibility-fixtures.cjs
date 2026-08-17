#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { evaluateEligibility, goldenCandleHash, HASH_ALGORITHM } = require('./candle-provenance-finalization-plan.cjs');

const run = { status: 'running', symbol: 'TEST', broker: 'TEST', timeframe: '1m', batch_start_ts: '2026-01-01T00:00:00.000Z', batch_end_ts: '2026-01-01T00:01:00.000Z' };
function row(overrides = {}, recompute = true) {
  const base = { symbol: 'TEST', broker: 'TEST', timeframe: '1m', candle_ts: '2026-01-01T00:00:30.000Z', source_key: 'source-1', o: 1, h: 2, l: 0, c: 1, v: 1, spread: 0, digits: 5, authority_snapshot_id: 1, resolved_authority: 1, hash_algorithm: HASH_ALGORITHM };
  const value = { ...base, ...overrides };
  if (recompute) value.content_sha256 = goldenCandleHash(value);
  return value;
}
function eligible(overrides = {}, rows = [row(overrides)]) { return evaluateEligibility(run, rows); }
const cases = [
  ['parent not running', () => evaluateEligibility({ ...run, status: 'success' }, [row()]), 'parent_running', false],
  ['empty pending', () => eligible({}, []), 'pending_nonempty', false],
  ['before batch', () => eligible({ candle_ts: '2025-12-31T23:59:59.999Z' }), 'pending_within_batch', false],
  ['after batch', () => eligible({ candle_ts: '2026-01-01T00:01:00.001Z' }), 'pending_within_batch', false],
  ['identity mismatch', () => eligible({ broker: 'OTHER' }), 'identity_match', false],
  ['hash mutation', () => evaluateEligibility(run, [row({ c: 1.1 }, false)]), 'hashes_recomputed', false],
  ['authority mismatch', () => eligible({ resolved_authority: 2 }), 'authority_resolved', false],
  ['duplicate key', () => eligible({}, [row(), row()]), 'duplicate_keys', true],
  ['null source key', () => eligible({ source_key: null }), 'identity_match', true],
  ['mixed eligible/ineligible batch', () => eligible({}, [row(), row({ broker: 'OTHER', source_key: 'source-2' })]), 'identity_match', false],
];
for (const [name, execute, field, expected] of cases) assert.equal(execute()[field], expected, `${name}: ${field}`);
const baseline = goldenCandleHash(row());
const mutated = goldenCandleHash(row({ spread: 0.1 }));
assert.notEqual(baseline, mutated, 'hash mutation sensitivity');
console.log(JSON.stringify({ status: 'FINALIZER_ELIGIBILITY_FIXTURES_PASS', database_writes: 0, mutation_sensitivity: { baseline, mutated, differs: baseline !== mutated }, cases: cases.map(([name]) => name) }, null, 2));
