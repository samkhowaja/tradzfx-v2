/**
 * Inverse Fair Value Gap (iFVG) feature v1.4.1.
 *
 * Detects standard FVGs that have been mitigated (filled) and then reversed,
 * leaving the original zone as a likely support/resistance level.
 *
 * v1.4.1 (P0-C / SK-61): row `ts` is the FVG **formation** time
 * (`originating_zone_ts`), not the evaluation anchor. The feature registry
 * contract (`features_ifvg.validityColumns.createdAt = "ts"`), the lifecycle
 * function `refresh_ifvg_lifecycle` (which scans candles forward from `ts`)
 * and the `ifvg_inv_after_ts` / `ifvg_mit_after_ts` CHECK invariants all require
 * `ts` to be the formation time. Emitting `ts = last candle` (anchor) made
 * `invalidated_at < ts` for already-invalidated FVGs, so every live-edge row
 * was rejected by the CHECK and `features_ifvg` froze. Lifecycle timestamps
 * (first_touch / mitigated / invalidated) are computed forward from formation
 * and are therefore always `>= formation_ts`, satisfying the invariants. As a
 * side effect this collapses the previous one-row-per-anchor bloat to one
 * upserted row per unique FVG (PK keyed by formation ts), matching
 * `features_zone` / `features_order_block`.
 *
 * Heuristic (proxy):
 * - Bullish iFVG: bullish FVG (c1.high < c3.low) is filled >= 50%
 *   and the latest close is back above the zone top.
 * - Bearish iFVG: bearish FVG (c1.low > c3.high) is filled >= 50%
 *   and the latest close is back below the zone bottom.
 *
 * v1.4.0 changes (Track B — FVG/iFVG lifecycle):
 *   - TF-dependent MAX_AGE_BARS.  The previous fixed value of 50 meant
 *     very different things on different TFs (50 minutes on a 1m chart,
 *     50 days on a 1d chart).  The COMPREHENSIVE_AUDIT_REPORT flagged
 *     this as the root cause of stale iFVGs polluting the entry zone
 *     candidates on higher-TF specs.
 *   - Lookup table: 1m=120, 5m=80, 15m=50, 1h=30, 4h=20, 1d=10.
 *   - The IFVG_MAX_AGE_BARS env var still overrides the table when set,
 *     so operators can tune without redeploying.
 */

import type { Candle, FeatureDefinition, IfvgOutput, Direction, TimeFrame } from "@tm/shared";
import { sha256, computeIfvgLifecycle, detectRawFvgs } from "@tm/shared";
import type { RawFvg } from "@tm/shared";
import {
  IFVG_MIN_FILL_PCT,
  IFVG_MIN_CONFIRMATIONS,
  IFVG_TF_MAX_AGE_BARS,
} from "../params";

export interface IfvgInput {
  candles: Candle[];
}

const TF_MAX_AGE_BARS: Record<TimeFrame, number> = IFVG_TF_MAX_AGE_BARS;
const IFVG_MAX_AGE_BARS_ENV = Number(process.env.IFVG_MAX_AGE_BARS ?? "50");
const DEFAULT_MAX_AGE_BARS = 50;

