/**
 * Displacement feature.
 * Detects strong impulsive moves (large body candles relative to recent range)
 * and counts consecutive displacement candles.
 */

import type { Candle, FeatureDefinition, DisplacementOutput, Direction } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface DisplacementInput {
  candles: Candle[];
}

interface CandleGrade {
  grade: DisplacementOutput["grade"];
  bodyPct: number;
  direction: Direction;
}

function gradeCandle(candles: Candle[], index: number): CandleGrade {
  if (index < 5) return { grade: "NONE", bodyPct: 0, direction: "neutral" };

  const recent = candles.slice(index - 5, index);
  const avgRange = recent.reduce((sum, c) => sum + (c.h - c.l), 0) / recent.length;

  const c = candles[index];
  const body = Math.abs(c.c - c.o);
  const range = c.h - c.l;
  const bodyPct = range > 0 ? body / range : 0;
  const rangeMultiplier = avgRange > 0 ? range / avgRange : 0;

  let grade: DisplacementOutput["grade"] = "NONE";
  if (rangeMultiplier >= 2.0 && bodyPct >= 0.7) grade = "HIGH";
  else if (rangeMultiplier >= 1.5 && bodyPct >= 0.6) grade = "MEDIUM";
  else if (rangeMultiplier >= 1.2 && bodyPct >= 0.5) grade = "LOW";

  const direction: Direction = c.c > c.o ? "bullish" : "bearish";
  return { grade, bodyPct, direction };
}

function detectDisplacement(candles: Candle[]): DisplacementOutput {
  if (candles.length < 10) {
    return { grade: "NONE", direction: "neutral", bodyPct: 0, consecutiveCount: 0, sequenceGrade: "NONE" };
  }

  const lastIndex = candles.length - 1;
  const last = gradeCandle(candles, lastIndex);

  // Count consecutive displacement candles ending at the latest candle
  let consecutiveCount = 0;
  let totalBodyPct = 0;
  let minGrade: DisplacementOutput["grade"] = "NONE";

  for (let i = lastIndex; i >= 0; i--) {
    const g = gradeCandle(candles, i);
    if (g.grade === "NONE") break;
    // Break streak if direction flips (we want same-direction impulse)
    if (consecutiveCount > 0 && g.direction !== last.direction) break;
    consecutiveCount++;
    totalBodyPct += g.bodyPct;
    if (minGrade === "NONE" || gradeRank(g.grade) > gradeRank(minGrade)) {
      minGrade = g.grade;
    }
  }

  const avgBodyPct = consecutiveCount > 0 ? totalBodyPct / consecutiveCount : 0;

  let sequenceGrade: DisplacementOutput["sequenceGrade"] = "NONE";
  if (consecutiveCount >= 3 && (last.grade === "HIGH" || minGrade === "HIGH")) sequenceGrade = "HIGH";
  else if (consecutiveCount >= 2 && last.grade !== "NONE") sequenceGrade = "MEDIUM";
  else if (consecutiveCount >= 1) sequenceGrade = "LOW";

  return {
    grade: last.grade,
    direction: last.direction,
    bodyPct: last.bodyPct,
    consecutiveCount,
    sequenceGrade,
  };
}

function gradeRank(grade: DisplacementOutput["grade"]): number {
  switch (grade) {
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    case "LOW":
      return 1;
    default:
      return 0;
  }
}

export const displacementFeature: FeatureDefinition<DisplacementInput, DisplacementOutput> = {
  name: "features_displacement",
  version: "1.2.0",
  dependencies: [],

  compute(input): DisplacementOutput {
    return detectDisplacement(input.candles);
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      `${output.grade}:${output.direction}:${output.bodyPct}:${output.consecutiveCount}:${output.sequenceGrade}`
    );
  },

  serialize(output): Record<string, unknown>[] {
    return [
      {
        grade: output.grade,
        direction: output.direction,
        body_pct: output.bodyPct,
        consecutive_count: output.consecutiveCount,
        sequence_grade: output.sequenceGrade,
      },
    ];
  },

  deserialize(rows): DisplacementOutput {
    const r = rows[0];
    if (!r) return { grade: "NONE", direction: "neutral", bodyPct: 0, consecutiveCount: 0, sequenceGrade: "NONE" };
    return {
      grade: r.grade as DisplacementOutput["grade"],
      direction: r.direction as Direction,
      bodyPct: r.body_pct as number,
      consecutiveCount: r.consecutive_count as number | undefined,
      sequenceGrade: r.sequence_grade as DisplacementOutput["sequenceGrade"] | undefined,
    };
  },
};
