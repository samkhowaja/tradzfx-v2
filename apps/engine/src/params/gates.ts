/**
 * Gate Default Parameters
 *
 * Default thresholds and policies for trading gates.
 * Specs can override via YAML; these are the fallback defaults.
 */

import { SPREAD_SANITY_MULTIPLIER as SHARED_SPREAD_SANITY_MULTIPLIER } from "@tm/shared";

export const GATE_PARAMS = {
  /** Default ATR percentile ceiling when no explicit config in spec. */
  VOLATILITY_DEFAULT_PERCENTILE: {
    value: 0.95,
    unit: "percentile" as const,
    desc: "Default max ATR percentile when spec has no explicit vol gate",
    changed: "2026-07-10",
    docRef: "SK-gate-001",
  },
  /** Spread sanity: max multiple of baseSpreadPips before data is quarantined. */
  SPREAD_SANITY_MULTIPLIER: {
    value: SHARED_SPREAD_SANITY_MULTIPLIER,
    unit: "multiplier" as const,
    desc: "Max spread multiple of base before sample is rejected",
    changed: "2026-07-10",
    docRef: "SK-gate-002",
  },
  /** Spread gate: max spread pips default (when spec omits it). */
  SPREAD_DEFAULT_MAX_PIPS: {
    value: 5,
    unit: "pips" as const,
    desc: "Default max spread pips for spread gate",
    changed: "2026-07-10",
    docRef: "SK-gate-003",
  },
  /** Valid percentile keys for volatility gate resolution. */
  VOLATILITY_PERCENTILE_KEYS: {
    value: [0.05, 0.25, 0.5, 0.75, 0.95, 0.99] as number[],
    unit: "percentiles" as const,
    desc: "Valid ATR percentile column keys",
    changed: "2026-07-10",
    docRef: "SK-gate-004",
  },
  /** Default ATR period for volatility gate. */
  VOLATILITY_DEFAULT_ATR_PERIOD: {
    value: 5,
    unit: "period" as const,
    desc: "Default ATR period for volatility gate",
    changed: "2026-07-10",
    docRef: "SK-gate-005",
  },
  /** Default ATR timeframe for volatility gate. */
  VOLATILITY_DEFAULT_ATR_TF: {
    value: "5m" as const,
    unit: "timeframe" as const,
    desc: "Default ATR timeframe for volatility gate",
    changed: "2026-07-10",
    docRef: "SK-gate-006",
  },
} as const;

export const VOLATILITY_DEFAULT_PERCENTILE = GATE_PARAMS.VOLATILITY_DEFAULT_PERCENTILE.value;
export const SPREAD_SANITY_MULTIPLIER = GATE_PARAMS.SPREAD_SANITY_MULTIPLIER.value;
export const SPREAD_DEFAULT_MAX_PIPS = GATE_PARAMS.SPREAD_DEFAULT_MAX_PIPS.value;
export const VOLATILITY_PERCENTILE_KEYS = GATE_PARAMS.VOLATILITY_PERCENTILE_KEYS.value;
export const VOLATILITY_DEFAULT_ATR_PERIOD = GATE_PARAMS.VOLATILITY_DEFAULT_ATR_PERIOD.value;
export const VOLATILITY_DEFAULT_ATR_TF = GATE_PARAMS.VOLATILITY_DEFAULT_ATR_TF.value;
