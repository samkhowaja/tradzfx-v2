/**
 * Cross-asset correlation feature.
 * Computes rolling correlation between the primary symbol and a reference symbol
 * (e.g., DXY) over 1h, 4h, and 1d lookback windows.
 * Also detects simple divergence when the short-term slope signs differ.
 */

import type { Candle, FeatureDefinition, CorrelationOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface CorrelationInput {
  candles: Candle[];
  referenceCandles: Record<string, Candle[]>;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0 || n !== y.length) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.c);
}

function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((acc, y, x) => acc + x * y, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function alignCandles(
  primary: Candle[],
  reference: Candle[]
): { primary: number[]; reference: number[] } {
  const refByTs = new Map<string, number>();
  for (const c of reference) {
    refByTs.set(c.ts.toISOString(), c.c);
  }

  const p: number[] = [];
  const r: number[] = [];
  for (const c of primary) {
    const refClose = refByTs.get(c.ts.toISOString());
    if (refClose !== undefined) {
      p.push(c.c);
      r.push(refClose);
    }
  }
  return { primary: p, reference: r };
}

function computeCorrelation(
  primary: Candle[],
  reference: Candle[],
  referenceSymbol: string
): CorrelationOutput["correlations"][number] {
  const last = primary[primary.length - 1];
  const { primary: pCloses, reference: rCloses } = alignCandles(primary, reference);

  const total = pCloses.length;
  const correlation1h = total >= 60 ? pearson(pCloses.slice(-60), rCloses.slice(-60)) : undefined;
  const correlation4h = total >= 240 ? pearson(pCloses.slice(-240), rCloses.slice(-240)) : undefined;
  const correlation1d = total >= 1440 ? pearson(pCloses.slice(-1440), rCloses.slice(-1440)) : undefined;

  const shortWindow = Math.min(20, total);
  const primarySlope = slope(pCloses.slice(-shortWindow));
  const referenceSlope = slope(rCloses.slice(-shortWindow));

  // Divergence is defined relative to the observed short-term correlation:
  //   - Positive correlation: divergence when slopes have opposite signs.
  //   - Negative correlation: divergence when slopes have the same sign.
  const signedCorrelation = correlation1h ?? 0;
  const correlationSign = Math.abs(signedCorrelation) >= 0.3 ? Math.sign(signedCorrelation) : 0;

  let divergenceDetected = false;
  if (shortWindow >= 2 && correlationSign !== 0) {
    const sameSign = (primarySlope > 0 && referenceSlope > 0) || (primarySlope < 0 && referenceSlope < 0);
    divergenceDetected = correlationSign > 0 ? !sameSign : sameSign;
  }

  const divergenceType: "bullish" | "bearish" | undefined = divergenceDetected
    ? primarySlope > 0
      ? "bullish"
      : "bearish"
    : undefined;

  return {
    referenceSymbol,
    correlation1h,
    correlation4h,
    correlation1d,
    divergenceDetected,
    divergenceType,
    ts: last.ts,
  };
}

export const correlationFeature: FeatureDefinition<CorrelationInput, CorrelationOutput> = {
  name: "features_correlation",
  version: "1.1.0",
  dependencies: [],
  referenceSymbols: ["DXY"],

  compute(input): CorrelationOutput {
    const { candles } = input;
    const refs = input.referenceCandles ?? {};
    if (candles.length < 2) return { correlations: [] };

    const correlations: CorrelationOutput["correlations"] = [];
    for (const [referenceSymbol, reference] of Object.entries(refs)) {
      if (!reference || reference.length < 2) continue;
      correlations.push(computeCorrelation(candles, reference, referenceSymbol));
    }

    return { correlations };
  },

  hashInput(input): string {
    const primaryPart = sha256(
      input.candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`).join("|")
    );
    const refParts = Object.entries(input.referenceCandles ?? {})
      .map(
        ([sym, candles]) =>
          `${sym}:${sha256(
            candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`).join("|")
          )}`
      )
      .join("|");
    return sha256(`${primaryPart}:${refParts}`);
  },

  hashOutput(output): string {
    return sha256(
      output.correlations
        .map(
          (c) =>
            `${c.referenceSymbol}:${c.correlation1h ?? ""}:${c.correlation4h ?? ""}:${
              c.correlation1d ?? ""
            }:${c.divergenceDetected}:${c.divergenceType ?? ""}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.correlations.map((c) => ({
      reference_symbol: c.referenceSymbol,
      correlation_1h: c.correlation1h ?? null,
      correlation_4h: c.correlation4h ?? null,
      correlation_1d: c.correlation1d ?? null,
      divergence_detected: c.divergenceDetected ?? false,
      divergence_type: c.divergenceType ?? null,
      ts: c.ts,
    }));
  },

  deserialize(rows): CorrelationOutput {
    return {
      correlations: rows.map((r) => ({
        referenceSymbol: r.reference_symbol as string,
        correlation1h: r.correlation_1h != null ? (r.correlation_1h as number) : undefined,
        correlation4h: r.correlation_4h != null ? (r.correlation_4h as number) : undefined,
        correlation1d: r.correlation_1d != null ? (r.correlation_1d as number) : undefined,
        divergenceDetected: !!r.divergence_detected,
        divergenceType: r.divergence_type ? (r.divergence_type as string) : undefined,
        ts: new Date(r.ts as string),
      })),
    };
  },
};
