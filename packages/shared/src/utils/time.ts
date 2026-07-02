/**
 * Time utilities for session detection and timeframe math.
 */

export type SessionLabel = "ASIA" | "LONDON" | "OVERLAP" | "NY" | "OFF_HOURS";

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
): SessionLabel {
  for (const [session, [start, end]] of Object.entries(windows)) {
    if (utcHour >= start && utcHour <= end) {
      return session as SessionLabel;
    }
  }
  return "OFF_HOURS";
}

// Timeframe math helpers have moved to ./timeBucket.ts so the whole platform
// uses one canonical bucketing implementation. Re-export them here for backward
// compatibility until callers are migrated.
export { getTfMs, floorToTf } from "./timeBucket";

// ── Killzone policy (ported from legacy sessionPolicy) ───────────────────────

export type KillzoneId =
  | "ASIA_KILLZONE"
  | "LONDON_KILLZONE"
  | "NY_KILLZONE"
  | "LATE_NY_KILLZONE"
  | "LONDON_CLOSE"
  | "DEAD_ZONE";

export type SymbolClass =
  | "FX_MAJOR"
  | "FX_CROSS"
  | "FX_EXOTIC"
  | "GOLD"
  | "INDICES_US"
  | "INDICES_EU"
  | "OIL"
  | "CRYPTO"
  | "UNKNOWN";

export interface KillzoneWindow {
  id: KillzoneId;
  label: string;
  utcStartHour: number; // inclusive
  utcEndHour: number; // exclusive (wraps at 24)
  liquidity: "HIGH" | "MODERATE" | "LOW";
  preferredFor: SymbolClass[];
}

export const KILLZONE_WINDOWS: KillzoneWindow[] = [
  {
    id: "ASIA_KILLZONE",
    label: "Asia Killzone (Tokyo Open)",
    utcStartHour: 0,
    utcEndHour: 3,
    liquidity: "LOW",
    preferredFor: ["FX_CROSS"],
  },
  {
    id: "LONDON_KILLZONE",
    label: "London Killzone",
    utcStartHour: 7,
    utcEndHour: 11,
    liquidity: "HIGH",
    preferredFor: ["FX_MAJOR", "FX_CROSS", "GOLD", "INDICES_EU"],
  },
  {
    id: "NY_KILLZONE",
    label: "New York Killzone",
    utcStartHour: 13,
    utcEndHour: 16,
    liquidity: "HIGH",
    preferredFor: ["FX_MAJOR", "FX_CROSS", "GOLD", "INDICES_US", "OIL"],
  },
  {
    id: "LATE_NY_KILLZONE",
    label: "Late New York Killzone",
    utcStartHour: 18,
    utcEndHour: 21,
    liquidity: "HIGH",
    preferredFor: ["GOLD", "INDICES_US"],
  },
  {
    id: "LONDON_CLOSE",
    label: "London Close",
    utcStartHour: 14,
    utcEndHour: 16,
    liquidity: "MODERATE",
    preferredFor: ["FX_MAJOR"],
  },
  {
    id: "DEAD_ZONE",
    label: "Dead Zone (Rollover)",
    utcStartHour: 21,
    utcEndHour: 24,
    liquidity: "LOW",
    preferredFor: [],
  },
];

function classifySymbol(symbol: string): SymbolClass {
  const s = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (/^(BTC|ETH|XRP|LTC|BCH|ADA|DOT|DOGE|SOL|AVAX|LINK)/i.test(s)) return "CRYPTO";
  if (/^(XAUUSD|GOLD)/i.test(s)) return "GOLD";
  if (/^(WTICOUSD|BCOUSD|USOIL|UKOIL|OIL)/i.test(s)) return "OIL";
  if (/^(NAS100|US30|SPX500|US500|NDX|DJI|SPX)/i.test(s)) return "INDICES_US";
  if (/^(DE40|UK100|DAX|FTSE|GER)/i.test(s)) return "INDICES_EU";

  const majors = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD", "USDCAD"];
  for (const m of majors) {
    if (s === m || s === m.replace("USD", "")) return "FX_MAJOR";
  }

  const crosses = [
    "EURGBP", "EURJPY", "GBPJPY", "EURCHF", "GBPCHF", "AUDNZD", "EURAUD",
    "GBPAUD", "EURCAD", "CADJPY", "AUDJPY", "CHFJPY",
  ];
  for (const c of crosses) {
    if (s === c) return "FX_CROSS";
  }

  const exoticCurrencies = ["MXN", "TRY", "ZAR", "PLN", "HUF", "CZK", "SGD", "HKD", "NOK", "SEK"];
  for (const ex of exoticCurrencies) {
    if (s.includes(ex)) return "FX_EXOTIC";
  }

  if (s.length === 6 && /^[A-Z]+$/.test(s)) return "FX_MAJOR";

  return "UNKNOWN";
}

function killzoneMatches(kz: KillzoneWindow, utcHour: number): boolean {
  if (kz.utcEndHour > kz.utcStartHour) {
    return utcHour >= kz.utcStartHour && utcHour < kz.utcEndHour;
  }
  if (kz.utcEndHour <= kz.utcStartHour && kz.utcEndHour > 0) {
    return utcHour >= kz.utcStartHour || utcHour < kz.utcEndHour;
  }
  return utcHour >= kz.utcStartHour;
}

/** Return the narrowest active killzone for a UTC hour, or null. */
export function getActiveKillzone(utcHour: number): KillzoneWindow | null {
  let best: KillzoneWindow | null = null;
  let bestSpan = Infinity;

  for (const kz of KILLZONE_WINDOWS) {
    if (!killzoneMatches(kz, utcHour)) continue;
    const span = kz.utcEndHour > kz.utcStartHour
      ? kz.utcEndHour - kz.utcStartHour
      : 24 - kz.utcStartHour + kz.utcEndHour;
    if (span < bestSpan) {
      best = kz;
      bestSpan = span;
    }
  }
  return best;
}

/** Get liquidity level for a UTC hour. */
export function getLiquidityForHour(utcHour: number): "HIGH" | "MODERATE" | "LOW" {
  const kz = getActiveKillzone(utcHour);
  if (kz) return kz.liquidity;
  if (utcHour >= 3 && utcHour < 7) return "LOW";
  if (utcHour >= 17 && utcHour < 21) return "MODERATE";
  return "MODERATE";
}

/** Check if a killzone is preferred for a symbol class. */
export function isPreferredKillzone(symbol: string, killzoneId: KillzoneId): boolean {
  const symbolClass = classifySymbol(symbol);
  const kz = KILLZONE_WINDOWS.find((w) => w.id === killzoneId);
  if (!kz) return false;
  return kz.preferredFor.includes(symbolClass);
}
