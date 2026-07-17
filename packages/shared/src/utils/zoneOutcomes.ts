/**
 * Zone outcome tracking.
 *
 * Records forward-looking outcomes for completed zones so the quality model can
 * learn from history instead of relying solely on heuristics.
 */

import type { Pool } from "./db";
import type { ZoneOutput, ZoneOutcomeStats } from "../types/feature";

const STATS_CACHE_TTL_MS = Number(process.env.ZONE_OUTCOME_STATS_CACHE_TTL_MS ?? "60000");
const statsCache = new Map<string, { cachedAt: number; value: ZoneOutcomeStats | null }>();

function statsCacheKey(symbol: string, tf: string, zoneKind: string): string {
  return `${symbol}:${tf}:${zoneKind}`;
}

export interface ZoneOutcomeInput {
  symbol: string;
  tf: string;
  zoneKind: string;
  direction?: "bullish" | "bearish";
  top: number;
  bottom: number;
  formationTs: Date;
  candles: Array<{ o: number; h: number; l: number; c: number; ts: Date }>;
  mitigatedAt?: Date;
  invalidatedAt?: Date;
}

export function determineZoneOutcome(
  input: ZoneOutcomeInput
): {
  outcome: "reversal" | "mitigated" | "invalidated" | "untouched";
  maxFavorable: number;
  maxAdverse: number;
  exitTs?: Date;
} {
  const { candles, mitigatedAt, invalidatedAt, top, bottom, zoneKind, direction: inputDirection } = input;
  const direction = inputDirection ?? (zoneKind === "supply" || zoneKind === "bearish" ? "bearish" : "bullish");

  if (invalidatedAt) {
    return { outcome: "invalidated", maxFavorable: 0, maxAdverse: top - bottom, exitTs: invalidatedAt };
  }

  if (!mitigatedAt || candles.length === 0) {
    return { outcome: "untouched", maxFavorable: 0, maxAdverse: 0 };
  }

  const mitigatedIndex = candles.findIndex((c) => c.ts.getTime() >= mitigatedAt.getTime());
  const post = mitigatedIndex >= 0 ? candles.slice(mitigatedIndex) : candles;

  let maxFavorable = 0;
  let maxAdverse = 0;

  for (const c of post) {
    if (direction === "bullish") {
      maxFavorable = Math.max(maxFavorable, c.h - top);
      maxAdverse = Math.max(maxAdverse, bottom - c.l);
    } else {
      maxFavorable = Math.max(maxFavorable, bottom - c.l);
      maxAdverse = Math.max(maxAdverse, c.h - top);
    }
  }

  // Reversal = mitigated and then moved favorably more than 1.5x adverse
  const outcome: "reversal" | "mitigated" =
    maxFavorable > maxAdverse * 1.5 && maxFavorable > 0 ? "reversal" : "mitigated";

  return {
    outcome,
    maxFavorable,
    maxAdverse,
    exitTs: post[post.length - 1]?.ts,
  };
}

export async function recordZoneOutcome(
  pool: Pool,
  input: ZoneOutcomeInput
): Promise<void> {
  const { outcome, maxFavorable, maxAdverse, exitTs } = determineZoneOutcome(input);
  if (outcome === "untouched") return;

  try {
    await pool.query(
      `INSERT INTO zone_outcomes (
         symbol, tf, zone_kind, direction, top, bottom, formation_ts,
         outcome, max_favorable, max_adverse, exit_ts
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (symbol, tf, zone_kind, direction, top, bottom, formation_ts) DO UPDATE SET
         outcome = EXCLUDED.outcome,
         max_favorable = EXCLUDED.max_favorable,
         max_adverse = EXCLUDED.max_adverse,
         exit_ts = EXCLUDED.exit_ts`,
      [
        input.symbol,
        input.tf,
        input.zoneKind,
        input.direction ?? null,
        input.top,
        input.bottom,
        input.formationTs,
        outcome,
        maxFavorable,
        maxAdverse,
        exitTs ?? null,
      ]
    );
    // Invalidate cached stats so the next zone quality calculation sees the
    // newly-recorded outcome.
    statsCache.delete(statsCacheKey(input.symbol, input.tf, input.zoneKind));
  } catch (err: any) {
    console.warn(`[zoneOutcomes] Failed to record outcome:`, err.message);
  }
}

export async function getZoneOutcomeStats(
  pool: Pool,
  symbol: string,
  tf: string,
  zoneKind: string,
  minSamples = 30
): Promise<ZoneOutcomeStats | null> {
  const key = statsCacheKey(symbol, tf, zoneKind);
  const now = Date.now();
  const cached = statsCache.get(key);
  if (cached && now - cached.cachedAt < STATS_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const { rows } = await pool.query<{
      count: number;
      reversal_count: number;
      avg_reward: number;
      avg_risk: number;
    }>(
      `SELECT
         COUNT(*)::int AS count,
         COUNT(*) FILTER (WHERE outcome = 'reversal')::int AS reversal_count,
         COALESCE(AVG(max_favorable), 0) AS avg_reward,
         COALESCE(AVG(max_adverse), 0) AS avg_risk
       FROM zone_outcomes
       WHERE symbol = $1 AND tf = $2 AND zone_kind = $3`,
      [symbol, tf, zoneKind]
    );
    const row = rows[0];
    let result: ZoneOutcomeStats | null = null;
    if (row && row.count >= minSamples) {
      const reversalRate = row.count > 0 ? row.reversal_count / row.count : 0;
      const avgReward = row.avg_reward;
      const avgRisk = Math.max(row.avg_risk, 1e-9);
      const expectancy = reversalRate * (avgReward / avgRisk) - (1 - reversalRate);

      result = {
        symbol,
        tf: tf as any,
        zoneKind,
        sampleCount: row.count,
        reversalRate,
        avgReward,
        avgRisk,
        expectancy,
      };
    }

    statsCache.set(key, { cachedAt: now, value: result });
    return result;
  } catch (err: any) {
    console.warn(`[zoneOutcomes] Failed to load stats for ${symbol}/${tf}/${zoneKind}:`, err.message);
    return null;
  }
}
