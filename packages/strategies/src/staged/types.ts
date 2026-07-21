import type { Side, StagedStrategyConfig } from "@tm/shared";

export type StagedPhase =
  | "waiting_context"
  | "waiting_setup"
  | "waiting_touch"
  | "waiting_entry"
  | "ready"
  | "entered"
  | "cancelled";

export interface StagedEvidence {
  contextTs?: string;
  setupTs?: string;
  zoneId?: string;
  zoneTs?: string;
  zoneTop?: number;
  zoneBottom?: number;
  touchTs?: string;
  entryTriggerTs?: string;
}

export interface StagedSetupState {
  strategyId: string;
  symbol: string;
  setupId: string | null;
  phase: StagedPhase;
  side: Side | null;
  evidence: StagedEvidence;
  lastEventTs: string | null;
  reason: string | null;
  revision: number;
  /** Bounded retry window; reducer retains latest 256 IDs. */
  processedEventIds: string[];
}

interface BaseEvent {
  id: string;
  symbol: string;
  ts: string;
}

export type StagedEvent =
  | (BaseEvent & { type: "context"; side: Side; agreement?: boolean })
  | (BaseEvent & { type: "setup_structure"; side: Side; eventType: "bos" | "mss" | "choch" })
  | (BaseEvent & { type: "zone_formed"; side: Side; zoneId: string; zoneKind: string; top: number; bottom: number })
  | (BaseEvent & { type: "candle_closed"; high: number; low: number; close: number })
  | (BaseEvent & { type: "zone_invalidated"; zoneId: string })
  | (BaseEvent & { type: "entry_structure"; side: Side; eventType: "bos" | "mss" | "choch" })
  | (BaseEvent & { type: "execution_accepted" })
  | (BaseEvent & { type: "expired"; reason: string });

export interface StagedTransition {
  previous: StagedPhase;
  next: StagedPhase;
  eventId: string;
  eventTs: string;
  reason: string;
}

export interface ReduceResult {
  state: StagedSetupState;
  transition: StagedTransition | null;
  duplicate: boolean;
  ignoredReason: string | null;
}

export interface StagedEvaluatorOptions {
  strategyId: string;
  config: StagedStrategyConfig;
}
