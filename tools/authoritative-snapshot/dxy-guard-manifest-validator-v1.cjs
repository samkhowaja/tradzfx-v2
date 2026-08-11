'use strict';

const REJECTION = 'DXY_NON_AUTHORITATIVE_BLOCKED';
const DXY_STATUS = 'NON_AUTHORITATIVE';
const EXECUTION_TYPES = new Set(['backtest', 'replay', 'live', 'demo', 'shadow_run', 'live_signal_job']);
const AUDIT_TYPES = new Set(['backtest', 'replay', 'analysis']);

function canonicalize(value, aliases = {}) {
  let current = String(value).toUpperCase();
  const seen = new Set();
  while (aliases[current]) {
    if (seen.has(current)) throw new Error('ALIAS_CYCLE');
    seen.add(current);
    current = String(aliases[current]).toUpperCase();
  }
  return current;
}

function dependsOnDxy(id, graph, aliases, visiting = new Set(), visited = new Set()) {
  const canonicalId = canonicalize(id, aliases);
  if (canonicalId === 'DXY') return true;
  if (visited.has(canonicalId)) return false;
  if (visiting.has(canonicalId)) throw new Error('DEPENDENCY_CYCLE');
  visiting.add(canonicalId);
  const node = graph[id] || graph[canonicalId] || { identity: canonicalId, dependsOn: [] };
  const tainted = canonicalize(node.identity || canonicalId, aliases) === 'DXY'
    || (node.dependsOn || []).some((dependency) => dependsOnDxy(dependency, graph, aliases, visiting, visited));
  visiting.delete(canonicalId);
  visited.add(canonicalId);
  return tainted;
}

function validateManifest(manifest, policy) {
  const executionBearing = EXECUTION_TYPES.has(manifest.type) && manifest.policy?.execution_allowed === true;
  const auditOnly = manifest.audit_only === true
    && AUDIT_TYPES.has(manifest.type)
    && manifest.policy?.execution_allowed === false
    && manifest.provenance_required === true
    && manifest.execution_prohibited === true;
  const dxyDerived = (manifest.dependencies || []).some((dependency) =>
    dependsOnDxy(dependency, policy.graph, policy.aliases));

  if (policy.dxyStatus === DXY_STATUS && dxyDerived) {
    if (executionBearing) {
      return { status: 'REJECTED', rejection_reason: REJECTION, execution_prohibited: true };
    }
    if (auditOnly) {
      return { status: 'ALLOWED_FOR_AUDIT_ONLY', rejection_reason: REJECTION, execution_prohibited: true, must_record_provenance: true };
    }
    return { status: 'REJECTED', rejection_reason: REJECTION, execution_prohibited: true };
  }
  return { status: 'ALLOWED', rejection_reason: null, execution_prohibited: false };
}

const inputText = process.argv[2] || require('fs').readFileSync(0, 'utf8') || '{}';
const input = JSON.parse(inputText);
const policy = {
  dxyStatus: input.policy?.dxyStatus || DXY_STATUS,
  aliases: input.policy?.aliases || {},
  graph: input.policy?.graph || {},
};
const manifests = Array.isArray(input.manifests) ? input.manifests : [input.manifest || input];
const results = manifests.map((manifest) => ({
  id: manifest.id || null,
  result: validateManifest(manifest, policy),
}));

console.log(JSON.stringify({
  schema: 'dxy-guard-manifest-validator-v1',
  readOnly: true,
  dxyStatus: policy.dxyStatus,
  rejectionCode: REJECTION,
  results,
  dbWrites: 0,
  gates: 'UNCHANGED',
}, null, 2));
