/**
 * Pair Default Parameters
 *
 * Default values applied when a symbol has no explicit PairCharacteristics entry.
 * Ensures no pair is NaN/undefined fallback.
 */

export const PAIR_DEFAULTS = {
  /** Min stop distance in pips for unregistered pairs. */
  MIN_STOP_PIPS: {
    value: 3,
    unit: "pips" as const,
    desc: "Fallback min stop pips for unregistered pairs",
    changed: "2026-07-10",
    docRef: "SK-pair-001",
  },
  /** Default base spread pips for unregistered pairs (conservative). */
  BASE_SPREAD_PIPS: {
    value: 2.0,
    unit: "pips" as const,
    desc: "Fallback base spread pips for unregistered pairs",
    changed: "2026-07-10",
    docRef: "SK-pair-002",
  },
  /** Commission pips per round-trip lot for unregistered pairs. */
  COMMISSION_PIPS_PER_LOT: {
    value: 0,
    unit: "pips" as const,
    desc: "Fallback commission per lot",
    changed: "2026-07-10",
    docRef: "SK-pair-003",
  },
  /** Gate spread multiplier for unregistered pairs (conservative). */
  GATE_SPREAD_MULTIPLIER: {
    value: 4,
    unit: "multiplier" as const,
    desc: "Fallback gate spread multiplier (FX-class default)",
    changed: "2026-07-10",
    docRef: "SK-pair-004",
  },
} as const;
