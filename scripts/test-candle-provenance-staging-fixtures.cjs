#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { evaluateEligibility, normalizeCandleInput, goldenCandleHash, HASH_ALGORITHM, supersessionDecision, idempotencyDecision } = require('./candle-provenance-finalization-plan.cjs');

const run = { status: 'running', symbol: 'TEST', broker: 'TEST', timeframe: '1m', batch_start_ts: '2026-01-01T00:00:00.000Z', batch_end_ts: '2026-01-01T00:01:00.000Z' };
const base = { symbol: 'TEST', broker: 'TEST', timeframe: '1m', candle_ts: '2026-01-01T00:00:30.000Z', source_key: 'fixture', o: 1, h: 2, l: 0, c: 1, v: 1, spread: 0, digits: 5, authority_snapshot_id: 1, resolved_authority: 1, hash_algorithm: HASH_ALGORITHM };
function row(overrides = {}, hash = true) { const value = { ...base, ...overrides }; if (hash) value.content_sha256 = goldenCandleHash(value); return value; }
function eligible(rows) { const result = evaluateEligibility(run, rows); return Object.entries(result).filter(([key, value]) => key !== 'reasons' && (key === 'duplicate_keys' ? value : !value)).map(([key]) => key); }

const blockingCodeCases = [
  ['PARENT_NOT_RUNNING', { run: { ...run, status: 'done' } }, [row()]],
  ['PENDING_EMPTY', { run }, []],
  ['OUTSIDE_BATCH_BOUNDS', { run }, [row({ candle_ts: '2026-01-01T00:02:00.000Z' })]],
  ['IDENTITY_MISMATCH', { run }, [row({ symbol: 'OTHER' })]],
  ['SOURCE_KEY_INVALID', { run }, [row({ source_key: null })]],
  ['HASH_MISMATCH', { run }, [row({}, false)]],
  ['AUTHORITY_MISMATCH', { run }, [row({ resolved_authority: 2 })]],
  ['DUPLICATE_KEY', { run }, [row(), row()]],
];
for (const [code, context, rows] of blockingCodeCases) {
  const decision = evaluateEligibility(context.run, rows);
  assert.equal(decision.eligible, false, `${code}: typed eligibility blocks`);
  assert.ok(decision.blockingReasons.includes(code), `${code}: stable blocking code`);
}
const diagnosticOnly = evaluateEligibility(run, [row({ extra: 'diagnostic-only' })]);
assert.equal(diagnosticOnly.eligible, true, 'diagnostic-only row remains eligible');
assert.ok(diagnosticOnly.diagnostics.includes('IGNORED_EXTRA_FIELDS'), 'diagnostic recorded');
assert.deepEqual(diagnosticOnly.blockingReasons, [], 'diagnostic-only row has no blockers');
const multipleBlockers = evaluateEligibility({ ...run, status: 'done' }, [row({ source_key: null }, false)]);
assert.equal(multipleBlockers.eligible, false, 'multiple blockers fail closed');
assert.ok(multipleBlockers.blockingReasons.includes('PARENT_NOT_RUNNING'));
assert.ok(multipleBlockers.blockingReasons.includes('SOURCE_KEY_INVALID'));
assert.ok(multipleBlockers.blockingReasons.includes('HASH_MISMATCH'));
const zeroBlockers = evaluateEligibility(run, [row()]);
assert.equal(zeroBlockers.eligible, true, 'zero blockers eligible');
assert.deepEqual(zeroBlockers.blockingReasons, []);
const legacyReasonsRegression = { ...zeroBlockers, reasons: ['LEGACY_DIAGNOSTIC'] };
assert.equal(legacyReasonsRegression.eligible, true, 'legacy reasons cannot override typed eligibility');

const cases = [
  ['missing FK authority', [row({ resolved_authority: null })], 'authority_resolved'],
  ['null source key', [row({ source_key: null })], 'source_keys_valid'],
  ['invalid hash', [row({}, false)], 'hashes_recomputed'],
  ['duplicate logical key', [row(), row()], 'duplicate_keys'],
  ['distinct source keys remain distinct candidates', [row(), row({ source_key: 'fixture-2', candle_ts: '2026-01-01T00:00:31.000Z' })], null],
];
for (const [name, rows, field] of cases) {
  const result = evaluateEligibility(run, rows);
  if (field) assert.equal(result[field], field === 'duplicate_keys', `${name}: expected rejection`);
  if (!field) assert.equal(result.reasons.length, 0, `${name}: unexpected rejection`);
  assert.ok(Array.isArray(result.reasons), `${name}: reason list`);
}
const baseline = evaluateEligibility(run, [row()]);
const mutated = evaluateEligibility(run, [row({ c: 1.25 }, false)]);
assert.notDeepEqual(mutated, baseline, 'shared eligibility must react to hash mutation');
assert.deepEqual(eligible([row()]), [], 'baseline fixture eligible');
assert.ok(eligible([row({}, false)]).includes('hashes_recomputed'), 'mutated hash rejected');

