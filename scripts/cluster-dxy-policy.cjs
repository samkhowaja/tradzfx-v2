'use strict';

function evaluateClusterDxyPolicy({ signature, coMoveCount = 0, dxySign = null, dxyDependency }) {
  const dependency = dxyDependency ?? 'required';
  if (signature !== 'usd-complex-event') return { allowed: true, dxyDependency: dependency, dxyAdvisory: dxySign };
  if (coMoveCount < 1) return { allowed: false, reason: 'core_signature_failed', dxyDependency: dependency, dxyAdvisory: dxySign };
  if (dependency === 'required' && dxySign !== 'confirm') return { allowed: false, reason: 'dxy_required_failed', dxyDependency: dependency, dxyAdvisory: dxySign };
  return { allowed: true, dxyDependency: dependency, dxyAdvisory: dxySign };
}

module.exports = { evaluateClusterDxyPolicy };
