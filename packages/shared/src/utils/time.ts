/**
 * Time utilities for session detection and timeframe math.
 */

export interface SessionWindows {
  ASIA: [number, number];
  LONDON: [number, number];
  OVERLAP: [number, number];
  NY: [number, number];
}

export const DEFAULT_SESSION_WINDOWS: SessionWindows = {
  ASIA: [0, 6],
  LONDON: [7, 11],
  OVERLAP: [12, 15],
  NY: [16, 20],
};

export function getSession(
  utcHour: number,
  windows: SessionWindows = DEFAULT_SESSION_WINDOWS
): "ASIA" | "LONDON" | "OVERLAP" | "NY" | "OFF_HOURS" {
  for (const [session, [start, end]] of Object.entries(windows)) {
    if (utcHour >= start && utcHour <= end) {
      return session as "ASIA" | "LONDON" | "OVERLAP" | "NY";
    }
  }
  return "OFF_HOURS";
}

export function getTfMs(tf: string): number {
  const map: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
  };
  return map[tf] ?? 60_000;
}

export function floorToTf(ts: Date, tf: string): Date {
  const ms = getTfMs(tf);
  const epoch = ts.getTime();
  return new Date(Math.floor(epoch / ms) * ms);
}