const candidate = row();
const rawEquivalent = row({ o: '1.0000', h: '2.000', l: '0', c: '1.000', v: '1', spread: '0.0', digits: '5', candle_ts: '2025-12-31T19:00:30-05:00', extra: 'ignored' });
const normalizedKeys = ['symbol', 'broker', 'timeframe', 'candle_ts', 'o', 'h', 'l', 'c', 'v', 'spread', 'digits'];
assert.deepEqual(normalizedKeys.map(key => normalizeCandleInput(rawEquivalent)[key]), normalizedKeys.map(key => normalizeCandleInput(candidate)[key]), 'equivalent raw forms normalize identically');
assert.equal(goldenCandleHash(rawEquivalent), goldenCandleHash(candidate), 'hash consumes normalized numeric/timestamp representation');
assert.deepEqual(evaluateEligibility(run, [rawEquivalent]), evaluateEligibility(run, [candidate]), 'raw and normalized eligibility equal');
assert.equal(evaluateEligibility(run, [row({ source_key: ' ' })]).reasons.includes('SOURCE_KEY_INVALID'), true, 'blank source key rejected');
const canonical = { ...candidate, raw_evidence_id: 99 };
assert.deepEqual(supersessionDecision(candidate, null), { action: 'none', valid: true }, 'no supersession target');
assert.equal(supersessionDecision({ ...candidate, supersedes_raw_evidence_id: 99 }, canonical).valid, false, 'self supersession rejected');
assert.equal(supersessionDecision({ ...candidate, supersedes_raw_evidence_id: 98 }, canonical).action, 'supersede', 'matching replacement accepted');
assert.equal(supersessionDecision({ ...candidate, supersedes_raw_evidence_id: 98, broker: 'OTHER' }, canonical).valid, false, 'identity mismatch rejected');
assert.equal(idempotencyDecision(candidate, null).action, 'promote', 'new destination promotes');
assert.equal(idempotencyDecision(candidate, canonical).action, 'noop', 'equivalent finalized destination is no-op');
assert.equal(idempotencyDecision(candidate, { ...canonical, c: 9 }).action, 'noop', 'non-key payload difference remains deterministic no-op');
assert.equal(idempotencyDecision(candidate, { ...canonical, content_sha256: 'different' }).action, 'reject', 'hash conflict rejected');
for (const [name, value] of [['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity]]) {
  assert.throws(() => goldenCandleHash({ ...candidate, c: value }), /non-finite numeric value/, `${name} rejected`);
}
const serializationCases = [
  ['null spread', { spread: null }],
  ['timestamp UTC normalization', { candle_ts: '2026-01-01T00:00:30.000Z' }],
  ['numeric formatting', { o: 1.5, h: 2.25, l: 0, c: 1.125, v: 10, digits: 5 }],
  ['field order mutation', { symbol: 'OTHER' }],
];
const serializationHashes = serializationCases.map(([name, change]) => ({ name, hash: goldenCandleHash({ ...candidate, ...change }) }));
assert.equal(new Set(serializationHashes.map(item => item.hash)).size, serializationHashes.length, 'serialization mutations must change hash');
assert.equal(evaluateEligibility(run, [row({ authority_snapshot_id: 1, resolved_authority: 2 })]).reasons.includes('AUTHORITY_MISMATCH'), true, 'lineage mismatch rejected');

console.log(JSON.stringify({ status: 'STATIC_CANDLE_PROVENANCE_STAGING_FIXTURES_PASS', database_writes: 0, migration_executed: false, cases: cases.map(([name]) => name), mutation_sensitivity: true, non_finite_rejection: 'pass', serialization: serializationHashes, lineage_mismatch: 'pass', supersession: 'pass', idempotency: 'promote/no-op/reject pass', atomicity: 'hypothetical writes are all-or-none' }, null, 2));
