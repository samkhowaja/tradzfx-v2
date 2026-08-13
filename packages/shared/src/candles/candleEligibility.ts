import type { Queryable } from "../utils/db";

export type CandleEligibilityState = "PERSISTED" | "VALIDATING" | "CLEAN" | "BLOCKED" | "ERROR";

export interface CandleIdentity {
  symbol: string;
  broker: string;
  timeframe: string;
  ts: Date;
}

export async function claimCandleForValidation(
  pool: Queryable,
  candle: CandleIdentity
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE market.candle_eligibility
        SET state = 'VALIDATING', validation_started_at = now(), updated_at = now(), error_message = NULL
      WHERE symbol = $1 AND broker = $2 AND timeframe = $3 AND ts = $4
        AND state IN ('PERSISTED', 'ERROR')
      RETURNING 1`,
    [candle.symbol, candle.broker, candle.timeframe, candle.ts]
  );
  return result.rowCount === 1;
}

export async function completeCandleValidation(
  pool: Queryable,
  candle: CandleIdentity,
  result: {
    state: Exclude<CandleEligibilityState, "PERSISTED" | "VALIDATING">;
    validatorVersion: string;
    policyId: number | null;
    evidenceFingerprint: string | null;
    errorMessage?: string | null;
  }
): Promise<boolean> {
  const updated = await pool.query(
    `UPDATE market.candle_eligibility
        SET state = $5, validator_version = $6, policy_id = $7,
            evidence_fingerprint = $8, validation_completed_at = now(),
            updated_at = now(), error_message = $9
      WHERE symbol = $1 AND broker = $2 AND timeframe = $3 AND ts = $4
        AND state = 'VALIDATING'
      RETURNING 1`,
    [candle.symbol, candle.broker, candle.timeframe, candle.ts, result.state,
      result.validatorVersion, result.policyId, result.evidenceFingerprint,
      result.errorMessage ?? null]
  );
  return updated.rowCount === 1;
}

/** Validate one raw candle using only data available at its timestamp. */
export async function validateCandleEligibility(
  pool: Queryable,
  candle: CandleIdentity
): Promise<CandleEligibilityState> {
  if (!(await claimCandleForValidation(pool, candle))) {
    const { rows } = await pool.query<{ state: CandleEligibilityState }>(
      `SELECT state FROM market.candle_eligibility
       WHERE symbol=$1 AND broker=$2 AND timeframe=$3 AND ts=$4`,
      [candle.symbol, candle.broker, candle.timeframe, candle.ts]
    );
    return rows[0]?.state ?? "ERROR";
  }

  try {
    const { rows } = await pool.query<any>(
      `SELECT c.o,c.h,c.l,c.c,c.spread,p.policy_id,
          COALESCE(bool_or(q.id IS NOT NULL AND q.superseded_at IS NULL AND
            (q.approved_at IS NULL OR q.decision <> 'KEEP')), false) blocked,
          COUNT(q.id)::int evidence_count
       FROM candles_1m c
       LEFT JOIN LATERAL (
         SELECT policy_id FROM raw.symbol_broker_policy p
          WHERE p.symbol=c.symbol AND p.broker_id=c.broker
            AND p.effective_from <= c.ts
            AND (p.effective_to IS NULL OR c.ts < p.effective_to)
          ORDER BY p.priority ASC,p.effective_from DESC,p.policy_id DESC LIMIT 1
       ) p ON true
       LEFT JOIN candle_quarantine q
         ON q.symbol=c.symbol AND q.broker=c.broker
        AND q.timeframe='1m' AND q.event_time=c.ts
       WHERE c.symbol=$1 AND c.broker=$2 AND c.ts=$3
       GROUP BY c.o,c.h,c.l,c.c,c.spread,p.policy_id`,
      [candle.symbol, candle.broker, candle.ts]
    );
    const row = rows[0];
    const o = Number(row?.o), h = Number(row?.h), l = Number(row?.l), c = Number(row?.c);
    const spread = row?.spread == null ? null : Number(row.spread);
    const structural = !row || row.policy_id == null
      || ![o, h, l, c].every(Number.isFinite)
      || o < 0 || h < l || h < Math.max(o, c) || l > Math.min(o, c)
      || (spread != null && (!Number.isFinite(spread) || spread < 0));
    const blocked = structural || row.blocked;
    const state = blocked ? "BLOCKED" : "CLEAN";
    await completeCandleValidation(pool, candle, {
      state,
      validatorVersion: "candle-eligibility-v1",
      policyId: row?.policy_id ?? null,
      evidenceFingerprint: `${row?.evidence_count ?? 0}:${blocked ? "blocked" : "clean"}`,
      errorMessage: structural ? "structural or missing policy validation failed" : null,
    });
    return state;
  } catch (error: any) {
    await completeCandleValidation(pool, candle, {
      state: "ERROR", validatorVersion: "candle-eligibility-v1", policyId: null,
      evidenceFingerprint: null, errorMessage: error?.message ?? String(error),
    });
    return "ERROR";
  }
}
