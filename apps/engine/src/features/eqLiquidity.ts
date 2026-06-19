/**
 * Equal High / Equal Low liquidity feature.
 *
 * Clusters recent swing pivot highs/lows that sit within an ATR tolerance of each
 * other. These equal highs/lows are classic SMC liquidity magnets.
 */

import type { Candle, FeatureDefinition, EqLiquidityOutput, Direction } from "@tm/shared";
import { sha256 } from "@tm/shared";
import type { PivotOutput, AtrOutput } from "@tm/shared";

export interface EqLiquidityInput {
  candles: Candle[];
  features_pivot: PivotOutput;
  features_atr: AtrOutput;
}

interface Cluster {
  price: number;
  latestTs: Date;
  count: number;
  kind: "eqh" | "eql";
}

function clusterLevels(
  pivots: { price: number; ts: Date }[],
  kind: "eqh" | "eql",
  tolerance: number
): Cluster[] {
  if (pivots.length === 0 || tolerance <= 0) return [];

  // Sort by price
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: Cluster[] = [];

  let current: Cluster | null = null;
  for (const p of sorted) {
    if (!current || Math.abs(p.price - current.price) > tolerance) {
      if (current) clusters.push(current);
      current = { price: p.price, latestTs: p.ts, count: 1, kind };
    } else {
      current.count += 1;
      current.price = (current.price * current.count + p.price) / (current.count + 1);
      if (p.ts.getTime() > current.latestTs.getTime()) current.latestTs = p.ts;
    }
  }
  if (current) clusters.push(current);

  // Require at least 2 pivots to call it EQH/EQL
  return clusters.filter((c) => c.count >= 2);
}

function detectEqLiquidity(
  candles: Candle[],
  pivots: PivotOutput["pivots"],
  atrValue: number
): EqLiquidityOutput["levels"] {
  if (candles.length < 10 || pivots.length < 2) return [];

  const maxAgeBars = 100;
  const cutoffIndex = Math.max(0, candles.length - maxAgeBars);
  const cutoffTs = candles[cutoffIndex].ts.getTime();

  const threshold = 0.15 * atrValue; // 15% of ATR tolerance

  const recentHighs = pivots
    .filter((p) => p.kind === "high" && p.ts.getTime() >= cutoffTs)
    .map((p) => ({ price: p.price, ts: p.ts }));

  const recentLows = pivots
    .filter((p) => p.kind === "low" && p.ts.getTime() >= cutoffTs)
    .map((p) => ({ price: p.price, ts: p.ts }));

  const highClusters = clusterLevels(recentHighs, "eqh", threshold);
  const lowClusters = clusterLevels(recentLows, "eql", threshold);

  const last = candles[candles.length - 1];
  const touchTolerance = 0.05 * atrValue;

  const makeLevel = (c: Cluster): EqLiquidityOutput["levels"][number] => ({
    kind: c.kind,
    price: c.price,
    ts: c.latestTs,
    strength: Math.min(1, c.count / 5),
    touched: Math.abs(last.c - c.price) <= touchTolerance,
  });

  return [...highClusters, ...lowClusters].map(makeLevel);
}

export const eqLiquidityFeature: FeatureDefinition<EqLiquidityInput, EqLiquidityOutput> = {
  name: "features_eq_liquidity",
  version: "1.1.0",
  dependencies: ["features_pivot", "features_atr"],

  compute(input): EqLiquidityOutput {
    const atrRows = input.features_atr.values;
    const atrValue = atrRows.length ? (atrRows[atrRows.length - 1].value ?? 0) : 0;
    if (!atrValue) return { levels: [] };

    return { levels: detectEqLiquidity(input.candles, input.features_pivot.pivots, atrValue) };
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|") +
        "|" +
        input.features_pivot.pivots
          .map((p) => `${p.ts.toISOString()}:${p.kind}:${p.price}`)
          .join("|") +
        "|" +
        input.features_atr.values.map((v) => `${v.period}:${v.value}`).join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.levels
        .map((l) => `${l.ts.toISOString()}:${l.kind}:${l.price}:${l.strength}:${l.touched}`)
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.levels.map((l) => ({
      kind: l.kind,
      price: l.price,
      ts: l.ts,
      strength: l.strength ?? 0,
      touched: l.touched ?? false,
    }));
  },

  deserialize(rows): EqLiquidityOutput {
    return {
      levels: rows.map((r) => ({
        kind: r.kind as "eqh" | "eql",
        price: r.price as number,
        ts: new Date(r.ts as string),
        strength: ((r.strength as number | undefined) ?? 0),
        touched: r.touched as boolean,
      })),
    };
  },
};
