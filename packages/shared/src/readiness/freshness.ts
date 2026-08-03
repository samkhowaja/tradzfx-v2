import type { TimeFrame } from "../types/feature";

export const DEFAULT_PRODUCER_CADENCE_MINUTES = 15;
export const DEFAULT_FRESHNESS_GRACE_MINUTES = 5;

const TF_MINUTES: Record<TimeFrame, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

export interface FreshnessPolicyInput {
  tf: TimeFrame;
  producerCadenceMinutes?: number;
  graceMinutes?: number;
}

export interface FreshnessPolicy {
  tf: TimeFrame;
  tfMinutes: number;
  producerCadenceMinutes: number;
  graceMinutes: number;
  maxAgeMinutes: number;
}

function nonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}

/**
 * Producer-aware freshness SLA. Short timeframes must not be declared stale
 * between scheduled producer runs; long timeframes retain a two-bar allowance.
 */
export function resolveFreshnessPolicy(input: FreshnessPolicyInput): FreshnessPolicy {
  const tfMinutes = TF_MINUTES[input.tf];
  if (tfMinutes === undefined) throw new Error(`Unsupported timeframe: ${input.tf}`);

  const producerCadenceMinutes = nonNegativeFinite(
    input.producerCadenceMinutes ?? DEFAULT_PRODUCER_CADENCE_MINUTES,
    "producerCadenceMinutes"
  );
  const graceMinutes = nonNegativeFinite(
    input.graceMinutes ?? DEFAULT_FRESHNESS_GRACE_MINUTES,
    "graceMinutes"
  );

  return {
    tf: input.tf,
    tfMinutes,
    producerCadenceMinutes,
    graceMinutes,
    maxAgeMinutes: Math.max(producerCadenceMinutes + graceMinutes, 2 * tfMinutes),
  };
}
