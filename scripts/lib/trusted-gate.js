"use strict";

/**
 * trusted-gate.js — shared trusted-window coverage gate for backtests and
 * feature backfills. Fail-closed by default: a requested [from,to] interval
 * for a symbol must be fully covered by status='trusted' 1m windows in
 * market.trusted_windows. On PASS, returns the pinned window set so runs can
 * record exactly which trust regime they consumed.
 */

const { canonicalJson, sha256 } = require("./immutable-run-store.js");

/**
 * Evaluate trusted-window coverage for (symbols, from, to).
 *
 * @param {import("pg").Pool|import("pg").Client} queryable
 * @param {string[]} symbols
 * @param {Date} from
 * @param {Date} to
 * @returns {Promise<{
 *   pass: boolean,
 *   blocked: string[],
 *   windowIds: number[],
 *   windowSetHash: string|null,
 *   detectors: string[],
 *   canonicalVersions: string[],
 * }>}
 */
async function evaluateTrustedGate(queryable, symbols, from, to) {
  const { rows: trustedAll } = await queryable.query(
    `SELECT window_id, symbol, window_start, window_end, detector_version, canonical_version,
            gate_summary
     FROM market.trusted_windows
     WHERE status = 'trusted' AND symbol = ANY($1) AND timeframe = '1m'
       AND detector_version IS NOT NULL AND canonical_version IS NOT NULL
       AND gate_summary IS NOT NULL
     ORDER BY symbol, window_start`,
    [symbols]
  );

  // Greedy coverage chain per symbol; track exact window_ids used so the run
  // is pinned to this trusted set (later promotions/demotions cannot change
  // what the run meant).
  const usedIds = new Set();
  const covered = (sym) => {
    const ws = trustedAll.filter((w) => w.symbol === sym);
    let cursor = from.getTime();
    const end = to.getTime();
    for (const w of ws) {
      const s = new Date(w.window_start).getTime();
      const e = new Date(w.window_end).getTime();
      if (s > cursor) break; // gap before next window
      if (e > cursor) {
        cursor = e;
        usedIds.add(Number(w.window_id));
      }
      if (cursor >= end) return true;
    }
    return cursor >= end;
  };

  const blocked = symbols.filter((s) => !covered(s));
  if (blocked.length > 0) {
    return { pass: false, blocked, windowIds: [], windowSetHash: null, detectors: [], canonicalVersions: [] };
  }

  const used = trustedAll.filter((w) => usedIds.has(Number(w.window_id)));
  const windowIds = [...usedIds].sort((a, b) => a - b);
  const detectors = [...new Set(used.map((w) => w.detector_version))];
  const canonicalVersions = [...new Set(used.map((w) => w.canonical_version).filter(Boolean))];
  const windowSetHash = sha256(canonicalJson({ windowIds, detectors, canonicalVersions }));
  return { pass: true, blocked: [], windowIds, windowSetHash, detectors, canonicalVersions };
}

/**
 * Build the immutable trustedGate metadata block from an evaluateTrustedGate
 * PASS result.
 */
function buildTrustedGateMetadata(result) {
  return {
    mode: "require",
    windowIds: result.windowIds,
    windowSetHash: result.windowSetHash,
    detectors: result.detectors,
    canonicalVersions: result.canonicalVersions,
    gatedAt: new Date().toISOString(),
  };
}

module.exports = { evaluateTrustedGate, buildTrustedGateMetadata };
