/**
 * Parameter Catalog — single source of truth for every engine knob.
 *
 * Import individual typed param accessors:
 *   import { ZONE_MIN_BODY_PCT } from "../params";
 *
 * Or access structured param objects:
 *   import { ZONE_PARAMS } from "../params/zone";
 *
 * To dump all params as JSON (for reports/dashboards/debug):
 *   import { dumpParams } from "../params";
 *   console.log(JSON.stringify(dumpParams(), null, 2));
 */

export * from "./zone";
export * from "./ifvg";
export * from "./lifecycle";
export * from "./gates";
export * from "./pairs";

/**
 * Dump every registered param as a flat JSON object.
 * Useful for engine health reports, audit dashboards, and debug output.
 */
export function dumpParams(): Record<string, unknown> {
  // Dynamic import to avoid circular deps — all param files are pure data.
  const all: Record<string, unknown> = {};

  // Zone params
  const zone = require("./zone").ZONE_PARAMS;
  for (const [k, v] of Object.entries(zone)) {
    all[`zone.${k}`] = v;
  }

  // iFVG params
  const ifvg = require("./ifvg").IFVG_PARAMS;
  for (const [k, v] of Object.entries(ifvg)) {
    all[`ifvg.${k}`] = v;
  }

  // Lifecycle params
  const lc = require("./lifecycle").LIFECYCLE_PARAMS;
  for (const [k, v] of Object.entries(lc)) {
    all[`lifecycle.${k}`] = v;
  }

  // Gate params
  const gates = require("./gates").GATE_PARAMS;
  for (const [k, v] of Object.entries(gates)) {
    all[`gates.${k}`] = v;
  }

  // Pair defaults
  const pairs = require("./pairs").PAIR_DEFAULTS;
  for (const [k, v] of Object.entries(pairs)) {
    all[`pairs.${k}`] = v;
  }

  return all;
}
