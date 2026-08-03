import type { Candle, PivotOutput, TimeFrame } from "@tm/shared";

export type CausalSweepDirection = "bullish" | "bearish";
export type CausalSweepKind = "high" | "low";
export type CausalSweepScale = "external" | "internal";

export interface CausalLevel {
  levelId: string;
  price: number;
  kind: CausalSweepKind;
  scale: CausalSweepScale;
  confirmationTs: Date;
  formedTs: Date;
  targetType?: "swing" | "equal_high" | "equal_low" | "pdh" | "pdl";
}

export interface CausalSweepEvent {
  eventType: "sweep";
  direction: CausalSweepDirection;
  level: number;
  levelId: string;
  sourceScale: CausalSweepScale;
  sourceConfirmationTs: Date;
  sourceFormedTs: Date;
  sourceKind: CausalSweepKind;
  sweepTs: Date;
  closeBackTs: Date;
  availableAtTs: Date;
}

export interface CausalSweepState {
  activeLevels: Map<string, {
    level: CausalLevel;
    swept: boolean;
    breakCandle: Candle | null;
  }>;
  completedSweeps: Set<string>;
  events: CausalSweepEvent[];
}

const CLOSE_BACK_BARS = 2;
const MIN_PEN_ATR = 0.1;
const ATR_PERIOD = 14;

export function createCausalSweepState(): CausalSweepState {
  return { activeLevels: new Map(), completedSweeps: new Set(), events: [] };
}

function tfMs(tf: TimeFrame): number {
  const values: Record<TimeFrame, number> = {
    "1m": 60_000, "5m": 300_000, "15m": 900_000,
    "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
  };
  return values[tf];
}

function levelId(kind: CausalSweepKind, formedTs: Date, price: number, suffix: string): string {
  return `${suffix}:${kind}:${formedTs.toISOString()}:${price}`;
}

function causalAtr(candles: Candle[], index: number): number {
  const start = Math.max(0, index - ATR_PERIOD);
  const sample = candles.slice(start, index);
  if (sample.length === 0) return 0;
  return sample.reduce((sum, candle) => sum + (candle.h - candle.l), 0) / sample.length;
}

export function buildCausalLevels(
  pivots: PivotOutput["pivots"],
  options: { tf: TimeFrame; candles?: Candle[]; atr?: number }
): CausalLevel[] {
  const swings: CausalLevel[] = pivots.map((pivot, index) => ({
    levelId: levelId(pivot.kind, pivot.ts, pivot.price, `swing-${index}`),
    price: pivot.price,
    kind: pivot.kind,
    scale: "external",
    confirmationTs: pivot.confirmationTs,
    formedTs: pivot.ts,
    targetType: "swing",
  }));

  const tol = (options.atr ?? 0) * 0.1;
  const equalLevels = buildCausalEqualLevels(pivots, tol);
  const dailyLevels = options.candles ? buildCausalPdhPdl(options.candles) : [];
  return [...swings, ...dailyLevels, ...equalLevels];
}

export function buildCausalEqualLevels(
  pivots: PivotOutput["pivots"],
  tolerance: number,
): CausalLevel[] {
  if (tolerance < 0) throw new Error("Equal-level tolerance must be non-negative");
  const levels: CausalLevel[] = [];
  for (const kind of ["high", "low"] as const) {
    const points = pivots.filter((pivot) => pivot.kind === kind).sort((a, b) => a.price - b.price);
    let i = 0;
    while (i < points.length) {
      const cluster = [points[i]];
      let j = i + 1;
      while (j < points.length && points[j].price - cluster[0].price <= tolerance) {
        cluster.push(points[j]);
        j++;
      }
      if (cluster.length >= 2) {
        const price = cluster.reduce((sum, pivot) => sum + pivot.price, 0) / cluster.length;
        const formedTs = cluster.reduce((latest, pivot) =>
          pivot.ts > latest ? pivot.ts : latest, cluster[0].ts);
        const confirmationTs = cluster.reduce((latest, pivot) =>
          pivot.confirmationTs > latest ? pivot.confirmationTs : latest,
          cluster[0].confirmationTs);
        levels.push({
          levelId: levelId(kind, formedTs, price, `equal-${kind}`),
          price,
          kind,
          scale: "internal" as const,
          confirmationTs,
          formedTs,
          targetType: kind === "high" ? "equal_high" as const : "equal_low" as const,
        });
      }
      i = j;
    }
  }
  return levels;
}

