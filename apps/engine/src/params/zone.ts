/**
 * Zone Detection Parameters
 *
 * Central registry of all tunable knobs for supply/demand zone detection.
 * Each entry is a typed object with value, unit, description, and last-changed date.
 * Engine code imports from here instead of hardcoding.
 *
 * To change a parameter: edit value + changed date + doc reference.
 * Git log on this file = full change history.
 *
 * To dump all params: import { ZONE_PARAMS } from "./zone" and print.
 */

import { envNum } from "./helpers";

export const ZONE_PARAMS = {
  /** Minimum impulse candle body as fraction of range (0..1). Higher = stricter. */
  MIN_BODY_PCT: {
    value: envNum("ZONE_MIN_BODY_PCT", 0.7),
    unit: "ratio" as const,
    desc: "Min candle body/range for zone formation impulse",
    changed: "2026-07-24",
    docRef: "SK-zone-001",
  },
  /** Minimum volume ratio vs trailing average. Higher = stricter. */
  MIN_VOLUME_RATIO: {
    value: envNum("ZONE_MIN_VOLUME_RATIO", 1.5),
    unit: "ratio" as const,
    desc: "Min volume vs trailing average for zone formation",
    changed: "2026-07-24",
    docRef: "SK-zone-002",
  },
  /** Max age (bars) for a pivot to anchor a zone. */
  MAX_AGE_BARS: {
    value: envNum("ZONE_PIVOT_MAX_AGE_BARS", 10),
    unit: "bars" as const,
    desc: "Max pivot age to anchor zone",
    changed: "2026-07-10",
    docRef: "SK-zone-003",
  },
  /** Minimum zone height as fraction of ATR14. Below this → zone discarded. */
  MIN_ZONE_SIZE_ATR_PCT: {
    value: envNum("ZONE_MIN_SIZE_ATR_PCT", 0.05),
    unit: "fraction_of_atr14" as const,
    desc: "Minimum zone height relative to ATR14",
    changed: "2026-07-10",
    docRef: "SK-zone-004",
  },
  /** Maximum zone height as multiplier of ATR14. Above this → discard as implausible. */
  MAX_ZONE_SIZE_ATR_MULTIPLIER: {
    value: envNum("ZONE_MAX_SIZE_ATR_MULTIPLIER", 30),
    unit: "x_atr14" as const,
    desc: "Max zone height multiplier of ATR14",
    changed: "2026-07-10",
    docRef: "SK-zone-005",
  },
  /** Minimum quality score for a zone to be emitted (0..1). */
  MIN_QUALITY_SCORE: {
    value: envNum("ZONE_MIN_QUALITY_SCORE", 0.15),
    unit: "score_0_1" as const,
    desc: "Min quality score for zone emission",
    changed: "2026-07-10",
    docRef: "SK-zone-006",
  },
  /** Maximum zones emitted per bar (cap to avoid bloat). */
  MAX_PER_BAR: {
    value: envNum("ZONE_MAX_PER_BAR", 5),
    unit: "zones" as const,
    desc: "Max zones per bar",
    changed: "2026-07-10",
    docRef: "SK-zone-007",
  },
  /** Buffer added to zone top/bottom as fraction of ATR14. */
  BUFFER_ATR_MULTIPLIER: {
    value: envNum("ZONE_BUFFER_ATR_MULTIPLIER", 0.1),
    unit: "x_atr14" as const,
    desc: "Zone buffer as multiplier of ATR14",
    changed: "2026-07-10",
    docRef: "SK-zone-008",
  },
  /** Use learned outcome quality (zone_outcomes table) instead of heuristic. */
  USE_LEARNED_QUALITY: {
    value: process.env.ZONE_USE_LEARNED_QUALITY === "true",
    unit: "boolean" as const,
    desc: "Use learned outcome quality from zone_outcomes table",
    changed: "2026-07-10",
    docRef: "SK-zone-009",
  },
} as const;

/** Type-safe accessors for use in engine code. */
export const ZONE_MIN_BODY_PCT = ZONE_PARAMS.MIN_BODY_PCT.value;
export const ZONE_MIN_VOLUME_RATIO = ZONE_PARAMS.MIN_VOLUME_RATIO.value;
export const ZONE_PIVOT_MAX_AGE_BARS = ZONE_PARAMS.MAX_AGE_BARS.value;
export const ZONE_MIN_SIZE_ATR_PCT = ZONE_PARAMS.MIN_ZONE_SIZE_ATR_PCT.value;
export const ZONE_MAX_SIZE_ATR_MULTIPLIER = ZONE_PARAMS.MAX_ZONE_SIZE_ATR_MULTIPLIER.value;
export const ZONE_MIN_QUALITY_SCORE = ZONE_PARAMS.MIN_QUALITY_SCORE.value;
export const ZONE_MAX_PER_BAR = ZONE_PARAMS.MAX_PER_BAR.value;
export const ZONE_BUFFER_ATR_MULTIPLIER = ZONE_PARAMS.BUFFER_ATR_MULTIPLIER.value;
export const ZONE_USE_LEARNED_QUALITY = ZONE_PARAMS.USE_LEARNED_QUALITY.value;
