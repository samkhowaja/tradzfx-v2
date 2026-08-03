import { getPairCharacteristics, getRegistryPipSize } from "../pairs/pairCharacteristics";

export const ENTRY_DRIFT_REJECTION_CODE = "ENTRY_DRIFT_EXCEEDED" as const;
export const INVALID_BRACKET_CODE = "INVALID_BRACKET_GEOMETRY" as const;
export const MIN_STOP_REJECTION_CODE = "MIN_STOP_DISTANCE" as const;

export type TradeSide = "buy" | "sell";

export interface ExecutionGeometryInput {
  symbol: string;
  side: TradeSide;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  minStopPips?: number;
}

export type ExecutionGeometryVerdict =
  | { valid: true; stopPips: number; minStopPips: number }
  | { valid: false; code: typeof INVALID_BRACKET_CODE | typeof MIN_STOP_REJECTION_CODE; stopPips: number | null; minStopPips: number };

export function validateStopPips(symbol: string, stopPips: number) {
  const minStopPips = getPairCharacteristics(symbol).minStopPips ?? 3;
  return stopPips < minStopPips
    ? { valid: false as const, code: MIN_STOP_REJECTION_CODE, stopPips, minStopPips }
    : { valid: true as const, code: null, stopPips, minStopPips };
}

export function validateExecutionGeometry(input: ExecutionGeometryInput): ExecutionGeometryVerdict {
  const minStopPips = input.minStopPips ?? getPairCharacteristics(input.symbol).minStopPips ?? 3;
  const values = [input.entry, input.stopLoss, input.takeProfit];
  if (!values.every(Number.isFinite)) {
    return { valid: false, code: INVALID_BRACKET_CODE, stopPips: null, minStopPips };
  }
  const directional = input.side === "buy"
    ? input.stopLoss < input.entry && input.takeProfit > input.entry
    : input.stopLoss > input.entry && input.takeProfit < input.entry;
  if (!directional) {
    return { valid: false, code: INVALID_BRACKET_CODE, stopPips: null, minStopPips };
  }
  const pipSize = getRegistryPipSize(input.symbol);
  const stopPips = Math.abs(input.entry - input.stopLoss) / pipSize;
  if (stopPips < minStopPips) {
    return { valid: false, code: MIN_STOP_REJECTION_CODE, stopPips, minStopPips };
  }
  return { valid: true, stopPips, minStopPips };
}

export function evaluateEntryDrift(symbol: string, plannedEntry: number, observedEntry: number, maxEntryDriftPips: number) {
  const driftPips = Math.abs(observedEntry - plannedEntry) / getRegistryPipSize(symbol);
  return driftPips > maxEntryDriftPips
    ? { accepted: false as const, code: ENTRY_DRIFT_REJECTION_CODE, driftPips, maxEntryDriftPips }
    : { accepted: true as const, code: null, driftPips, maxEntryDriftPips };
}