export function buildCausalPdhPdl(candles: Candle[]): CausalLevel[] {
  const byDay = new Map<string, { high: number; low: number }>();
  for (const candle of candles) {
    const day = candle.ts.toISOString().slice(0, 10);
    const current = byDay.get(day);
    if (current) {
      current.high = Math.max(current.high, candle.h);
      current.low = Math.min(current.low, candle.l);
    } else {
      byDay.set(day, { high: candle.h, low: candle.l });
    }
  }
  const days = [...byDay.keys()].sort();
  const levels: CausalLevel[] = [];
  for (let i = 1; i < days.length; i++) {
    const previous = byDay.get(days[i - 1])!;
    const confirmationTs = new Date(`${days[i]}T00:00:00.000Z`);
    levels.push(
      { levelId: `pdh:${days[i]}`, price: previous.high, kind: "high", scale: "external", confirmationTs, formedTs: confirmationTs, targetType: "pdh" },
      { levelId: `pdl:${days[i]}`, price: previous.low, kind: "low", scale: "external", confirmationTs, formedTs: confirmationTs, targetType: "pdl" },
    );
  }
  return levels;
}

export function detectCausalSweeps(
  candles: Candle[],
  levels: CausalLevel[],
  options: { tf: TimeFrame; state?: CausalSweepState }
): CausalSweepEvent[] {
  const state = options.state ?? createCausalSweepState();
  const orderedCandles = [...candles].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const orderedLevels = [...levels].sort((a, b) =>
    a.confirmationTs.getTime() - b.confirmationTs.getTime() || a.levelId.localeCompare(b.levelId));
  const tfDuration = tfMs(options.tf);

  for (const candle of orderedCandles) {
    for (const level of orderedLevels) {
      if (state.completedSweeps.has(level.levelId)) continue;
      if (level.confirmationTs.getTime() > candle.ts.getTime()) continue;
      const tracked = state.activeLevels.get(level.levelId) ?? { level, swept: false, breakCandle: null };
      const penetration = level.kind === "high" ? candle.h - level.price : level.price - candle.l;
      const extendsLevel = penetration >= causalAtr(orderedCandles, orderedCandles.indexOf(candle)) * MIN_PEN_ATR;
      if (!tracked.swept && extendsLevel) {
        tracked.swept = true;
        tracked.breakCandle = candle;
        state.activeLevels.set(level.levelId, tracked);
        continue;
      }
      if (!tracked.swept || !tracked.breakCandle || candle.ts.getTime() <= tracked.breakCandle.ts.getTime()) continue;
      const breakIndex = orderedCandles.findIndex((c) => c.ts.getTime() === tracked.breakCandle!.ts.getTime());
      const candleIndex = orderedCandles.findIndex((c) => c.ts.getTime() === candle.ts.getTime());
      if (breakIndex < 0 || candleIndex - breakIndex >= CLOSE_BACK_BARS) continue;
      const closesBack = level.kind === "high" ? candle.c < level.price : candle.c > level.price;
      if (!closesBack) continue;
      const event: CausalSweepEvent = {
        eventType: "sweep",
        direction: level.kind === "low" ? "bullish" : "bearish",
        level: level.price,
        levelId: level.levelId,
        sourceScale: level.scale,
        sourceConfirmationTs: level.confirmationTs,
        sourceFormedTs: level.formedTs,
        sourceKind: level.kind,
        sweepTs: tracked.breakCandle.ts,
        closeBackTs: candle.ts,
        availableAtTs: new Date(Math.max(level.confirmationTs.getTime(), candle.ts.getTime() + tfDuration)),
      };
      state.events.push(event);
      state.completedSweeps.add(level.levelId);
      state.activeLevels.delete(level.levelId);
    }
  }
  return [...state.events].sort((a, b) => a.availableAtTs.getTime() - b.availableAtTs.getTime());
}
