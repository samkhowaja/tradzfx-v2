/**
 * iFVG Detection Parameters
 *
 * Central registry of all tunable knobs for Inverse FVG detection.
 * See zone.ts header for conventions.
 */

import { envNum } from "./helpers";
import type { TimeFrame } from "@tm/shared";

export const IFVG_PARAMS = {
  /** Minimum fill % for the original FVG to be considered "filled" (0..1). */
  MIN_FILL_PCT: {
    value: envNum("IFVG_MIN_FILL_PCT", 0.5),
    unit: "ratio" as const,
    desc: "Min gap fill % for FVG eligibility",
    changed: "2026-07-24",
    docRef: "SK-ifvg-001",
  },
  /** Default max age bars (used when TF lookup fails and no env override). */
  MAX_AGE_BARS: {
    value: envNum("IFVG_MAX_AGE_BARS", 50),
    unit: "bars" as const,
    desc: "Default max iFVG age (env override wins over TF table)",
    changed: "2026-07-10",
    docRef: "SK-ifvg-002",
  },
  /** Minimum consecutive candles confirming the reversal that creates the iFVG. */
  MIN_CONFIRMATIONS: {
    value: envNum("IFVG_MIN_CONFIRMATIONS", 1),
    unit: "bars" as const,
    desc: "Min confirmation bars for iFVG reversal",
    changed: "2026-07-10",
    docRef: "SK-ifvg-003",
  },
  /** Per-TF max age in bars. Lower TFs = wider window. */
  TF_MAX_AGE_BARS: {
    value: {
      "1m": envNum("IFVG_TF_MAX_AGE_1M", 120),
      "5m": envNum("IFVG_TF_MAX_AGE_5M", 80),
      "15m": envNum("IFVG_TF_MAX_AGE_15M", 50),
      "1h": envNum("IFVG_TF_MAX_AGE_1H", 30),
      "4h": envNum("IFVG_TF_MAX_AGE_4H", 20),
      "1d": envNum("IFVG_TF_MAX_AGE_1D", 10),
    } as Record<TimeFrame, number>,
    unit: "bars_per_tf" as const,
    desc: "Per-TF max iFVG age lookup table",
    changed: "2026-07-10",
    docRef: "SK-ifvg-004",
  },
} as const;

/** Type-safe accessors. */
export const IFVG_MIN_FILL_PCT = IFVG_PARAMS.MIN_FILL_PCT.value;
export const IFVG_DEFAULT_MAX_AGE_BARS = IFVG_PARAMS.MAX_AGE_BARS.value;
export const IFVG_MIN_CONFIRMATIONS = IFVG_PARAMS.MIN_CONFIRMATIONS.value;
export const IFVG_TF_MAX_AGE_BARS = IFVG_PARAMS.TF_MAX_AGE_BARS.value;