function maxAgeFor(tf: TimeFrame | undefined): number {
  // Env override always wins so operators can tune without redeploying.
  if (process.env.IFVG_MAX_AGE_BARS) return IFVG_MAX_AGE_BARS_ENV;
  if (!tf) return DEFAULT_MAX_AGE_BARS;
  return TF_MAX_AGE_BARS[tf] ?? DEFAULT_MAX_AGE_BARS;
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

function countConfirmations(fvg: RawFvg, candles: Candle[], fromIndex: number): number {
  let consecutive = 0;
  for (let i = fromIndex; i < candles.length; i++) {
    const c = candles[i];
    const range = c.h - c.l;
    const bodyPct = range > 0 ? Math.abs(c.c - c.o) / range : 0;
    const outside =
      fvg.direction === "bullish" ? c.c > fvg.top : c.c < fvg.bottom;
    if (outside && bodyPct >= 0.5) {
      consecutive++;
      if (consecutive >= IFVG_MIN_CONFIRMATIONS) {
        return consecutive;
      }
    } else {
      // A close back inside the zone (or a weak/indecisive close outside)
      // breaks the confirmation streak.
      consecutive = 0;
    }
  }
  return consecutive;
}

export const ifvgFeature: FeatureDefinition<IfvgInput, IfvgOutput> = {
  name: "features_ifvg",
  version: "1.4.1",
  dependencies: [],
  computePolicy: "onEvent",

  compute(input, ctx): IfvgOutput {
    const { candles } = input;
    const ifvgs: IfvgOutput["ifvgs"] = [];
    if (candles.length < 5) return { ifvgs };

    const last = candles[candles.length - 1];
    const fvgs = detectRawFvgs(candles);
    const maxAge = maxAgeFor(ctx?.tf);

    for (const fvg of fvgs) {
      const ageBars = candles.length - 1 - fvg.formationIndex;
      if (ageBars < 0 || ageBars > maxAge) continue;

      const fillPct = computeFillPct(fvg, candles, fvg.formationIndex + 1);
      if (fillPct < IFVG_MIN_FILL_PCT) continue;

      const confirmationCount = countConfirmations(fvg, candles, fvg.formationIndex + 1);
      if (confirmationCount < IFVG_MIN_CONFIRMATIONS) continue;

      const strengthScore = Math.min(
        1,
        fillPct * 0.4 + confirmationCount * 0.15 + (ageBars < 10 ? 0.25 : 0)
      );
      const lifecycle = computeIfvgLifecycle(
        { direction: fvg.direction, top: fvg.top, bottom: fvg.bottom },
        candles,
        fvg.formationIndex
      );
      const formationTs = candles[fvg.formationIndex].ts;
      ifvgs.push({
        direction: fvg.direction,
        top: fvg.top,
        bottom: fvg.bottom,
        fillPct: lifecycle.fillPct ?? fillPct,
        tapped: !!lifecycle.firstTouchAt,
        originatingZoneTs: formationTs,
        ts: formationTs,
        ageBars,
        isFresh: !lifecycle.invalidatedAt,
        strengthScore,
        confirmationCount,
        firstTouchAt: lifecycle.firstTouchAt,
        mitigatedAt: lifecycle.mitigatedAt,
        invalidatedAt: lifecycle.invalidatedAt,
      });
    }

    return { ifvgs };
  },

  hashInput(input): string {
    return sha256(
      `ifvg:v1.4.1:` +
        input.candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`).join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.ifvgs
        .map(
          (z) =>
            `${z.ts.toISOString()}:${z.direction}:${z.top}:${z.bottom}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.ifvgs.map((z) => ({
      direction: z.direction,
      top: z.top,
      bottom: z.bottom,
      age_bars: z.ageBars ?? null,
      strength_score: z.strengthScore ?? null,
      confirmation_count: z.confirmationCount ?? null,
      originating_zone_ts: z.originatingZoneTs ?? null,
      ts: z.ts,
      // Lifecycle columns — engine sets initial values; SQL refresh_ifvg_lifecycle()
      // re-evaluates on each cycle.  is_fresh mirrors !invalidated_at (no fresh
      // override for iFVG — freshness = no close-back-inside the gap yet).
      is_fresh: !z.invalidatedAt,
      invalidated_at: z.invalidatedAt ?? null,
      mitigated_at: z.mitigatedAt ?? null,
      first_touch_at: z.firstTouchAt ?? null,
      fill_pct: z.fillPct ?? 0,
      tapped: z.tapped,
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
        confirmationCount: r.confirmation_count as number | undefined,
        firstTouchAt: r.first_touch_at ? new Date(r.first_touch_at as string) : undefined,
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at as string) : undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at as string) : undefined,
      })),
    };
  },
};
