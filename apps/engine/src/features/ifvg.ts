/**
 * Inverse Fair Value Gap (iFVG) feature.
 *
 * Detects standard FVGs that have been mitigated (filled) and then reversed,
 * leaving the original zone as a likely support/resistance level.
 *
 * Heuristic (proxy):
 * - Bullish iFVG: bullish FVG (c1.high < c3.low) is filled >= 50%
 *   and the latest close is back above the zone top.
 * - Bearish iFVG: bearish FVG (c1.low > c3.high) is filled >= 50%
 *   and the latest close is back below the zone bottom.
 */

import type { Candle, FeatureDefinition, IfvgOutput, Direction } from "@tm/shared";
import { sha256, computeIfvgLifecycle } from "@tm/shared";

export interface IfvgInput {
  candles: Candle[];
}

interface RawFvg {
  direction: Direction;
  top: number;
  bottom: number;
  formationIndex: number;
}

const MIN_FILL_PCT = 0.5;
const MAX_AGE_BARS = 50;

function detectFVGs(candles: Candle[]): RawFvg[] {
  const fvgs: RawFvg[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    if (c1.h < c3.l) {
      fvgs.push({ direction: "bullish", top: c3.l, bottom: c1.h, formationIndex: i });
    }
    if (c1.l > c3.h) {
      fvgs.push({ direction: "bearish", top: c1.l, bottom: c3.h, formationIndex: i });
    }
  }
  return fvgs;
}

function computeFillPct(fvg: RawFvg, candles: Candle[], fromIndex: number): number {
  const height = fvg.top - fvg.bottom;
  if (height <= 0) return 0;
  let extreme = 0;
  for (let i = fromIndex; i < candles.length; i++) {
    const c = candles[i];
    if (fvg.direction === "bullish") {
      // Fill is price dropping into the zone
      const penetration = Math.max(0, fvg.top - c.l);
      extreme = Math.max(extreme, penetration);
    } else {
      // Fill is price rising into the zone
      const penetration = Math.max(0, c.h - fvg.bottom);
      extreme = Math.max(extreme, penetration);
    }
  }
  return Math.min(1, extreme / height);
}

function isReversed(fvg: RawFvg, last: Candle): boolean {
  if (fvg.direction === "bullish") {
    return last.c > fvg.top;
  }
  return last.c < fvg.bottom;
}

export const ifvgFeature: FeatureDefinition<IfvgInput, IfvgOutput> = {
  name: "features_ifvg",
  version: "1.1.0",
  dependencies: [],

  compute(input): IfvgOutput {
    const { candles } = input;
    const ifvgs: IfvgOutput["ifvgs"] = [];
    if (candles.length < 5) return { ifvgs };

    const last = candles[candles.length - 1];
    const fvgs = detectFVGs(candles);

    for (const fvg of fvgs) {
      const ageBars = candles.length - 1 - fvg.formationIndex;
      if (ageBars < 0 || ageBars > MAX_AGE_BARS) continue;

      const fillPct = computeFillPct(fvg, candles, fvg.formationIndex + 1);
      if (fillPct < MIN_FILL_PCT) continue;
      if (!isReversed(fvg, last)) continue;

      const strengthScore = Math.min(1, fillPct * 0.6 + (ageBars < 10 ? 0.4 : 0));
      const lifecycle = computeIfvgLifecycle(
        { direction: fvg.direction, top: fvg.top, bottom: fvg.bottom },
        candles,
        fvg.formationIndex
      );
      ifvgs.push({
        direction: fvg.direction,
        top: fvg.top,
        bottom: fvg.bottom,
        fillPct: lifecycle.fillPct ?? fillPct,
        tapped: !!lifecycle.firstTouchAt,
        originatingZoneTs: candles[fvg.formationIndex].ts,
        ts: last.ts,
        ageBars,
        isFresh: !lifecycle.invalidatedAt,
        strengthScore,
        firstTouchAt: lifecycle.firstTouchAt,
        mitigatedAt: lifecycle.mitigatedAt,
        invalidatedAt: lifecycle.invalidatedAt,
      });
    }

    return { ifvgs };
  },

  hashInput(input): string {
    return sha256(
      input.candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`).join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.ifvgs
        .map(
          (z) =>
            `${z.ts.toISOString()}:${z.direction}:${z.top}:${z.bottom}:${z.firstTouchAt?.toISOString() ?? ""}:${z.mitigatedAt?.toISOString() ?? ""}:${z.invalidatedAt?.toISOString() ?? ""}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.ifvgs.map((z) => ({
      direction: z.direction,
      top: z.top,
      bottom: z.bottom,
      fill_pct: z.fillPct ?? null,
      tapped: z.tapped ?? false,
      age_bars: z.ageBars ?? null,
      is_fresh: z.isFresh ?? true,
      strength_score: z.strengthScore ?? null,
      originating_zone_ts: z.originatingZoneTs ?? null,
      ts: z.ts,
      first_touch_at: z.firstTouchAt ?? null,
      mitigated_at: z.mitigatedAt ?? null,
      invalidated_at: z.invalidatedAt ?? null,
    }));
  },

  deserialize(rows): IfvgOutput {
    return {
      ifvgs: rows.map((r) => ({
        direction: r.direction as Direction,
        top: r.top as number,
        bottom: r.bottom as number,
        fillPct: r.fill_pct as number | undefined,
        tapped: r.tapped as boolean,
        originatingZoneTs: r.originating_zone_ts ? new Date(r.originating_zone_ts as string) : undefined,
        ts: new Date(r.ts as string),
        ageBars: r.age_bars as number | undefined,
        isFresh: r.is_fresh as boolean | undefined,
        strengthScore: r.strength_score as number | undefined,
        firstTouchAt: r.first_touch_at ? new Date(r.first_touch_at as string) : undefined,
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at as string) : undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at as string) : undefined,
      })),
    };
  },
};
