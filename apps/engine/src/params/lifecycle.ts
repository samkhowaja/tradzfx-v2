/**
 * Lifecycle Parameters
 *
 * Thresholds and limits for zone/iFVG/OB lifecycle computation.
 * Mitigation thresholds reference MITIGATION_FILL_PCT from @tm/shared lifecycle.ts
 * — change there, mirror here.
 */

/** Re-export from shared — change in @tm/shared/lifecycle.ts, mirror here. */
export { MITIGATION_FILL_PCT as ZONE_MITIGATION_THRESHOLD } from "@tm/shared";
export { MITIGATION_FILL_PCT as IFVG_MITIGATION_THRESHOLD } from "@tm/shared";

export const LIFECYCLE_PARAMS = {
  /** Max hours before lifecycle refresh is considered stale. */
  MAX_AGE_HOURS: {
    value: 2,
    unit: "hours" as const,
    desc: "Max lifecycle age before refresh required",
    changed: "2026-07-10",
    docRef: "SK-lc-003",
  },
  /** Quality score decay factor: max bars for ageFactor = 1. */
  QUALITY_AGE_HALFLIFE_BARS: {
    value: 50,
    unit: "bars" as const,
    desc: "Zone quality age decay denominator",
    changed: "2026-07-10",
    docRef: "SK-lc-004",
  },
} as const;

export const LIFECYCLE_MAX_AGE_HOURS = LIFECYCLE_PARAMS.MAX_AGE_HOURS.value;
export const QUALITY_AGE_HALFLIFE_BARS = LIFECYCLE_PARAMS.QUALITY_AGE_HALFLIFE_BARS.value;
