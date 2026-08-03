import type { TimeFrame } from "../types/feature";

export type LevelKind = "zone" | "ifvg" | "order_block";

export interface LevelAlivenessRow {
  ts: Date | string;
  fillPct?: number | null;
  firstTouchAt?: Date | string | null;
  mitigatedAt?: Date | string | null;
  invalidatedAt?: Date | string | null;
}

export interface LevelAlivenessPolicy {
  allowMitigated?: boolean;
  allowTouched?: boolean;
}

const DAY_MS = 86_400_000;

export const LEVEL_MAX_AGE_DAYS: Readonly<Record<LevelKind, Partial<Record<TimeFrame, number>>>> = {
  zone: { "1m": 2, "5m": 3, "15m": 5, "1h": 14, "4h": 30, "1d": 90 },
  ifvg: { "1m": 1, "5m": 1, "15m": 2, "1h": 5, "4h": 14, "1d": 30 },
  order_block: { "1m": 3, "5m": 5, "15m": 10, "1h": 30, "4h": 60, "1d": 120 },
};

export function getLevelMaxAgeDays(kind: LevelKind, tf: TimeFrame): number | undefined {
  return LEVEL_MAX_AGE_DAYS[kind][tf];
}

export function getLevelMaxAgeMs(kind: LevelKind, tf: TimeFrame): number | undefined {
  const days = getLevelMaxAgeDays(kind, tf);
  return days === undefined ? undefined : days * DAY_MS;
}

function time(value: Date | string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : undefined;
}

export function isLevelAliveAsOf(
  row: LevelAlivenessRow,
  anchor: Date,
  kind: LevelKind,
  tf: TimeFrame,
  policy: LevelAlivenessPolicy = {}
): boolean {
  const anchorMs = anchor.getTime();
  const formedMs = time(row.ts);
  if (!Number.isFinite(anchorMs) || formedMs === undefined || formedMs > anchorMs) return false;
  const invalidatedMs = time(row.invalidatedAt);
  if (invalidatedMs !== undefined && invalidatedMs <= anchorMs) return false;
  if ((row.fillPct ?? 0) >= 0.95) return false;
  const mitigatedMs = time(row.mitigatedAt);
  if (!policy.allowMitigated && mitigatedMs !== undefined && mitigatedMs <= anchorMs) return false;
  const touchedMs = time(row.firstTouchAt);
  // Touch is informational by default. Strategies can explicitly demand an
  // untouched level with allowTouched:false without breaking retest setups.
  if (policy.allowTouched === false && touchedMs !== undefined && touchedMs <= anchorMs) return false;
  const maxAgeMs = getLevelMaxAgeMs(kind, tf);
  return maxAgeMs === undefined || anchorMs - formedMs <= maxAgeMs;
}

export function isLevelAlive(
  row: LevelAlivenessRow,
  kind: LevelKind,
  tf: TimeFrame,
  policy: LevelAlivenessPolicy = {},
  now = new Date()
): boolean {
  return isLevelAliveAsOf(row, now, kind, tf, policy);
}
