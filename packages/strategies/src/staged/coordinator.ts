import type { Side } from "@tm/shared";
import { createInitialStagedState, reduceStagedSetup } from "./reducer";
import type { StagedEvaluatorOptions, StagedEvent, StagedSetupState, StagedTransition } from "./types";

export interface StagedSignal {
  symbol: string;
  ts: string;
  side: Side;
  setupId: string;
  state: StagedSetupState;
}

export interface StagedCoordinatorResult {
  active: StagedSetupState[];
  completed: StagedSetupState[];
  signals: StagedSignal[];
  transitions: StagedTransition[];
  ignoredReasons: Record<string, number>;
  duplicates: number;
}

const TF_MS: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

export function timeframeMs(tf: string): number {
  const value = TF_MS[tf];
  if (!value) throw new Error(`Unsupported staged timeframe: ${tf}`);
  return value;
}

function expiryReason(state: StagedSetupState, now: string, options: StagedEvaluatorOptions): string | null {
  const elapsed = (anchor: string | undefined, bars: number, tf: string) =>
    !!anchor && Date.parse(now) - Date.parse(anchor) > bars * timeframeMs(tf);
  if (state.phase === "waiting_setup") {
    if (elapsed(state.evidence.contextTs, options.config.context.maxAgeBars, options.config.context.tf)) return "context_expired";
    if (options.config.setup.zoneMaxAgeBars && elapsed(state.evidence.zoneTs, options.config.setup.zoneMaxAgeBars, options.config.setup.tf)) return "zone_expired";
  }
  if (state.phase === "waiting_touch" && elapsed(state.evidence.setupTs, options.config.setup.maxAgeBars, options.config.setup.tf)) return "setup_expired";
  if (state.phase === "waiting_entry" && elapsed(state.evidence.touchTs, options.config.entry.maxBarsAfterTouch, options.config.entry.tf)) return "entry_window_expired";
  return null;
}

/** Multi-zone deterministic coordinator. Each exact zone owns isolated reducer state. */
export function coordinateStagedEvents(
  symbol: string,
  events: readonly StagedEvent[],
  options: StagedEvaluatorOptions,
): StagedCoordinatorResult {
  let latestContext: Extract<StagedEvent, { type: "context" }> | null = null;
  const active = new Map<string, StagedSetupState>();
  const completed: StagedSetupState[] = [];
  const signals: StagedSignal[] = [];
  const transitions: StagedTransition[] = [];
  const ignoredReasons: Record<string, number> = {};
  const emittedMarketEvents = new Set<string>();
  let duplicates = 0;

  const apply = (key: string, state: StagedSetupState, event: StagedEvent): StagedSetupState => {
    const reason = expiryReason(state, event.ts, options);
    if (reason) {
      const expiry: StagedEvent = { id: `expiry:${key}:${reason}:${event.ts}`, type: "expired", symbol, ts: event.ts, reason };
      const expired = reduceStagedSetup(state, expiry, options);
      if (expired.transition) transitions.push(expired.transition);
      completed.push(expired.state); active.delete(key);
      return expired.state;
    }
    const reduced = reduceStagedSetup(state, event, options);
    if (reduced.transition) transitions.push(reduced.transition);
    if (reduced.duplicate) duplicates++;
    if (reduced.ignoredReason) ignoredReasons[reduced.ignoredReason] = (ignoredReasons[reduced.ignoredReason] ?? 0) + 1;
    if (reduced.state.phase === "ready" && state.phase !== "ready" && reduced.state.side && reduced.state.setupId) {
      const marketEventKey = `${symbol}:${reduced.state.side}:${event.type}:${event.id}`;
      if (emittedMarketEvents.has(marketEventKey)) {
        ignoredReasons.duplicate_zone_same_entry_event = (ignoredReasons.duplicate_zone_same_entry_event ?? 0) + 1;
      } else {
        emittedMarketEvents.add(marketEventKey);
        signals.push({ symbol, ts: event.ts, side: reduced.state.side, setupId: reduced.state.setupId, state: reduced.state });
      }
    }
    if (reduced.state.phase === "cancelled" || reduced.state.phase === "entered") {
      completed.push(reduced.state); active.delete(key);
    } else active.set(key, reduced.state);
    return reduced.state;
  };

  for (const event of events) {
    if (event.symbol !== symbol) continue;
    if (event.type === "context") {
      latestContext = event;
      for (const [key, state] of [...active]) apply(key, state, event);
      continue;
    }
    if (event.type === "zone_formed") {
      if (!latestContext || latestContext.side !== event.side) {
        ignoredReasons.zone_without_matching_context = (ignoredReasons.zone_without_matching_context ?? 0) + 1;
        continue;
      }
      let state = createInitialStagedState(options.strategyId, symbol);
      state = reduceStagedSetup(state, latestContext, options).state;
      state = reduceStagedSetup(state, event, options).state;
      active.set(event.zoneId, state);
      continue;
    }
    for (const [key, state] of [...active]) {
      if (event.type === "zone_invalidated" && event.zoneId !== key) continue;
      apply(key, state, event);
    }
  }
  return { active: [...active.values()], completed, signals, transitions, ignoredReasons, duplicates };
}
