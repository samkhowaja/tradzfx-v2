/**
 * Golden-corridor gate helpers.
 *
 * A golden corridor (migration 187) is a certified (symbol, timeframe, window)
 * cell: trusted window + parity-harness-proven feature backfill. Live/shadow
 * runners must refuse jobs outside an active corridor.
 *
 * Fail-open vs fail-closed is the caller's choice:
 *  - `findGoldenCorridor` returns the row or null (pure query).
 *  - `assertGoldenCorridor` returns a verdict; the caller decides whether a
 *    miss blocks. Rollout default is warn; flip with TM_GOLDEN_CORRIDOR_ACTION=block
 *    only after ops acceptance is green (same pattern as producer freshness).
 */

import type { Queryable } from "../utils/db";

export interface GoldenCorridorRow {
  corridor_id: string;
  symbol: string;
  timeframe: string;
  window_start: Date;
  window_end: Date;
  window_id: string;
  set_hash: string;
  harness_version: string;
  detector_version: string;
  canonical_version: string;
  certified_at: Date;
  certified_by: string;
  notes: string | null;
}

export interface GoldenCorridorVerdict {
  covered: boolean;
  corridor?: GoldenCorridorRow;
  reason?: string;
}

/**
 * Find the active golden corridor covering [jobStart, jobEnd] for a
 * (symbol, timeframe) job. Interval must be fully contained in the window.
 */
export async function findGoldenCorridor(
  pool: Queryable,
  opts: {
    symbol: string;
    timeframe: string;
    jobStart: Date;
    jobEnd: Date;
  }
): Promise<GoldenCorridorRow | null> {
  const { rows } = await pool.query(
    `SELECT corridor_id, symbol, timeframe, window_start, window_end, window_id,
            set_hash, harness_version, detector_version, canonical_version,
            certified_at, certified_by, notes
       FROM market.golden_corridors
      WHERE symbol = $1
        AND timeframe = $2
        AND window_start <= $3
        AND window_end >= $4
      ORDER BY certified_at DESC
      LIMIT 1`,
    [opts.symbol, opts.timeframe, opts.jobStart, opts.jobEnd]
  );
  return rows.length > 0 ? (rows[0] as GoldenCorridorRow) : null;
}

/**
 * Verdict wrapper. On DB error the verdict is covered=true with a
 * `gate_offline` reason — a missing/unreachable gate table must not halt
 * trading; ops alerting owns that (matches wall-clock guard philosophy).
 * Callers that require fail-closed behavior check `reason === "gate_offline"`.
 */
export async function assertGoldenCorridor(
  pool: Queryable,
  opts: {
    symbol: string;
    timeframe: string;
    jobStart: Date;
    jobEnd: Date;
    /** Optional tighter check: refuse when the corridor's set hash differs. */
    expectedSetHash?: string;
  }
): Promise<GoldenCorridorVerdict> {
  try {
    const corridor = await findGoldenCorridor(pool, opts);
    if (!corridor) {
      return {
        covered: false,
        reason:
          `BLOCKED_NOT_GOLDEN: no active golden corridor covers ` +
          `${opts.symbol} ${opts.timeframe} ` +
          `[${opts.jobStart.toISOString()} .. ${opts.jobEnd.toISOString()}]`,
      };
    }
    if (opts.expectedSetHash && corridor.set_hash !== opts.expectedSetHash) {
      return {
        covered: false,
        corridor,
        reason:
          `BLOCKED_SET_HASH_MISMATCH: corridor set_hash ${corridor.set_hash} ` +
          `!= expected ${opts.expectedSetHash} (${opts.symbol} ${opts.timeframe})`,
      };
    }
    return { covered: true, corridor };
  } catch (err: any) {
    return {
      covered: true,
      reason: `gate_offline: golden corridor query failed: ${err?.message ?? err}`,
    };
  }
}
