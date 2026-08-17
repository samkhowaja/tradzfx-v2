'use strict';

const crypto = require('crypto');

const FINALIZATION_PLAN = Object.freeze([
  ['lock_parent_run', 'read', 'running parent row required'],
  ['lock_pending_rows', 'read', 'pending rows selected for run'],
  ['validate_pending_count', 'read', 'pending count is positive and matches expectation'],
  ['validate_identity_and_bounds', 'read', 'identity, source key, bounds, timestamp uniqueness'],
  ['resolve_authority', 'read', 'database authority snapshot must match'],
  ['recompute_hashes', 'read', 'database canonical hash must match submitted hash'],
  ['validate_supersession_and_replay', 'read', 'destination identity and duplicate replay checks'],
  ['compute_spans_counts_fingerprint', 'read', 'deterministic metadata computed'],
  ['insert_run_evidence', 'write', 'successful run evidence'],
  ['insert_raw_evidence', 'write', 'immutable raw evidence'],
  ['update_lineage', 'write', 'producer lineage receives raw evidence IDs'],
  ['finalize_run', 'write', 'run status and completion metadata'],
  ['delete_pending_rows', 'write', 'staging removed only after promotion succeeds'],
  ['commit', 'write', 'single atomic transaction'],
].map(([step, effect, precondition], index) => Object.freeze({ index: index + 1, step, effect, precondition })));

const HASH_ALGORITHM = 'sha256-v1-utc-canonical-number';
function canonicalNumber(value) { if (value == null) return null; if (!Number.isFinite(Number(value))) throw new Error('non-finite numeric value'); return String(Number(value)); }
function field(value) { return value == null ? '-1:' : `${Buffer.byteLength(String(value), 'utf8')}:${value}`; }
function normalizeCandleInput(row) {
  return Object.freeze({ ...row,
    symbol: row.symbol == null ? null : String(row.symbol),
    broker: row.broker == null ? null : String(row.broker),
    timeframe: row.timeframe == null ? null : String(row.timeframe),
    candle_ts: row.candle_ts == null ? null : new Date(row.candle_ts).toISOString(),
    o: row.o == null ? null : Number(row.o), h: row.h == null ? null : Number(row.h),
    l: row.l == null ? null : Number(row.l), c: row.c == null ? null : Number(row.c),
    v: row.v == null ? null : Number(row.v), spread: row.spread == null ? null : Number(row.spread),
    digits: row.digits == null ? null : Number(row.digits),
  });
}
function goldenCandleHash(row) {
  const ts = new Date(row.candle_ts).toISOString().replace('Z', '000Z');
  const values = [row.symbol, row.broker, row.timeframe, ts, row.o, row.h, row.l, row.c, row.v, row.spread, row.digits].map((value, index) => index < 4 ? value : canonicalNumber(value));
  return crypto.createHash('sha256').update(values.map(field).join(''), 'utf8').digest('hex');
}
function supersessionDecision(row, destination) {
  if (row.supersedes_raw_evidence_id == null) return { action: 'none', valid: true };
  if (!destination) return { action: 'reject', valid: false, reason: 'supersession target missing' };
  if (String(destination.raw_evidence_id) === String(row.supersedes_raw_evidence_id)) return { action: 'reject', valid: false, reason: 'self supersession' };
  const same = ['symbol', 'broker', 'timeframe', 'candle_ts'].every(key => String(destination[key]) === String(row[key]));
  return same ? { action: 'supersede', valid: true } : { action: 'reject', valid: false, reason: 'supersession identity mismatch' };
}
function idempotencyDecision(row, existing) {
  if (!existing) return { action: 'promote', valid: true, reason: 'destination absent' };
  const same = ['symbol', 'broker', 'timeframe', 'candle_ts', 'content_sha256'].every(key => String(existing[key]) === String(row[key]));
  return same ? { action: 'noop', valid: true, reason: 'equivalent evidence already finalized' } : { action: 'reject', valid: false, reason: 'destination conflict' };
}
function evaluateEligibility(run, rows) {
  rows = rows.map(normalizeCandleInput);
  const pending = rows.length > 0;
  const pendingWithinBatch = !pending || (new Date(rows[0].candle_ts) >= new Date(run.batch_start_ts) && new Date(rows[rows.length - 1].candle_ts) <= new Date(run.batch_end_ts));
  const identityMatch = rows.every(row => row.symbol === run.symbol && row.broker === run.broker && row.timeframe === run.timeframe);
  const sourceKeysPresent = rows.every(row => row.source_key != null && String(row.source_key).trim() !== '');
  const uniqueKeys = new Set(rows.map(row => `${row.source_key}|${new Date(row.candle_ts).toISOString()}`));
  const blockingReasons = [];
  const diagnostics = [];
  if (run.status !== 'running') blockingReasons.push('PARENT_NOT_RUNNING');
  if (!pending) blockingReasons.push('PENDING_EMPTY');
  if (!pendingWithinBatch) blockingReasons.push('OUTSIDE_BATCH_BOUNDS');
  if (!identityMatch) blockingReasons.push('IDENTITY_MISMATCH');
  if (!sourceKeysPresent) blockingReasons.push('SOURCE_KEY_INVALID');
  if (!rows.every(row => row.content_sha256 === goldenCandleHash(row) && row.hash_algorithm === HASH_ALGORITHM)) blockingReasons.push('HASH_MISMATCH');
  if (!rows.every(row => row.authority_snapshot_id === row.resolved_authority)) blockingReasons.push('AUTHORITY_MISMATCH');
  if (uniqueKeys.size !== rows.length) blockingReasons.push('DUPLICATE_KEY');
  if (rows.some(row => row.extra != null)) diagnostics.push('IGNORED_EXTRA_FIELDS');
  const result = {
    eligible: blockingReasons.length === 0,
    parent_running: run.status === 'running',
    pending_nonempty: pending,
    pending_within_batch: pendingWithinBatch,
    identity_match: identityMatch,
    source_keys_valid: sourceKeysPresent,
    hashes_recomputed: rows.every(row => row.content_sha256 === goldenCandleHash(row) && row.hash_algorithm === HASH_ALGORITHM),
    authority_resolved: rows.every(row => row.authority_snapshot_id === row.resolved_authority),
    duplicate_keys: uniqueKeys.size !== rows.length,
    blockingReasons: Object.freeze(blockingReasons),
    diagnostics: Object.freeze(diagnostics),
    reasons: Object.freeze(blockingReasons),
  };
  Object.defineProperties(result, {
    eligible: { value: result.eligible, enumerable: true },
    blockingReasons: { value: result.blockingReasons, enumerable: false },
    diagnostics: { value: result.diagnostics, enumerable: false },
    reasons: { value: result.reasons, enumerable: false },
  });
  return Object.freeze(result);
}
module.exports = { FINALIZATION_PLAN, HASH_ALGORITHM, normalizeCandleInput, goldenCandleHash, supersessionDecision, idempotencyDecision, evaluateEligibility };
