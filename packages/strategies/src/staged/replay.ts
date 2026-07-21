import type { StagedEvaluatorOptions, StagedEvent, StagedSetupState, StagedTransition } from "./types";
import { createInitialStagedState, reduceStagedSetup } from "./reducer";

export interface CompletedStagedSetup {
  state: StagedSetupState;
  completedAt: string;
}

export interface StagedReplayResult {
  activeState: StagedSetupState;
  completed: CompletedStagedSetup[];
  transitions: StagedTransition[];
  ignoredReasons: Record<string, number>;
  duplicates: number;
}

/**
 * Deterministic coordinator shared by historical and live-shadow adapters.
 * Input must use event-time order. Terminal setups are archived; next context
 * event starts a clean setup, preventing evidence from crossing setup IDs.
 */
export function replayStagedEvents(
  symbol: string,
  events: readonly StagedEvent[],
  options: StagedEvaluatorOptions,
): StagedReplayResult {
  let state = createInitialStagedState(options.strategyId, symbol);
  const completed: CompletedStagedSetup[] = [];
  const transitions: StagedTransition[] = [];
  const ignoredReasons: Record<string, number> = {};
  let duplicates = 0;

  for (const event of events) {
    if ((state.phase === "entered" || state.phase === "cancelled") && event.type === "context") {
      completed.push({ state, completedAt: state.lastEventTs ?? event.ts });
      state = createInitialStagedState(options.strategyId, symbol);
    }
    const reduced = reduceStagedSetup(state, event, options);
    state = reduced.state;
    if (reduced.transition) transitions.push(reduced.transition);
    if (reduced.duplicate) duplicates += 1;
    if (reduced.ignoredReason) {
      ignoredReasons[reduced.ignoredReason] = (ignoredReasons[reduced.ignoredReason] ?? 0) + 1;
    }
  }
  if (state.phase === "entered" || state.phase === "cancelled") {
    completed.push({ state, completedAt: state.lastEventTs ?? "" });
  }
  return { activeState: state, completed, transitions, ignoredReasons, duplicates };
}
