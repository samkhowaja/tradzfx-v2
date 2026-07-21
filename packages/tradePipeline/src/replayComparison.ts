import crypto from "crypto";

export type ReplayMismatchClass =
  | "MATCH"
  | "LIVE_ONLY"
  | "REPLAY_ONLY"
  | "SIGNAL_GEOMETRY"
  | "MISSING_PROVENANCE";

export interface ComparableSignal {
  symbol: string;
  strategyId: string;
  ts: Date | string;
  side: "buy" | "sell";
  entryType?: "market" | "limit" | "stop";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
}

export interface SignalReplayComparison {
  mismatchClass: ReplayMismatchClass;
  signalMatch: boolean;
  geometryMatch: boolean;
  replayFingerprint?: string;
  liveFingerprint?: string;
  differences: string[];
}

export type DecisionMismatchClass =
  | "MATCH"
  | "LIVE_ONLY_EXECUTION"
  | "REPLAY_ONLY_EXECUTION"
  | "DECISION_STAGE"
  | "DECISION_REASON";

export interface ComparableDecision {
  executed: boolean;
  reason?: string | null;
}

export interface DecisionReplayComparison {
  mismatchClass: DecisionMismatchClass;
  decisionMatch: boolean;
  differences: string[];
}

export function compareReplayDecision(
  replay: ComparableDecision,
  live: ComparableDecision,
): DecisionReplayComparison {
  const differences: string[] = [];
  if (replay.executed !== live.executed) differences.push("executed");
  if ((replay.reason ?? null) !== (live.reason ?? null)) differences.push("reason");

  let mismatchClass: DecisionMismatchClass = "MATCH";
  if (replay.executed && !live.executed) mismatchClass = "REPLAY_ONLY_EXECUTION";
  else if (!replay.executed && live.executed) mismatchClass = "LIVE_ONLY_EXECUTION";
  else if (differences.includes("executed")) mismatchClass = "DECISION_STAGE";
  else if (differences.includes("reason")) mismatchClass = "DECISION_REASON";

  return { mismatchClass, decisionMatch: differences.length === 0, differences };
}

function normalizedNumber(value: number): string {
  return Number(value).toFixed(10);
}

export function replaySignalFingerprint(signal: ComparableSignal): string {
  const payload = [
    signal.symbol,
    signal.strategyId,
    new Date(signal.ts).toISOString(),
    signal.side,
    signal.entryType ?? "market",
    normalizedNumber(signal.entryPrice),
    normalizedNumber(signal.stopLoss),
    normalizedNumber(signal.takeProfit),
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function compareReplaySignal(
  replay: ComparableSignal | null,
  live: ComparableSignal | null,
): SignalReplayComparison {
  if (!replay && !live) {
    return { mismatchClass: "MATCH", signalMatch: true, geometryMatch: true, differences: [] };
  }
  if (!replay) {
    return {
      mismatchClass: "LIVE_ONLY",
      signalMatch: false,
      geometryMatch: false,
      liveFingerprint: live ? replaySignalFingerprint(live) : undefined,
      differences: ["missing_replay_signal"],
    };
  }
  if (!live) {
    return {
      mismatchClass: "REPLAY_ONLY",
      signalMatch: false,
      geometryMatch: false,
      replayFingerprint: replaySignalFingerprint(replay),
      differences: ["missing_live_signal"],
    };
  }

  const differences: string[] = [];
  if (replay.symbol !== live.symbol) differences.push("symbol");
  if (replay.strategyId !== live.strategyId) differences.push("strategy_id");
  if (new Date(replay.ts).getTime() !== new Date(live.ts).getTime()) differences.push("ts");
  if (replay.side !== live.side) differences.push("side");
  if ((replay.entryType ?? "market") !== (live.entryType ?? "market")) differences.push("entry_type");
  if (normalizedNumber(replay.entryPrice) !== normalizedNumber(live.entryPrice)) differences.push("entry_price");
  if (normalizedNumber(replay.stopLoss) !== normalizedNumber(live.stopLoss)) differences.push("stop_loss");
  if (normalizedNumber(replay.takeProfit) !== normalizedNumber(live.takeProfit)) differences.push("take_profit");

  const replayFingerprint = replaySignalFingerprint(replay);
  const liveFingerprint = replaySignalFingerprint(live);
  const signalMatch = replayFingerprint === liveFingerprint;
  return {
    mismatchClass: signalMatch ? "MATCH" : "SIGNAL_GEOMETRY",
    signalMatch,
    geometryMatch: differences.length === 0,
    replayFingerprint,
    liveFingerprint,
    differences,
  };
}
