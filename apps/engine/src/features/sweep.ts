/**
 * Sweep (liquidity sweep) feature v1.4.0.
 *
 * Level-based, PIT-correct rebuild. A sweep is price wicking through a real
 * liquidity level and closing back inside, detected against:
 *   - swing pivots (features_pivot high/low),
 *   - prior-day high / prior-day low (derived from the candle window by UTC date),
 *   - equal-high / equal-low clusters (pivots clustered within an ATR tolerance).
 *
 * Penetration is ATR-normalized (>= MIN_PEN_ATR * ATR) and the close-back must
 * occur within CLOSE_BACK_BARS. Structure confluence (features_structure) is a
 * SCORE, never a gate, and only events <= sweep ts are used (no look-ahead —
 * the v1.3 forward "inducement" gate is removed). The row is emitted on the
 * close-back candle so every input is <= sweep ts.
 *
 * Row shape is unchanged (direction/level/extreme/close/ts/sweep_type/evidence/
 * mitigated_at) plus target_type; evidence gains penetrationAtr, closeBackBars,
 * displacementAtr, structureScore, targetType.
 */

import type {
  Candle,
  FeatureDefinition,
  SweepOutput,
  SweepTargetType,
  Direction,
  AtrOutput,
  StructureOutput,
  StructureEvent,
} from "@tm/shared";
import { sha256, computeSweepLifecycle } from "@tm/shared";
import type { PivotOutput } from "@tm/shared";

export interface SweepInput {
  candles: Candle[];
  features_pivot: PivotOutput;
  features_atr: AtrOutput;
  features_structure?: StructureOutput;
}

const MIN_PEN_ATR = 0.1;
const CLOSE_BACK_BARS = 2;
const EQ_TOL_ATR = 0.1;
const STRUCTURE_LOOKBACK_BARS = 10;
const VALID_STRUCTURE_EVENTS = new Set(["bos", "mss", "choch"]);

type LevelSide = "high" | "low";
interface LiquidityLevel {
  price: number;
  side: LevelSide;
  targetType: SweepTargetType;
  formedTs: Date;
}

function getAtr14(input: SweepInput): number {
  const atr = input.features_atr?.values?.find((v) => v.period === 14)?.value;
  if (atr != null && Number.isFinite(atr) && atr > 0) return atr;
  const first = input.features_atr?.values?.[0]?.value;
  if (first != null && Number.isFinite(first) && first > 0) return first;
  const tail = input.candles.slice(-14);
  if (tail.length === 0) return 0;
  const sum = tail.reduce((s, c) => s + (c.h - c.l), 0);
  return sum / tail.length;
}

function utcDay(ts: Date): string {
  return ts.toISOString().slice(0, 10);
}

function startOfUtcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Prior-day high/low levels active from each day's open. */
function buildPdhPdl(candles: Candle[]): LiquidityLevel[] {
  if (candles.length === 0) return [];
  const byDay = new Map<string, { h: number; l: number }>();
  for (const c of candles) {
    const d = utcDay(c.ts);
    const agg = byDay.get(d);
    if (!agg) byDay.set(d, { h: c.h, l: c.l });
    else { if (c.h > agg.h) agg.h = c.h; if (c.l < agg.l) agg.l = c.l; }
  }
  const days = [...byDay.keys()].sort();
  const levels: LiquidityLevel[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = byDay.get(days[i - 1])!;
    const formedTs = startOfUtcDay(days[i]);
    levels.push({ price: prev.h, side: "high", targetType: "pdh", formedTs });
    levels.push({ price: prev.l, side: "low", targetType: "pdl", formedTs });
  }
  return levels;
}

/** Cluster same-side pivots within tol (price units) into equal-high/low levels. */
function buildEqualLevels(
  pivots: PivotOutput["pivots"],
  side: LevelSide,
  tol: number
): LiquidityLevel[] {
  const pts = pivots
    .filter((p) => p.kind === side)
    .map((p) => ({ price: p.price, ts: p.ts }))
    .sort((a, b) => a.price - b.price);
  const levels: LiquidityLevel[] = [];
  let i = 0;
  while (i < pts.length) {
    const cluster = [pts[i]];
    let j = i + 1;
    while (j < pts.length && pts[j].price - cluster[0].price <= tol) {
      cluster.push(pts[j]);
      j++;
    }
    if (cluster.length >= 2) {
      const price = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
      const formedTs = cluster.reduce((m, p) => (p.ts > m ? p.ts : m), cluster[0].ts);
      levels.push({
        price,
        side,
        targetType: side === "high" ? "equal_high" : "equal_low",
        formedTs,
      });
    }
    i = j;
  }
  return levels;
}

function buildLevels(input: SweepInput, atr: number): LiquidityLevel[] {
  const pivots = input.features_pivot?.pivots ?? [];
  const tol = atr * EQ_TOL_ATR;
  const swings: LiquidityLevel[] = pivots.map((p) => ({
    price: p.price,
    side: p.kind,
    targetType: "swing" as SweepTargetType,
    formedTs: p.ts,
  }));
  return [
    ...swings,
    ...buildPdhPdl(input.candles),
    ...buildEqualLevels(pivots, "high", tol),
    ...buildEqualLevels(pivots, "low", tol),
  ];
}

