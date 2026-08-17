const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('lineage-gap report remains non-authoritative and write-free', () => {
  assert(fs.existsSync('xauusd-lineage-gap-report.json'), 'run generator before test');
  const report = JSON.parse(fs.readFileSync('xauusd-lineage-gap-report.json', 'utf8'));
  assert.strictEqual(report.authority, 'NON_AUTHORITATIVE', 'authority must be NON_AUTHORITATIVE');
  assert.strictEqual(report.status, 'BLOCKED_LINEAGE_GAP', 'status must be BLOCKED_LINEAGE_GAP');
  assert.strictEqual(report.writes, 0, 'writes must be 0');
  assert.strictEqual(report.writes_performed, 0, 'writes_performed must be 0');
  assert.strictEqual(report.approvalEvidenceGenerated, false, 'approvalEvidenceGenerated must be false');
  assert(!report.approval, 'must not contain approval decisions');
  assert(!report.trustedReplacements, 'must not contain trusted-replacement declarations');
  assert(!report.inferredSourceIdentities, 'must not contain inferred source identities');
  assert(!report.canonicalPromotionClaims, 'must not contain canonical promotion claims');
  assert(!report.gateActivation, 'must not contain gate activation');
  assert(!report.shadowRunAuthorization, 'must not contain shadow-run authorization');
  assert.equal(report.isolationLevel, 'repeatable read');
  assert.match(report.reportHash, /^[a-f0-9]{64}$/);
  assert.equal(report.nonReconstructionStatement.includes('Never infer source identity'), true);
  assert.match(report.hashSemantics, /deterministic evidence state/);
  assert(report.missingFields.includes('detector/evidence identity binding'));
  assert(report.missingFields.includes('replacement identity binding'));
  assert(report.missingFields.includes('downstream feature/artifact binding'));
});
