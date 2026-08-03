"use strict";

/**
 * Backfill readiness cell evaluation (Data Readiness Contract).
 *
 * Per (feature, symbol, tf, window), decides whether stored rows + producer
 * ledger prove completeness:
 *  - unsupported feature/tf combos    → NOT_APPLICABLE (registry contract)
 *  - missing/failed producer run      → BLOCKED_PRODUCER
 *  - producer source edge behind      → BLOCKED_EDGE
 *  - producer version below contract  → BLOCKED_VERSION
 *  - rejected persistence batch       → BLOCKED_PERSIST
 *  - dense: internal anchor gaps      → BLOCKED_COVERAGE (missingAnchors)
 *    (duplicate-anchor invariant only for single-row contracts; multi-row
 *     features declaring equalityGroupByDefaults legitimately store N rows/anchor)
 *  - sparse/session_scoped: producer evidence only (zero rows is legitimate)
 */

const DENSE_MODE = "dense";
const { getFeatureContract } = require("../../packages/strategies/dist/index.js");
const { getCandleTableForTf, isTradableInstant } = require("../../packages/shared/dist/index.js");

function asIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function versionTuple(v) {
  return String(v ?? "").split(".").map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function versionGte(a, b) {
  const A = versionTuple(a), B = versionTuple(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0, y = B[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

function evaluateBackfillCell(input) {
  const { feature, symbol, tf, mode, sourceMinTs, sourceMaxTs } = input;
  const contract = getFeatureContract(feature);
  const base = {
    feature,
    symbol,
    tf,
    mode,
    sourceMinTs: asIso(sourceMinTs),
    sourceMaxTs: asIso(sourceMaxTs),
    persistedRows: Number(input.persisted?.row_count || 0),
    persistedMinTs: asIso(input.persisted?.min_ts),
    persistedMaxTs: asIso(input.persisted?.max_ts),
    producerRunId: input.latestRun?.run_id ?? null,
    producerStatus: input.latestRun?.status ?? null,
    producerVersion: input.latestRun?.producer_version ?? null,
    producerWatermarkTs: asIso(input.latestRun?.watermark_ts),
    producerSourceMaxTs: asIso(input.latestRun?.source_max_ts),
    persistRejected: Number(input.persistRejected ?? 0),
    missingAnchors: null,
    duplicateAnchors: null,
    expectedAnchors: null,
    nullRows: null,
    verdict: "READY",
    reason: null,
  };

  // Contract-invalid feature/timeframe combination: not a coverage failure.
  if (contract?.supportedTimeframes && !contract.supportedTimeframes.includes(tf)) {
    return { ...base, verdict: "NOT_APPLICABLE", reason: "unsupported_timeframe" };
  }

  if (!input.latestRun) {
    return { ...base, verdict: "BLOCKED_PRODUCER", reason: "producer_run_missing" };
  }
  if (input.latestRun.status !== "done") {
    return {
      ...base,
      verdict: "BLOCKED_PRODUCER",
      reason: input.latestRun.error_message || `producer_status_${input.latestRun.status}`,
    };
  }
  const runSourceMax = input.latestRun.source_max_ts ? new Date(input.latestRun.source_max_ts).getTime() : NaN;
  if (!Number.isFinite(runSourceMax) || runSourceMax < sourceMaxTs.getTime()) {
    return { ...base, verdict: "BLOCKED_EDGE", reason: "producer_source_edge_behind" };
  }
  if (contract?.minimumProducerVersion && !versionGte(input.latestRun.producer_version, contract.minimumProducerVersion)) {
    return {
      ...base,
      verdict: "BLOCKED_VERSION",
      reason: `producer_version_${input.latestRun.producer_version}_below_${contract.minimumProducerVersion}`,
    };
  }
  if (base.persistRejected > 0) {
    return { ...base, verdict: "BLOCKED_PERSIST", reason: `persist_rejected_${base.persistRejected}` };
  }

  if (mode === DENSE_MODE) {
    const expected = Number(input.expectedAnchors ?? NaN);
    const missing = Number(input.missingAnchors ?? NaN);
    const dupes = Number(input.duplicateAnchors ?? NaN);
    const nullRows = Number(input.nullRows ?? 0);
    base.expectedAnchors = Number.isFinite(expected) ? expected : null;
    base.missingAnchors = Number.isFinite(missing) ? missing : null;
    base.duplicateAnchors = Number.isFinite(dupes) ? dupes : null;
    base.nullRows = nullRows;

    if (base.persistedRows === 0) {
      return { ...base, verdict: "BLOCKED_COVERAGE", reason: "dense_output_empty" };
    }
    if (Number.isFinite(missing) && missing > 0) {
      return { ...base, verdict: "BLOCKED_COVERAGE", reason: `dense_anchor_gaps_${missing}` };
    }
    // Multi-row-per-anchor features (contract declares equality dimensions such
    // as period/ma_type/kind) legitimately store several rows per anchor; the
    // duplicate-anchor invariant only applies to single-row dense features.
    const multiRowPerAnchor = (contract?.equalityGroupByDefaults?.length ?? 0) > 0;
    if (!multiRowPerAnchor && Number.isFinite(dupes) && dupes > 0) {
      return { ...base, verdict: "BLOCKED_COVERAGE", reason: `dense_duplicate_anchors_${dupes}` };
    }
    if (nullRows > 0) {
      return { ...base, verdict: "BLOCKED_COVERAGE", reason: `required_null_rows_${nullRows}` };
    }
    const persistedMax = input.persisted?.max_ts ? new Date(input.persisted.max_ts).getTime() : NaN;
    if (!Number.isFinite(persistedMax) || persistedMax < sourceMaxTs.getTime()) {
      return { ...base, verdict: "BLOCKED_EDGE", reason: "dense_output_edge_behind" };
    }
  }

  return base;
}

async function verifyBackfillCell(pool, input) {
  const { feature, symbol, tf, mode, sourceMinTs, sourceMaxTs } = input;
  const contract = getFeatureContract(feature);

  // Skip heavy data queries for contract-invalid combos.
  if (contract?.supportedTimeframes && !contract.supportedTimeframes.includes(tf)) {
    return evaluateBackfillCell({ ...input, persisted: null, latestRun: null });
  }

  const dense = mode === DENSE_MODE;
  const queries = {
    stats: pool.query(
      `SELECT COUNT(*)::bigint AS row_count, MIN(ts) AS min_ts, MAX(ts) AS max_ts
         FROM ${feature}
        WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4`,
      [symbol, tf, sourceMinTs, sourceMaxTs]
    ),
    run: pool.query(
      `SELECT run_id, status, error_message, producer_version, watermark_ts, source_max_ts,
              COALESCE((quality_json->>'rows_rejected')::bigint, 0) AS persist_rejected
         FROM feature_producer_runs
        WHERE producer = 'engine' AND feature_table = $1 AND symbol = $2 AND tf = $3
        ORDER BY COALESCE(finished_at, started_at) DESC, run_id DESC
        LIMIT 1`,
      [feature, symbol, tf]
    ),
  };
  if (dense) {
    queries.distinctTss = pool.query(
      `SELECT DISTINCT ts FROM ${feature}
        WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4 ORDER BY ts`,
      [symbol, tf, sourceMinTs, sourceMaxTs]
    );
    const sourceHasTickCount = tf !== "1m" && tf !== "1d";
    queries.sourceTss = pool.query(
      `SELECT DISTINCT ts FROM ${getCandleTableForTf(tf)}
        WHERE symbol = $1 AND ts >= $2 AND ts <= $3
          ${sourceHasTickCount ? "AND tick_count > 0" : ""}
        ORDER BY ts`,
      [symbol, sourceMinTs, sourceMaxTs]
    );
    const nullCols = (contract?.requiredColumns ?? []).filter(
      (c) => !["symbol", "tf", "ts", "date", "engine_ver", "input_hash"].includes(c)
    );
    if (nullCols.length) {
      queries.nulls = pool.query(
        `SELECT COUNT(*)::bigint AS null_rows FROM ${feature}
          WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4
            AND (${nullCols.map((c) => `${c} IS NULL`).join(" OR ")})`,
        [symbol, tf, sourceMinTs, sourceMaxTs]
      );
    }
  }

  const [stats, run, distinct, source, nulls] = await Promise.all([
    queries.stats,
    queries.run,
    dense ? queries.distinctTss : Promise.resolve(null),
    dense ? queries.sourceTss : Promise.resolve(null),
    dense && queries.nulls ? queries.nulls : Promise.resolve(null),
  ]);

  let expectedAnchors = null, missingAnchors = null, duplicateAnchors = null;
  if (dense) {
    const persistedSet = new Set(
      (distinct?.rows ?? []).map((r) => (r.ts instanceof Date ? r.ts.getTime() : new Date(r.ts).getTime()))
    );
    const expected = (source?.rows ?? [])
      .map((r) => (r.ts instanceof Date ? r.ts : new Date(r.ts)))
      .filter((ts) => isTradableInstant(ts, symbol))
      .map((ts) => ts.getTime());
    expectedAnchors = expected.length;
    missingAnchors = expected.filter((t) => !persistedSet.has(t)).length;
    duplicateAnchors = Number(stats.rows[0]?.row_count ?? 0) - persistedSet.size;
  }

  return evaluateBackfillCell({
    ...input,
    persisted: stats.rows[0],
    latestRun: run.rows[0],
    persistRejected: run.rows[0]?.persist_rejected ?? 0,
    expectedAnchors,
    missingAnchors,
    duplicateAnchors,
    nullRows: nulls?.rows?.[0]?.null_rows ?? 0,
  });
}

module.exports = { evaluateBackfillCell, verifyBackfillCell, versionGte };
