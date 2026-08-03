import type { StrategySpec } from "@tm/shared";

/** First isolated shadow contract. Not seeded, promoted, or connected to order execution. */
export const XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2: StrategySpec = {
  id: "xauusd_liquidity_reversal_shadow_v2",
  familyId: "xauusd_liquidity_reversal_shadow",
  name: "XAUUSD Liquidity Reversal DAG Shadow v2",
  version: "2.0.0-shadow.1",
  active: false,
  filters: { symbols: ["XAUUSD"] },
  progressiveVersion: 2,
  progressiveSteps: [
    {
      id: "direction_context", kind: "context", feature: "features_direction_state", tf: "1h",
      predicate: "direction != 'neutral' AND agreement = true", dependencies: [], ttlBars: 8,
      identityColumns: ["symbol", "tf", "ts"], directionMap: "same", consumption: "shared_root",
    },
    {
      id: "liquidity_sweep", kind: "event", feature: "features_sweep", tf: "15m",
      predicate: "direction IS NOT NULL", dependencies: [{ stepId: "direction_context", relation: "after", maxDelayBars: 32 }],
      ttlBars: 8, identityColumns: ["symbol", "tf", "ts", "direction", "kind"],
      directionMap: "liquidity_to_trade", consumption: "exclusive_setup",
    },
    {
      id: "structure_confirm", kind: "entry", feature: "features_structure", tf: "15m",
      predicate: "event_type IN ('mss','choch')", dependencies: [{ stepId: "liquidity_sweep", relation: "within", minDelayBars: 0, maxDelayBars: 8 }],
      ttlBars: 8, identityColumns: ["symbol", "tf", "ts", "event_type", "direction"],
      directionMap: "same", consumption: "exclusive_setup", terminal: "entry_ready",
    },
  ],
  setup: [], entry: [], signalSource: "generic",
  risk: { sl: "atr(15m) * 1.0", tp: "sl * 2.0", minRR: 2, timeoutBars: 8 }, gates: [],
};

/** Evidence-backed continuation comparator. Separate inactive plan; strict reversal contract remains unchanged. */
export const XAUUSD_LIQUIDITY_CONFIRMED_BOS_SHADOW_V2: StrategySpec = {
  ...XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2,
  id: "xauusd_liquidity_confirmed_bos_shadow_v2",
  familyId: "xauusd_liquidity_confirmed_bos_shadow",
  name: "XAUUSD Liquidity Confirmed BOS DAG Shadow v2",
  version: "2.0.0-shadow.2",
  active: false,
  progressiveSteps: XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2.progressiveSteps!.map((step) =>
    step.id === "structure_confirm"
      ? { ...step, predicate: "event_type = 'bos' AND confirmed = true" }
      : { ...step }),
};
