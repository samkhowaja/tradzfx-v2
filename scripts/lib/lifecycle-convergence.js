"use strict";

function checkpointMillis(value) {
  if (value == null) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function evaluateLifecycleProgress({ before, after, rowsUpdated, eligibleWork, hitBound }) {
  const beforeMs = checkpointMillis(before);
  const afterMs = checkpointMillis(after);
  const advanced = afterMs != null && (beforeMs == null || afterMs > beforeMs);
  const remainingLagMs = afterMs == null ? null : Math.max(0, new Date(eligibleWork.asOf).getTime() - afterMs);

  if (eligibleWork.exists && !advanced && rowsUpdated === 0) {
    return { verdict: "NO_PROGRESS", advanced, remainingLagMs };
  }
  if (hitBound && remainingLagMs != null && remainingLagMs > 0) {
    return { verdict: "PARTIAL", advanced, remainingLagMs };
  }
  return { verdict: "CONVERGED", advanced, remainingLagMs };
}

module.exports = { evaluateLifecycleProgress };
