/**
 * Pair Characteristics Registry
 *
 * Consolidates symbol metadata, cost model, volatility thresholds,
 * session preferences, and side asymmetry for deterministic lookup.
 * Pure data: no IO, no DB. Fail-open for unknown symbols.
 */

import type { TimeFrame } from "../types/feature";
import type { KillzoneId, SymbolClass } from "../utils/time";
import { getPipInfo } from "./pipMath";

export type { TimeFrame, KillzoneId, SymbolClass };

export interface PairCharacteristics {
  symbol: string;
  symbolClass: SymbolClass;
  tickSize: number;
  pipSize: number;

  /** Cost model */
  baseSpreadPips: number;
  slippageK: number; // fraction of ATR per tick
  slippageMinPips: number;
  slippageMaxPips: number;

  /** Session-adjusted spread multipliers */
  sessionSpreadMultiplier: Record<string, number>;

  /** Volatility regime thresholds (pair-specific ATR%) */
  volLowAtrPct: number;
  volHighAtrPct: number;

  /** POI tolerance */
  eqToleranceTicks: number;
  poiTolerancePips: number;

  /** Session preferences */
  preferredKillzones: KillzoneId[];

  /** Minimum execution trigger timeframe for this symbol. */
  minimumExecutionTf?: TimeFrame;

  /** Optional side-asymmetry sizing for structurally-biased assets. */
  sideAsymmetry?: {
    longSizePct: number; // 0-100
    longMinQuality?: "STANDARD" | "HIGH";
  };

  /** Commission in pips per round-trip lot (entry+exit). */
  commissionPipsPerLot: number;
}

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