function structureScore(
  events: StructureEvent[],
  candles: Candle[],
  sweepIdx: number,
  sweepDirection: "bullish" | "bearish"
): number {
  const startIdx = Math.max(0, sweepIdx - STRUCTURE_LOOKBACK_BARS);
  const startTs = candles[startIdx]?.ts;
  const sweepTs = candles[sweepIdx]?.ts;
  if (!startTs || !sweepTs) return 0;
  let score = 0;
  for (const e of events) {
    if (
      VALID_STRUCTURE_EVENTS.has(e.eventType) &&
      e.ts >= startTs &&
      e.ts <= sweepTs
    ) {
      score += 1;
      if (e.direction === sweepDirection) score += 1;
    }
  }
  return score;
}

function detectSweeps(input: SweepInput): SweepOutput["sweeps"] {
  const { candles } = input;
  const events = input.features_structure?.events ?? [];
  const atr = getAtr14(input);
  const minPen = atr * MIN_PEN_ATR;
  const levels = buildLevels(input, atr);
  const sweeps: SweepOutput["sweeps"] = [];

  for (const lvl of levels) {
    const startIdx = candles.findIndex((c) => c.ts >= lvl.formedTs);
    if (startIdx < 0) continue;

    for (let j = startIdx; j < candles.length; j++) {
      const cj = candles[j];
      const pierced =
        lvl.side === "low" ? cj.l < lvl.price : cj.h > lvl.price;
      if (!pierced) continue;
      const pen = lvl.side === "low" ? lvl.price - cj.l : cj.h - lvl.price;
      if (pen < minPen) continue;

      // Require a close back inside within CLOSE_BACK_BARS (inclusive of j).
      let closeIdx = -1;
      const end = Math.min(candles.length - 1, j + CLOSE_BACK_BARS - 1);
      for (let k = j; k <= end; k++) {
        const closesBack =
          lvl.side === "low" ? candles[k].c > lvl.price : candles[k].c < lvl.price;
        if (closesBack) { closeIdx = k; break; }
      }
      if (closeIdx < 0) continue;

      let extreme = cj[lvl.side === "low" ? "l" : "h"];
      for (let k = j + 1; k <= closeIdx; k++) {
        const v = candles[k][lvl.side === "low" ? "l" : "h"];
        if (lvl.side === "low" ? v < extreme : v > extreme) extreme = v;
      }
      let hi = -Infinity, lo = Infinity;
      for (let k = j; k <= closeIdx; k++) {
        if (candles[k].h > hi) hi = candles[k].h;
        if (candles[k].l < lo) lo = candles[k].l;
      }

      const direction: "bullish" | "bearish" = lvl.side === "low" ? "bullish" : "bearish";
      const sScore = structureScore(events, candles, closeIdx, direction);
      const close = candles[closeIdx].c;
      const ts = candles[closeIdx].ts;

      sweeps.push({
        direction,
        level: lvl.price,
        extreme,
        close,
        ts,
        sweepType: sScore > 0 ? "post_structure" : "inducement",
        targetType: lvl.targetType,
        evidence: {
          targetType: lvl.targetType,
          penetrationAtr: atr > 0 ? pen / atr : 0,
          closeBackBars: closeIdx - j + 1,
          displacementAtr: atr > 0 ? (hi - lo) / atr : 0,
          structureScore: sScore,
          wickSizeAtrPct: atr > 0 ? pen / atr : 0,
        },
      });
      break; // one sweep per level (first close-back wins)
    }
  }

  return sweeps;
}

export const sweepFeature: FeatureDefinition<SweepInput, SweepOutput> = {
  name: "features_sweep",
  version: "1.4.0",
  dependencies: ["features_pivot", "features_atr", "features_structure"],
  computePolicy: "onEvent",

  compute(input): SweepOutput {
    const sweeps = detectSweeps(input);
    for (const sweep of sweeps) {
      const idx = input.candles.findIndex((c) => c.ts.getTime() === sweep.ts.getTime());
      if (idx >= 0) {
        const lifecycle = computeSweepLifecycle(
          { direction: sweep.direction, level: sweep.level },
          input.candles,
          idx
        );
        sweep.mitigatedAt = lifecycle.mitigatedAt;
      }
    }
    return { sweeps };
  },

  hashInput(input): string {
    const events = input.features_structure?.events ?? [];
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|") +
        "|" +
        input.features_pivot.pivots
          .map((p) => `${p.ts.toISOString()}:${p.kind}:${p.price}`)
          .join("|") +
        "|" +
        input.features_atr.values.map((v) => `${v.period}:${v.value}`).join("|") +
        "|" +
        events
          .map((e) => `${e.ts.toISOString()}:${e.eventType}:${e.direction}:${e.level}`)
          .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.sweeps
        .map(
          (s) =>
            `${s.ts.toISOString()}:${s.direction}:${s.sweepType ?? "post_structure"}:${s.targetType ?? ""}:${s.level}:${s.extreme}:${s.close}:${s.mitigatedAt?.toISOString() ?? ""}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.sweeps.map((s) => ({
      direction: s.direction,
      level: s.level,
      extreme: s.extreme,
      close: s.close,
      ts: s.ts,
      sweep_type: s.sweepType ?? "post_structure",
      target_type: s.targetType ?? null,
      evidence: s.evidence ? JSON.stringify(s.evidence) : null,
      mitigated_at: s.mitigatedAt ?? null,
    }));
  },

  deserialize(rows): SweepOutput {
    return {
      sweeps: rows.map((r) => ({
        direction: r.direction as Direction,
        level: r.level as number,
        extreme: r.extreme as number,
        close: r.close as number,
        ts: new Date(r.ts as string),
        sweepType: (r.sweep_type as "post_structure" | "inducement") ?? "post_structure",
        targetType: (r.target_type as SweepTargetType) ?? undefined,
        evidence: r.evidence ? JSON.parse(r.evidence as string) : undefined,
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at as string) : undefined,
      })),
    };
  },
};
