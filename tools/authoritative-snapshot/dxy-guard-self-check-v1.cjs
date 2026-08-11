'use strict';

const REJECTION = 'DXY_NON_AUTHORITATIVE_BLOCKED';
const STATUS = 'NON_AUTHORITATIVE';

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

function tainted(node, graph, aliases) {
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const nodeValue = graph[id] || { identity: id, dependsOn: [] };
    if (canonicalize(nodeValue.identity || id, aliases) === 'DXY') return true;
    return (nodeValue.dependsOn || []).some(visit);
  };
  return visit(node);
}

function evaluate(manifest, policy) {
  const executionBearing = ['backtest','replay','live','demo','shadow_run','live_signal_job'].includes(manifest.type) && manifest.policy?.execution_allowed === true;
  const auditOnly = manifest.audit_only === true && ['backtest','replay','analysis'].includes(manifest.type) && manifest.policy?.execution_allowed === false;
  const isTainted = (manifest.dependencies || []).some((id) => tainted(id, policy.graph, policy.aliases));
  if (policy.dxyStatus === STATUS && isTainted) {
    if (executionBearing) return { status: 'REJECTED', rejection_reason: REJECTION, execution_prohibited: true };
    if (auditOnly) return { status: 'ALLOWED_FOR_AUDIT_ONLY', rejection_reason: REJECTION, execution_prohibited: true, must_record_provenance: true };
  }
  return { status: 'ALLOWED', rejection_reason: null, execution_prohibited: false };
}

const policy = {
  dxyStatus: STATUS,
  aliases: { US_DOLLAR_INDEX: 'DXY', DOLLAR_IDX: 'DXY' },
  graph: {
    direct_dxy: { identity: 'DXY', dependsOn: [] },
    alias_dxy: { identity: 'US_DOLLAR_INDEX', dependsOn: [] },
    dxy_factor: { identity: 'dxy-geometric-v1', dependsOn: ['direct_dxy'] },
    dxy_feature: { identity: 'features_dxy_regime', dependsOn: ['dxy_factor'] },
    clean_feature: { identity: 'features_atr', dependsOn: ['XAUUSD'] },
    XAUUSD: { identity: 'XAUUSD', dependsOn: [] },
  },
};

const cases = [
  ['direct DXY dependency', { type:'live', policy:{execution_allowed:true}, dependencies:['direct_dxy'] }, 'REJECTED'],
  ['DXY alias dependency', { type:'live', policy:{execution_allowed:true}, dependencies:['alias_dxy'] }, 'REJECTED'],
  ['transitive feature dependency', { type:'backtest', policy:{execution_allowed:true}, dependencies:['dxy_feature'] }, 'REJECTED'],
  ['audit-only manifest', { type:'analysis', audit_only:true, policy:{execution_allowed:false}, dependencies:['dxy_feature'] }, 'ALLOWED_FOR_AUDIT_ONLY'],
  ['clean dependency', { type:'live', policy:{execution_allowed:true}, dependencies:['clean_feature'] }, 'ALLOWED'],
];
const results = cases.map(([name, manifest, expected]) => { const actual = evaluate(manifest, policy); return { name, expected, actual, passed: actual.status === expected && (expected === 'ALLOWED' || actual.rejection_reason === REJECTION) }; });
const report = { schema:'dxy-guard-self-check-v1', readOnly:true, dxyStatus:STATUS, rejectionCode:REJECTION, results, passed:results.every(r=>r.passed), dbWrites:0, gates:'UNCHANGED' };
if (!report.passed) { console.error(JSON.stringify(report,null,2)); process.exit(1); }
console.log(JSON.stringify(report,null,2));