const PAIR_REGISTRY: Record<string, Omit<PairCharacteristics, "symbol" | "symbolClass">> = {
  EURUSD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 1.0,
    slippageK: 0.08,
    slippageMinPips: 0.1,
    slippageMaxPips: 2.0,
    sessionSpreadMultiplier: { ASIA: 1.25, LONDON: 1.0, NY: 1.0, DEAD: 1.4, OVERLAP: 0.9 },
    volLowAtrPct: 0.1,
    volHighAtrPct: 0.3,
    eqToleranceTicks: 5,
    poiTolerancePips: 3,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  GBPUSD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 1.2,
    slippageK: 0.09,
    slippageMinPips: 0.2,
    slippageMaxPips: 3.0,
    sessionSpreadMultiplier: { ASIA: 1.3, LONDON: 1.0, NY: 1.05, DEAD: 1.5, OVERLAP: 0.9 },
    volLowAtrPct: 0.12,
    volHighAtrPct: 0.35,
    eqToleranceTicks: 5,
    poiTolerancePips: 4,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  USDJPY: {
    tickSize: 0.001,
    pipSize: 0.01,
    baseSpreadPips: 1.0,
    slippageK: 0.08,
    slippageMinPips: 0.1,
    slippageMaxPips: 2.0,
    sessionSpreadMultiplier: { ASIA: 1.1, LONDON: 1.0, NY: 1.0, DEAD: 1.3, OVERLAP: 0.9 },
    volLowAtrPct: 0.08,
    volHighAtrPct: 0.25,
    eqToleranceTicks: 5,
    poiTolerancePips: 3,
    preferredKillzones: ["ASIA_KILLZONE", "LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  USDCHF: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 1.4,
    slippageK: 0.08,
    slippageMinPips: 0.2,
    slippageMaxPips: 2.5,
    sessionSpreadMultiplier: { ASIA: 1.25, LONDON: 1.0, NY: 1.0, DEAD: 1.4, OVERLAP: 0.9 },
    volLowAtrPct: 0.1,
    volHighAtrPct: 0.28,
    eqToleranceTicks: 5,
    poiTolerancePips: 3,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  AUDUSD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 1.2,
    slippageK: 0.08,
    slippageMinPips: 0.1,
    slippageMaxPips: 2.0,
    sessionSpreadMultiplier: { ASIA: 1.1, LONDON: 1.05, NY: 1.0, DEAD: 1.4, OVERLAP: 0.9 },
    volLowAtrPct: 0.1,
    volHighAtrPct: 0.3,
    eqToleranceTicks: 5,
    poiTolerancePips: 3,
    preferredKillzones: ["ASIA_KILLZONE", "LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  NZDUSD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 1.5,
    slippageK: 0.08,
    slippageMinPips: 0.2,
    slippageMaxPips: 2.5,
    sessionSpreadMultiplier: { ASIA: 1.1, LONDON: 1.05, NY: 1.0, DEAD: 1.4, OVERLAP: 0.9 },
    volLowAtrPct: 0.1,
    volHighAtrPct: 0.3,
    eqToleranceTicks: 5,
    poiTolerancePips: 3,
    preferredKillzones: ["ASIA_KILLZONE", "LONDON_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  USDCAD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 1.5,
    slippageK: 0.08,
    slippageMinPips: 0.2,
    slippageMaxPips: 2.5,
    sessionSpreadMultiplier: { ASIA: 1.3, LONDON: 1.0, NY: 1.0, DEAD: 1.4, OVERLAP: 0.9 },
    volLowAtrPct: 0.1,
    volHighAtrPct: 0.3,
    eqToleranceTicks: 5,
    poiTolerancePips: 3,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  GBPJPY: {
    tickSize: 0.001,
    pipSize: 0.01,
    baseSpreadPips: 2.2,
    slippageK: 0.1,
    slippageMinPips: 0.3,
    slippageMaxPips: 5.0,
    sessionSpreadMultiplier: { ASIA: 1.15, LONDON: 1.0, NY: 1.05, DEAD: 1.5, OVERLAP: 0.9 },
    volLowAtrPct: 0.15,
    volHighAtrPct: 0.45,
    eqToleranceTicks: 8,
    poiTolerancePips: 6,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.7,
  },
  EURJPY: {
    tickSize: 0.001,
    pipSize: 0.01,
    baseSpreadPips: 1.5,
    slippageK: 0.09,
    slippageMinPips: 0.2,
    slippageMaxPips: 4.0,
    sessionSpreadMultiplier: { ASIA: 1.15, LONDON: 1.0, NY: 1.0, DEAD: 1.4, OVERLAP: 0.9 },
    volLowAtrPct: 0.12,
    volHighAtrPct: 0.38,
    eqToleranceTicks: 6,
    poiTolerancePips: 5,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.7,
  },
  CADJPY: {
    tickSize: 0.001,
    pipSize: 0.01,
    baseSpreadPips: 1.8,
    slippageK: 0.09,
    slippageMinPips: 0.2,
    slippageMaxPips: 4.0,
    sessionSpreadMultiplier: { ASIA: 1.2, LONDON: 1.0, NY: 1.0, DEAD: 1.4, OVERLAP: 0.9 },
    volLowAtrPct: 0.12,
    volHighAtrPct: 0.38,
    eqToleranceTicks: 6,
    poiTolerancePips: 5,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.7,
  },
  AUDJPY: {
    tickSize: 0.001,
    pipSize: 0.01,
    baseSpreadPips: 1.6,
    slippageK: 0.09,
    slippageMinPips: 0.2,
    slippageMaxPips: 4.0,
    sessionSpreadMultiplier: { ASIA: 1.1, LONDON: 1.0, NY: 1.05, DEAD: 1.4, OVERLAP: 0.9 },
    volLowAtrPct: 0.12,
    volHighAtrPct: 0.38,
    eqToleranceTicks: 6,
    poiTolerancePips: 5,
    preferredKillzones: ["ASIA_KILLZONE", "LONDON_KILLZONE"],
    commissionPipsPerLot: 0.7,
  },
  CHFJPY: {
    tickSize: 0.001,
    pipSize: 0.01,
    baseSpreadPips: 1.8,
    slippageK: 0.09,
    slippageMinPips: 0.2,
    slippageMaxPips: 4.0,
    sessionSpreadMultiplier: { ASIA: 1.2, LONDON: 1.0, NY: 1.05, DEAD: 1.4, OVERLAP: 0.9 },
    volLowAtrPct: 0.12,
    volHighAtrPct: 0.38,
    eqToleranceTicks: 6,
    poiTolerancePips: 5,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.7,
  },
  EURCAD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 2.0,
    slippageK: 0.09,
    slippageMinPips: 0.2,
    slippageMaxPips: 3.0,
    sessionSpreadMultiplier: { ASIA: 1.3, LONDON: 1.0, NY: 1.0, DEAD: 1.5, OVERLAP: 0.9 },
    volLowAtrPct: 0.12,
    volHighAtrPct: 0.35,
    eqToleranceTicks: 5,
    poiTolerancePips: 4,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  EURGBP: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 1.5,
    slippageK: 0.08,
    slippageMinPips: 0.2,
    slippageMaxPips: 2.5,
    sessionSpreadMultiplier: { ASIA: 1.25, LONDON: 1.0, NY: 1.1, DEAD: 1.5, OVERLAP: 0.9 },
    volLowAtrPct: 0.08,
    volHighAtrPct: 0.25,
    eqToleranceTicks: 5,
    poiTolerancePips: 3,
    preferredKillzones: ["LONDON_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  AUDNZD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 2.0,
    slippageK: 0.09,
    slippageMinPips: 0.2,
    slippageMaxPips: 3.0,
    sessionSpreadMultiplier: { ASIA: 1.1, LONDON: 1.1, NY: 1.15, DEAD: 1.5, OVERLAP: 0.9 },
    volLowAtrPct: 0.08,
    volHighAtrPct: 0.25,
    eqToleranceTicks: 5,
    poiTolerancePips: 3,
    preferredKillzones: ["ASIA_KILLZONE"],
    commissionPipsPerLot: 0.5,
  },
  XAUUSD: {
    tickSize: 0.01,
    pipSize: 0.1,
    baseSpreadPips: 3.5,
    slippageK: 0.12,
    slippageMinPips: 0.5,
    slippageMaxPips: 25.0,
    sessionSpreadMultiplier: { ASIA: 1.4, LONDON: 1.05, NY: 1.0, DEAD: 1.8, OVERLAP: 1.2 },
    volLowAtrPct: 0.2,
    volHighAtrPct: 0.6,
    eqToleranceTicks: 10,
    poiTolerancePips: 15,
    preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE", "LATE_NY_KILLZONE"],
    minimumExecutionTf: "5m",
    sideAsymmetry: { longSizePct: 60, longMinQuality: "HIGH" },
    commissionPipsPerLot: 1.0,
  },
  NAS100: {
    tickSize: 0.1,
    pipSize: 1.0,
    baseSpreadPips: 1.5,
    slippageK: 0.1,
    slippageMinPips: 0.5,
    slippageMaxPips: 5.0,
    sessionSpreadMultiplier: { ASIA: 1.4, LONDON: 1.1, NY: 1.0, DEAD: 1.8, OVERLAP: 0.9 },
    volLowAtrPct: 0.2,
    volHighAtrPct: 0.55,
    eqToleranceTicks: 10,
    poiTolerancePips: 10,
    preferredKillzones: ["NY_KILLZONE"],
    commissionPipsPerLot: 1.0,
  },
  US30: {
    tickSize: 1.0,
    pipSize: 1.0,
    baseSpreadPips: 2.0,
    slippageK: 0.1,
    slippageMinPips: 0.5,
    slippageMaxPips: 5.0,
    sessionSpreadMultiplier: { ASIA: 1.4, LONDON: 1.1, NY: 1.0, DEAD: 1.8, OVERLAP: 0.9 },
    volLowAtrPct: 0.2,
    volHighAtrPct: 0.55,
    eqToleranceTicks: 5,
    poiTolerancePips: 15,
    preferredKillzones: ["NY_KILLZONE"],
    commissionPipsPerLot: 1.0,
  },
  SPX500: {
    tickSize: 0.01,
    pipSize: 0.1,
    baseSpreadPips: 0.8,
    slippageK: 0.08,
    slippageMinPips: 0.3,
    slippageMaxPips: 3.0,
    sessionSpreadMultiplier: { ASIA: 1.4, LONDON: 1.1, NY: 1.0, DEAD: 1.8, OVERLAP: 0.9 },
    volLowAtrPct: 0.15,
    volHighAtrPct: 0.45,
    eqToleranceTicks: 8,
    poiTolerancePips: 8,
    preferredKillzones: ["NY_KILLZONE"],
    commissionPipsPerLot: 1.0,
  },
  USDHKD: {
    tickSize: 0.0001,
    pipSize: 0.001,
    baseSpreadPips: 5.0,
    slippageK: 0.12,
    slippageMinPips: 0.5,
    slippageMaxPips: 10.0,
    sessionSpreadMultiplier: { ASIA: 1.1, LONDON: 1.2, NY: 1.2, DEAD: 1.6, OVERLAP: 1.0 },
    volLowAtrPct: 0.05,
    volHighAtrPct: 0.15,
    eqToleranceTicks: 8,
    poiTolerancePips: 5,
    preferredKillzones: ["ASIA_KILLZONE"],
    commissionPipsPerLot: 1.0,
  },
  USDSGD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    baseSpreadPips: 3.0,
    slippageK: 0.1,
    slippageMinPips: 0.3,
    slippageMaxPips: 6.0,
    sessionSpreadMultiplier: { ASIA: 1.1, LONDON: 1.15, NY: 1.15, DEAD: 1.5, OVERLAP: 1.0 },
    volLowAtrPct: 0.08,
    volHighAtrPct: 0.25,
    eqToleranceTicks: 6,
    poiTolerancePips: 4,
    preferredKillzones: ["ASIA_KILLZONE"],
    commissionPipsPerLot: 1.0,
  },
  USDZAR: {
    tickSize: 0.0001,
    pipSize: 0.001,
    baseSpreadPips: 8.0,
    slippageK: 0.15,
    slippageMinPips: 1.0,
    slippageMaxPips: 15.0,
    sessionSpreadMultiplier: { ASIA: 1.4, LONDON: 1.0, NY: 1.1, DEAD: 1.8, OVERLAP: 1.0 },
    volLowAtrPct: 0.15,
    volHighAtrPct: 0.5,
    eqToleranceTicks: 10,
    poiTolerancePips: 10,
    preferredKillzones: ["LONDON_KILLZONE"],
    commissionPipsPerLot: 1.5,
  },
};

const DEFAULT_CHARACTERISTICS: Omit<PairCharacteristics, "symbol" | "symbolClass"> = {
  tickSize: 0.00001,
  pipSize: 0.0001,
  baseSpreadPips: 2.0,
  slippageK: 0.1,
  slippageMinPips: 0.3,
  slippageMaxPips: 5.0,
  sessionSpreadMultiplier: { ASIA: 1.25, LONDON: 1.0, NY: 1.0, DEAD: 1.4, OVERLAP: 1.0 },
  volLowAtrPct: 0.12,
  volHighAtrPct: 0.35,
  eqToleranceTicks: 5,
  poiTolerancePips: 4,
  preferredKillzones: ["LONDON_KILLZONE", "NY_KILLZONE"],
  commissionPipsPerLot: 0.7,
};

export function getPairCharacteristics(symbol: string): PairCharacteristics {
  const s = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const entry = PAIR_REGISTRY[s] ?? DEFAULT_CHARACTERISTICS;
  return {
    symbol: s,
    symbolClass: classifySymbol(s),
    ...entry,
  };
}

/**
 * Registry-based pip size. This is the single source of truth for pip sizing.
 * XAUUSD = 0.1, JPY pairs = 0.01, standard FX = 0.0001.
 */
export function getRegistryPipSize(symbol: string): number {
  return getPairCharacteristics(symbol).pipSize;
}

export function getSessionSpread(symbol: string, session: string): number {
  const pc = getPairCharacteristics(symbol);
  const mult = pc.sessionSpreadMultiplier[session] ?? 1.0;
  return pc.baseSpreadPips * mult;
}

export function getSessionSlippage(symbol: string, atrPips?: number): number {
  const pc = getPairCharacteristics(symbol);
  if (typeof atrPips === "number" && atrPips > 0) {
    const computed = atrPips * pc.slippageK;
    return Math.max(pc.slippageMinPips, Math.min(pc.slippageMaxPips, computed));
  }
  return pc.slippageMinPips;
}

export function getTotalCostPips(symbol: string, session: string, atrPips?: number): number {
  const spread = getSessionSpread(symbol, session);
  const slip = getSessionSlippage(symbol, atrPips);
  return spread + slip * 2;
}

export function hasSufficientEdge(symbol: string, session: string, riskPips: number, atrPips?: number): boolean {
  const cost = getTotalCostPips(symbol, session, atrPips);
  return riskPips >= cost * 1.2;
}

export function getVolatilityThresholds(symbol: string): { low: number; high: number } {
  const pc = getPairCharacteristics(symbol);
  return { low: pc.volLowAtrPct, high: pc.volHighAtrPct };
}

export function getPipValuePerLot(symbol: string): number {
  return getPipInfo(symbol).pipValuePerLot;
}

export function getRegisteredPairs(): string[] {
  return Object.keys(PAIR_REGISTRY);
}

export function isPairRegistered(symbol: string): boolean {
  const s = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s in PAIR_REGISTRY;
}
