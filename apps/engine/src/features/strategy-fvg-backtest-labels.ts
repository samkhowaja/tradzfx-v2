export type BacktestInputClass = "PRE_CAUSAL" | "CANDLE_ONLY" | "POST_CAUSAL";

export interface BacktestMetadata {
  inputClass: BacktestInputClass;
  usesContaminatedStructure: boolean;
  usesContaminatedBias: boolean;
  usesCandleOnlyFeatures: boolean;
  engineVersion: string;
  causalBoundaryFixed: boolean;
}

export function createCandleOnlyBacktestMetadata(engineVersion: string): BacktestMetadata {
  return {
    inputClass: "CANDLE_ONLY",
    usesContaminatedStructure: false,
    usesContaminatedBias: false,
    usesCandleOnlyFeatures: true,
    engineVersion,
    causalBoundaryFixed: false,
  };
}

export function assertComparableBacktests(left: BacktestMetadata, right: BacktestMetadata): void {
  if (left.inputClass !== right.inputClass) {
    throw new Error(`Incomparable backtest input classes: ${left.inputClass} vs ${right.inputClass}`);
  }
  if (left.usesContaminatedStructure !== right.usesContaminatedStructure || left.usesContaminatedBias !== right.usesContaminatedBias) {
    throw new Error("Incomparable backtests: contamination flags differ");
  }
  if (left.usesCandleOnlyFeatures !== right.usesCandleOnlyFeatures) {
    throw new Error("Incomparable backtests: candle-only flags differ");
  }
}
