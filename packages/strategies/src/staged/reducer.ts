import type { Side } from "@tm/shared";
import type {
  ReduceResult,
  StagedEvaluatorOptions,
  StagedEvent,
  StagedPhase,
  StagedSetupState,
} from "./types";

export function createInitialStagedState(strategyId: string, symbol: string): StagedSetupState {
  return {
    strategyId,
    symbol,
    setupId: null,
    phase: "waiting_context",
    side: null,
    evidence: {},
    lastEventTs: null,
    reason: null,
    revision: 0,
    processedEventIds: [],
  };
}

export function buildSetupId(
  strategyId: string,
  symbol: string,
  side: Side,
  setupTs: string,
  zoneId: string,
): string {
  return `${strategyId}:${symbol}:${side}:${setupTs}:${zoneId}`;
}

function result(
  state: StagedSetupState,
  event: StagedEvent,
  next: StagedSetupState,
  reason: string,
): ReduceResult {
  const changed = state.phase !== next.phase;
  return {
    state: next,
    duplicate: false,
    ignoredReason: changed ? null : reason,
    transition: changed
      ? { previous: state.phase, next: next.phase, eventId: event.id, eventTs: event.ts, reason }
      : null,
  };
}

function advance(
  state: StagedSetupState,
  event: StagedEvent,
  phase: StagedPhase,
  reason: string,
  patch: Partial<StagedSetupState> = {},
): ReduceResult {
  return result(state, event, {
    ...state,
    ...patch,
    phase,
    lastEventTs: event.ts,
    reason,
    revision: state.revision + 1,
    processedEventIds: [...state.processedEventIds.slice(-255), event.id],
  }, reason);
}

function sideMatches(state: StagedSetupState, side: Side): boolean {
  return state.side === side;
}

export function reduceStagedSetup(
  state: StagedSetupState,
  event: StagedEvent,
  options: StagedEvaluatorOptions,
): ReduceResult {
  if (event.symbol !== state.symbol) {
    return { state, transition: null, duplicate: false, ignoredReason: "symbol_mismatch" };
  }
  if (state.processedEventIds.includes(event.id)) {
    return { state, transition: null, duplicate: true, ignoredReason: "duplicate_event" };
  }
  if (state.lastEventTs && event.ts < state.lastEventTs) {
    return { state, transition: null, duplicate: false, ignoredReason: "out_of_order_event" };
  }
  if (state.phase === "entered" || state.phase === "cancelled") {
    return { state, transition: null, duplicate: false, ignoredReason: "terminal_state" };
  }

  const config = options.config;
  if (event.type === "expired") {
    return advance(state, event, "cancelled", event.reason);
  }
  if (event.type === "context") {
    if (config.context.requireAgreement && event.agreement !== true) {
      return result(state, event, state, "context_disagreement");
    }
    if (state.side && state.side !== event.side && config.cancellation.onBiasFlip && state.phase !== "waiting_context") {
      return advance(state, event, "cancelled", "bias_flip");
    }
    const nextPhase = state.phase === "waiting_context" ? "waiting_setup" : state.phase;
    return advance(state, event, nextPhase, "context_valid", {
      side: event.side,
      evidence: { ...state.evidence, contextTs: event.ts },
    });
  }
  if (event.type === "zone_formed" && state.phase === "waiting_setup") {
    if (!sideMatches(state, event.side)) return result(state, event, state, "zone_direction_mismatch");
    if (event.top <= event.bottom) return result(state, event, state, "invalid_zone_geometry");
    if (config.setup.zoneKinds?.length && !config.setup.zoneKinds.includes(event.zoneKind)) {
      return result(state, event, state, "zone_kind_not_allowed");
    }
    return advance(state, event, "waiting_setup", "zone_available", {
      evidence: {
        ...state.evidence,
        zoneId: event.zoneId,
        zoneTs: event.ts,
        zoneTop: event.top,
        zoneBottom: event.bottom,
      },
    });
  }
  if (event.type === "setup_structure" && state.phase === "waiting_setup") {
    if (!sideMatches(state, event.side)) return result(state, event, state, "setup_direction_mismatch");
    if (!config.setup.eventTypes.includes(event.eventType)) return result(state, event, state, "setup_event_not_allowed");
    if (config.setup.requireZone && !state.evidence.zoneId) return result(state, event, state, "setup_zone_missing");
    const setupId = state.evidence.zoneId
      ? buildSetupId(options.strategyId, state.symbol, event.side, event.ts, state.evidence.zoneId)
      : `${options.strategyId}:${state.symbol}:${event.side}:${event.ts}`;
    return advance(state, event, config.setup.requireZone ? "waiting_touch" : "waiting_entry", "setup_structure_valid", {
      setupId,
      evidence: { ...state.evidence, setupTs: event.ts },
    });
  }
  if (event.type === "zone_invalidated" && config.cancellation.onZoneInvalidation) {
    if (event.zoneId === state.evidence.zoneId) return advance(state, event, "cancelled", "zone_invalidated");
    return result(state, event, state, "different_zone");
  }
  if (event.type === "candle_closed" && state.phase === "waiting_touch" && state.evidence.zoneId) {
    const top = state.evidence.zoneTop;
    const bottom = state.evidence.zoneBottom;
    if (top === undefined || bottom === undefined) return result(state, event, state, "zone_geometry_missing");
    if (state.evidence.zoneTs && event.ts <= state.evidence.zoneTs) return result(state, event, state, "touch_not_after_zone_formation");
    if (state.evidence.setupTs && event.ts <= state.evidence.setupTs) return result(state, event, state, "touch_not_after_setup");
    if (event.high < bottom || event.low > top) return result(state, event, state, "zone_not_touched");
    return advance(state, event, "waiting_entry", "zone_touched", {
      evidence: { ...state.evidence, touchTs: event.ts },
    });
  }
  if (event.type === "entry_structure" && state.phase === "waiting_entry") {
    if (!sideMatches(state, event.side)) return result(state, event, state, "entry_direction_mismatch");
    if (!config.entry.eventTypes.includes(event.eventType)) return result(state, event, state, "entry_event_not_allowed");
    if (!state.evidence.touchTs || event.ts <= state.evidence.touchTs) {
      return result(state, event, state, "entry_not_after_touch");
    }
    return advance(state, event, "ready", "entry_trigger_valid", {
      evidence: { ...state.evidence, entryTriggerTs: event.ts },
    });
  }
  if (event.type === "execution_accepted" && state.phase === "ready") {
    return advance(state, event, "entered", "execution_accepted");
  }
  return result(state, event, state, "event_not_applicable");
}
