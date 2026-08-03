/**
 * In-memory causal detector prototype.
 *
 * Not registered in DAG. Not production authority. Used to test availability,
 * active-level consumption, duplicate suppression, and deterministic replay.
 */

export type CausalDirection = "bullish" | "bearish";
export type CausalPivotKind = "high" | "low";
export type CausalEventType = "bos" | "choch" | "mss" | "internal_bos" | "internal_choch";
export type CausalPivotScale = "external" | "internal";

export interface CausalCandle {
  ts: Date;
  h: number;
  l: number;
  c: number;
}

export interface CausalPivot {
  levelId: string;
  kind: CausalPivotKind;
  price: number;
  centerTs: Date;
  availableAt: Date;
  confirmationTs?: Date;
  scale?: CausalPivotScale;
}

export interface CausalEvent {
  identity: string;
  eventType: CausalEventType;
  direction: CausalDirection;
  levelId: string;
  level: number;
  eventTs: Date;
  availableAt: Date;
  sourceScale: CausalPivotScale;
  sourceConfirmationTs?: Date;
  sourceCenterTs: Date;
  sourceKind: CausalPivotKind;
  sweptLevelId?: string;
  sweptLevel?: number;
  sweptKind?: CausalPivotKind;
  trendDirection?: CausalDirection;
  establishedTrend?: CausalDirection;
}

export interface CausalState {
  activeLevels: Map<string, CausalPivot>;
  brokenLevels: Set<string>;
  emittedEvents: Set<string>;
  trend?: CausalDirection;
  establishedTrend?: CausalDirection;
}

interface CandleSweep {
  levelId: string;
  price: number;
  kind: CausalPivotKind;
  direction: CausalDirection;
}

export const MAX_ACTIVE_LEVELS_PER_KIND = 10;

export interface CausalDetectorInput {
  symbol: string;
  tf: string;
  tfMs: number;
  anchorTs: Date;
  candles: CausalCandle[];
  pivots: CausalPivot[];
  state?: CausalState;
  trace?: (snapshot: {
    candleTs: Date;
    activeLevels: CausalPivot[];
    brokenLevels: string[];
    trend?: CausalDirection;
    establishedTrend?: CausalDirection;
    events: CausalEvent[];
  }) => void;
}

export interface CausalDetectorOutput {
  events: CausalEvent[];
  state: CausalState;
}

export function createCausalState(): CausalState {
  return {
    activeLevels: new Map(),
    brokenLevels: new Set(),
    emittedEvents: new Set(),
    trend: undefined,
    establishedTrend: undefined,
  };
}

function selectSweptLevelForMSS(
  breakDirection: CausalDirection,
  sweeps: CandleSweep[],
  activeLevels: Map<string, CausalPivot>
): CandleSweep | undefined {
  const opposingKind: CausalPivotKind = breakDirection === "bearish" ? "high" : "low";
  const order = new Map([...activeLevels.keys()].map((id, index) => [id, index]));
  return sweeps
    .filter((sweep) => sweep.direction === breakDirection && sweep.kind === opposingKind)
    .sort((a, b) => (order.get(a.levelId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.levelId) ?? Number.MAX_SAFE_INTEGER))[0];
}

function usable(candle: CausalCandle, anchorTs: Date, tfMs: number): boolean {
  return candle.ts.getTime() + tfMs <= anchorTs.getTime();
}

function eventIdentity(
  symbol: string,
  tf: string,
  levelId: string,
  eventType: CausalEventType,
  direction: CausalDirection
): string {
  return `${symbol}|${tf}|${levelId}|${eventType}|${direction}`;
}

export function classifyPivotScale(
  pivot: CausalPivot,
  priorConfirmedPivots: CausalPivot[]
): CausalPivotScale {
  const prior = priorConfirmedPivots.filter((p) => p.kind === pivot.kind);
  if (prior.length === 0) return "external";
  let extreme = prior[0].price;
  for (let i = 1; i < prior.length; i++) {
    const price = prior[i].price;
    if (pivot.kind === "high") extreme = Math.max(extreme, price);
    else extreme = Math.min(extreme, price);
  }
  return pivot.kind === "high"
    ? (pivot.price > extreme ? "external" : "internal")
    : (pivot.price < extreme ? "external" : "internal");
}

/**
 * Processes only completed candles. Pivot activation is availability-gated.
 * First close beyond each level consumes it permanently. A break opposite
 * current trend is CHoCH unless prior opposing liquidity was swept; only then
 * it becomes MSS. Pivot confirmation alone never emits an event.
 */
