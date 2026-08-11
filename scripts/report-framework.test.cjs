#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, canonicalJson, verifyOutputFingerprint } = require('./report-framework.cjs');

const base = () => ({
  change_id: 'fixture', snapshot_id: 'snapshot-001', policy_version: 'calendar-policy-v1', detector_version: 'detector-v1', calendar_version: 'xauusd-calendar-v1',
  check_versions: { lineage: 'v1', children: 'v1', calendar: 'v1', quarantine: 'v1' }, scope: { symbol: 'XAUUSD', timeframe: '15m', from: '2026-08-01T00:00:00Z', to: '2026-08-01T01:00:00Z' },
  queries: ['SELECT fixture'], tables: ['fixture.rows'], rows: [{ identity: 'row-1', ingestion_run_id: 'run-1', lineage_bindings: [{ id: 'lineage-1' }], required_children: 15, present_children: 15, calendar_state: 'EXPECTED', quarantine_state: 'NONE' }],
});

test('valid fixture reaches READY', () => {
  const report = buildReport(base(), { generated_at: '2026-08-07T00:00:00.000Z' });
  assert.equal(report.certification.status, 'READY');
  assert.equal(report.certification.blocking_violation_count, 0);
  assert.equal(verifyOutputFingerprint(report), true);
});

test('each blocker fails closed', () => {
  for (const mutate of [
    (x) => { delete x.rows[0].ingestion_run_id; },
    (x) => { x.rows[0].multiple_lineage_bindings = 1; },
    (x) => { x.rows[0].present_children = 14; },
    (x) => { x.rows[0].calendar_state = 'UNEXPECTED_GAP'; },
    (x) => { x.rows[0].quarantine_state = 'UNKNOWN'; },
  ]) {
    const input = base(); mutate(input);
    const report = buildReport(input, { generated_at: '2026-08-07T00:00:00.000Z' });
    assert.equal(report.certification.status, 'BLOCKED');
  }
});

test('ordering and bytes remain deterministic', () => {
  const first = buildReport(base(), { generated_at: '2026-08-07T00:00:00.000Z' });
  const secondInput = base(); secondInput.queries.reverse(); secondInput.tables.reverse(); secondInput.rows.reverse();
  const second = buildReport(secondInput, { generated_at: '2026-08-07T00:00:00.000Z' });
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test('missing immutable identity fails', () => {
  const input = base(); delete input.snapshot_id;
  assert.throws(() => buildReport(input), /immutable fingerprint identity/);
});
