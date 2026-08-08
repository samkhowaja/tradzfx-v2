#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const CHECK_ORDER = Object.freeze([
  'NO_INGESTION_RUN_EVIDENCE',
  'MULTIPLE_LINEAGE_BINDINGS',
  'MISSING_REQUIRED_CHILD',
  'UNEXPECTED_CALENDAR_GAP',
  'UNKNOWN_QUARANTINE_STATE',
  'OFF_SESSION_PARENT',
  'CANONICAL_BLOCKER',
  'ATR_EDGE_MISALIGNMENT',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function canonicalJson(value) { return JSON.stringify(stable(value)); }
function fingerprint(input) { return crypto.createHash('sha256').update(canonicalJson(input)).digest('hex'); }
function sortRows(rows) { return [...rows].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))); }

function result(code, rows, blocked, message) {
  return { code, status: blocked ? 'BLOCKED' : 'PASSED', message, affected: sortRows(rows || []) };
}

function checkNoIngestionRunEvidence(input) {
  const rows = (input.rows || []).filter((row) => !row.ingestion_run_id && !row.producer_run_id);
  return result('NO_INGESTION_RUN_EVIDENCE', rows, rows.length > 0, 'Each row needs immutable ingestion or producer run identity.');
}
function checkMultipleLineageBindings(input) {
  const rows = [];
  for (const row of input.rows || []) {
    const duplicateCount = row.multiple_lineage_bindings ?? row.binding_violations ?? 0;
    if (duplicateCount > 0) rows.push({ identity: row.identity, binding_violation_count: duplicateCount });
  }
  return result('MULTIPLE_LINEAGE_BINDINGS', rows, rows.length > 0, 'Each required child must have at most one proven live lineage binding; raw-source candidates alone are not proof of duplication.');
}
function checkMissingRequiredChild(input) {
  const rows = (input.rows || []).filter((row) => row.required_children && row.present_children !== row.required_children)
    .map((row) => ({ identity: row.identity, required_children: row.required_children, present_children: row.present_children }));
  return result('MISSING_REQUIRED_CHILD', rows, rows.length > 0, 'All required child rows must exist.');
}
function checkUnexpectedCalendarGap(input) {
  const rows = (input.rows || []).filter((row) => row.calendar_state === 'UNEXPECTED_GAP')
    .map((row) => ({ identity: row.identity, from: row.from, to: row.to }));
  return result('UNEXPECTED_CALENDAR_GAP', rows, rows.length > 0, 'Calendar gap is not allowed by canonical policy.');
}
function checkUnknownQuarantineState(input) {
  const rows = (input.rows || []).filter((row) => row.quarantine_state === 'UNKNOWN')
    .map((row) => ({ identity: row.identity, quarantine_state: row.quarantine_state }));
  return result('UNKNOWN_QUARANTINE_STATE', rows, rows.length > 0, 'Unknown quarantine state fails closed.');
}
function checkOffSessionParent(input) {
  const rows = (input.rows || []).filter((row) => row.parent_session_state === 'OFF_SESSION')
    .map((row) => ({ identity: row.identity, parent_session_state: row.parent_session_state }));
  return result('OFF_SESSION_PARENT', rows, rows.length > 0, 'Canonical parent exists outside XAUUSD trading calendar.');
}
function checkCanonicalBlocker(input) {
  const rows = (input.rows || []).filter((row) => row.canonical_state === 'BLOCKED')
    .map((row) => ({ identity: row.identity, canonical_state: row.canonical_state }));
  const notEvaluated = input.canonical_checks_evaluated === false;
  return { code: 'CANONICAL_BLOCKER', status: notEvaluated ? 'NOT_EVALUATED' : (rows.length ? 'BLOCKED' : 'PASSED'), message: notEvaluated ? 'Canonical blocker evidence was not evaluated.' : 'Active canonical blocker detected.', affected: sortRows(rows) };
}
function checkAtrEdge(input) {
  const rows = (input.rows || []).filter((row) => row.atr_edge_state === 'MISALIGNED')
    .map((row) => ({ identity: row.identity, atr_edge_state: row.atr_edge_state }));
  const notEvaluated = input.atr_edge_evaluated === false;
  return { code: 'ATR_EDGE_MISALIGNMENT', status: notEvaluated ? 'NOT_EVALUATED' : (rows.length ? 'BLOCKED' : 'PASSED'), message: notEvaluated ? 'ATR/canonical edge alignment was not evaluated.' : 'ATR and canonical edges do not align.', affected: sortRows(rows) };
}

const CHECKS = Object.freeze({
  NO_INGESTION_RUN_EVIDENCE: checkNoIngestionRunEvidence,
  MULTIPLE_LINEAGE_BINDINGS: checkMultipleLineageBindings,
  MISSING_REQUIRED_CHILD: checkMissingRequiredChild,
  UNEXPECTED_CALENDAR_GAP: checkUnexpectedCalendarGap,
  UNKNOWN_QUARANTINE_STATE: checkUnknownQuarantineState,
  OFF_SESSION_PARENT: checkOffSessionParent,
  CANONICAL_BLOCKER: checkCanonicalBlocker,
  ATR_EDGE_MISALIGNMENT: checkAtrEdge,
});

function validateImmutableIdentity(input) {
  if (!input.snapshot_id || !input.policy_version || !input.detector_version || !input.calendar_version) throw new Error('missing immutable fingerprint identity');
  for (const row of input.rows || []) if (!row.identity) throw new Error('row lacks immutable identity');
}

function runChecks(input) {
  validateImmutableIdentity(input);
  return CHECK_ORDER.map((code) => CHECKS[code](input));
}

function buildReport(input, options = {}) {
  const checks = runChecks(input);
  const blockers = checks.filter((check) => check.status !== 'PASSED').map((check) => ({ code: check.code, status: check.status, affected: check.affected, message: check.message }));
  const fingerprintInput = { snapshot_id: input.snapshot_id, policy_version: input.policy_version, detector_version: input.detector_version, calendar_version: input.calendar_version, check_versions: input.check_versions || {}, scope: input.scope, rows: sortRows(input.rows || []) };
  const report = {
    schema_version: 'development-audit-report-v1', framework_version: options.framework_version || 'reporting-framework-v1', change_id: input.change_id,
    generated_at: options.generated_at || new Date().toISOString(), scope: input.scope, detector_version: input.detector_version, policy_version: input.policy_version,
    input_fingerprint: fingerprint(fingerprintInput), source_evidence: { queries: [...(input.queries || [])].sort(), tables: [...(input.tables || [])].sort(), snapshot_id: input.snapshot_id },
    summary: { counts: Object.fromEntries(checks.map((check) => [check.code, check.affected.length])) },
    checks, blockers, certification: { status: blockers.length ? 'BLOCKED' : 'READY', blocking_violation_count: blockers.length },
  };
  report.output_fingerprint = fingerprint({ ...report });
  return report;
}

function verifyOutputFingerprint(report) {
  if (!report || typeof report.output_fingerprint !== 'string') return false;
  const { output_fingerprint, ...unsigned } = report;
  return output_fingerprint === fingerprint(unsigned);
}

module.exports = { CHECK_ORDER, CHECKS, buildReport, canonicalJson, fingerprint, runChecks, stable, verifyOutputFingerprint };