export function detectCausal(input: CausalDetectorInput): CausalDetectorOutput {
  const state = input.state ?? createCausalState();
  if (!state.establishedTrend && state.trend) state.establishedTrend = state.trend;
  const candles = [...input.candles]
    .filter((c) => usable(c, input.anchorTs, input.tfMs))
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const pivots = [...input.pivots]
    .filter((p) => p.availableAt.getTime() <= input.anchorTs.getTime())
    .sort((a, b) =>
      a.availableAt.getTime() - b.availableAt.getTime() ||
      a.centerTs.getTime() - b.centerTs.getTime() ||
      a.levelId.localeCompare(b.levelId)
    );

  const events: CausalEvent[] = [];
  const confirmed: CausalPivot[] = [];
  for (const candle of candles) {
    const candleEventsStart = events.length;
    const candleSweeps: CandleSweep[] = [];
    for (const pivot of pivots) {
      if (pivot.availableAt.getTime() > candle.ts.getTime() + input.tfMs) continue;
      if (state.brokenLevels.has(pivot.levelId)) continue;
      if (!state.activeLevels.has(pivot.levelId)) {
        const activated = { ...pivot, scale: pivot.scale ?? classifyPivotScale(pivot, confirmed) };
        // Newer, stronger swing supersedes older active external level. This
        // mirrors legacy lastHigh/lastLow semantics without collapsing levels
        // sharing one pivot timestamp.
        if (activated.scale === "external") {
          for (const prior of [...state.activeLevels.values()]) {
            const stronger = activated.kind === "high"
              ? activated.price > prior.price
              : activated.price < prior.price;
            if (prior.kind === activated.kind && prior.scale === "external" &&
              activated.centerTs.getTime() > prior.centerTs.getTime() && stronger) {
              state.activeLevels.delete(prior.levelId);
              state.brokenLevels.add(prior.levelId);
            }
          }
        }
        state.activeLevels.set(pivot.levelId, activated);
        confirmed.push(activated);
      }
      const sameKind = [...state.activeLevels.values()]
        .filter((level) => level.kind === pivot.kind)
        .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime() || a.levelId.localeCompare(b.levelId));
      const internalSameKind = sameKind.filter((level) => level.scale === "internal");
      while (internalSameKind.length > MAX_ACTIVE_LEVELS_PER_KIND) {
        const retired = internalSameKind.shift();
        if (retired) state.activeLevels.delete(retired.levelId);
      }
    }
    // Record opposing liquidity sweep from wick data. Sweep alone emits no event.
    for (const level of state.activeLevels.values()) {
      if (level.kind === "high" && candle.h > level.price && candle.c <= level.price) {
        candleSweeps.push({ levelId: level.levelId, price: level.price, kind: level.kind, direction: "bearish" });
      } else if (level.kind === "low" && candle.l < level.price && candle.c >= level.price) {
        candleSweeps.push({ levelId: level.levelId, price: level.price, kind: level.kind, direction: "bullish" });
      }
    }
    for (const level of [...state.activeLevels.values()].sort((a, b) => a.levelId.localeCompare(b.levelId))) {
      const direction: CausalDirection | undefined =
        candle.c > level.price && level.kind === "high"
          ? "bullish"
          : candle.c < level.price && level.kind === "low"
            ? "bearish"
            : undefined;
      if (!direction) continue;
          // Internal liquidity breaks are consumed silently. They remain active
          // in state for range tracking, but never reach default structure users.
          if (level.scale === "internal") {
            state.activeLevels.delete(level.levelId);
            state.brokenLevels.add(level.levelId);
            continue;
          }

      const reversal = !!state.establishedTrend && state.establishedTrend !== direction;
      const swept = reversal ? selectSweptLevelForMSS(direction, candleSweeps, state.activeLevels) : undefined;
      // Opposite break without opposing liquidity sweep is not confirmed
      // structure shift. Consume level, but emit no CHoCH event.
      if (reversal && !swept) {
        state.activeLevels.delete(level.levelId);
        state.brokenLevels.add(level.levelId);
        continue;
      }
      const eventType: CausalEventType = swept ? "mss" : reversal ? "choch" : "bos";
      const identity = eventIdentity(input.symbol, input.tf, level.levelId, eventType, direction);
      state.activeLevels.delete(level.levelId);
      state.brokenLevels.add(level.levelId);
      if (state.emittedEvents.has(identity)) continue;
      state.emittedEvents.add(identity);
      state.trend = direction;
      if (eventType === "bos") state.establishedTrend = direction;
      if (eventType === "mss") {
        state.establishedTrend = direction;
      }

      events.push({
        identity,
        eventType,
        direction,
        levelId: level.levelId,
        level: level.price,
        eventTs: candle.ts,
        availableAt: new Date(Math.max(candle.ts.getTime() + input.tfMs, level.availableAt.getTime())),
        sourceScale: level.scale ?? "external",
        sourceConfirmationTs: level.confirmationTs,
        sourceCenterTs: level.centerTs,
        sourceKind: level.kind,
        ...(eventType === "mss" && swept ? {
          sweptLevelId: swept.levelId,
          sweptLevel: swept.price,
          sweptKind: swept.kind,
        } : {}),
        trendDirection: direction,
        establishedTrend: state.establishedTrend,
      });
    }
    input.trace?.({
      candleTs: candle.ts,
      activeLevels: [...state.activeLevels.values()].map((level) => ({ ...level })),
      brokenLevels: [...state.brokenLevels],
      trend: state.trend,
      establishedTrend: state.establishedTrend,
      events: events.slice(candleEventsStart),
    });
  }

  events.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime() || a.identity.localeCompare(b.identity));
  return { events, state };
}
