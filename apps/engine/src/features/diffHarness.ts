import type { CausalCandle, CausalEvent } from "./causalPrototype";

export type DivergenceClassification = "CAUSAL_CORRECTION" | "POTENTIAL_BUG" | "UNRESOLVED";

export interface ComparableEvent {
  identity: string;
  eventType: string;
  direction: string;
  levelId?: string;
  eventTs: Date;
  availableAt?: Date;
}

export interface DiffReport {
  oldCount: number;
  newCount: number;
  removed: Array<{ oldEvent: ComparableEvent; classification: DivergenceClassification; reason: string }>;
  added: Array<{ newEvent: ComparableEvent; classification: DivergenceClassification; reason: string }>;
  timestampShifted: Array<{ oldEvent: ComparableEvent; newEvent: ComparableEvent; classification: DivergenceClassification }>;
  identityChanged: Array<{ oldEvent: ComparableEvent; newEvent: ComparableEvent; classification: DivergenceClassification }>;
}

function completedAt(event: ComparableEvent, candles: CausalCandle[], tfMs: number): boolean {
  const candle = candles.find((item) => item.ts.getTime() === event.eventTs.getTime());
  return Boolean(candle && event.availableAt && event.availableAt.getTime() >= candle.ts.getTime() + tfMs);
}

function hasCausalJustification(event: ComparableEvent, candles: CausalCandle[], tfMs: number): boolean {
  return Boolean(event.availableAt && event.availableAt.getTime() >= event.eventTs.getTime() + tfMs && completedAt(event, candles, tfMs));
}

function key(event: ComparableEvent): string {
  return `${event.eventType}|${event.direction}|${event.levelId ?? ""}`;
}

export function compareOldVsNew(
  oldEvents: ComparableEvent[],
  newEvents: CausalEvent[],
  candles: CausalCandle[],
  tfMs: number
): DiffReport {
  const oldByKey = new Map(oldEvents.map((event) => [key(event), event]));
  const newByKey = new Map(newEvents.map((event) => [key(event), event]));
  const removed = [] as DiffReport["removed"];
  const added = [] as DiffReport["added"];
  const timestampShifted = [] as DiffReport["timestampShifted"];
  const identityChanged = [] as DiffReport["identityChanged"];

  for (const oldEvent of oldEvents) {
    const next = newByKey.get(key(oldEvent));
    if (!next) {
      removed.push({ oldEvent, classification: "UNRESOLVED", reason: "No matching causal event; inspect pivot confirmation and edge-candle provenance." });
      continue;
    }
    if (next.eventTs.getTime() !== oldEvent.eventTs.getTime()) {
      timestampShifted.push({ oldEvent, newEvent: next, classification: hasCausalJustification(next, candles, tfMs) ? "CAUSAL_CORRECTION" : "POTENTIAL_BUG" });
    }
  }

  for (const oldEvent of oldEvents) {
    if (newByKey.has(key(oldEvent))) continue;
    const replacement = newEvents.find((event) =>
      event.eventType === oldEvent.eventType && event.direction === oldEvent.direction && event.eventTs.getTime() === oldEvent.eventTs.getTime()
    );
    if (replacement && replacement.levelId !== oldEvent.levelId) {
      identityChanged.push({ oldEvent, newEvent: replacement, classification: hasCausalJustification(replacement, candles, tfMs) ? "CAUSAL_CORRECTION" : "POTENTIAL_BUG" });
    }
  }

  for (const newEvent of newEvents) {
    if (!oldByKey.has(key(newEvent))) {
      const justified = hasCausalJustification(newEvent, candles, tfMs);
      added.push({ newEvent, classification: justified ? "CAUSAL_CORRECTION" : "POTENTIAL_BUG", reason: justified ? "Completed candle and availability-gated event." : "No completed source candle or availability proof." });
    }
  }

  return { oldCount: oldEvents.length, newCount: newEvents.length, removed, added, timestampShifted, identityChanged };
}
