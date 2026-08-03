import type { Candle, ZoneOutput } from "@tm/shared";

export type SimulationStyle = "scalp" | "intraday" | "swing";
export type EntryAt = "mid" | "top" | "bottom";

export interface SimulationParams {
  style: SimulationStyle;
  entryAt: EntryAt;
  stopBufferAtr: number;
  targetRs: number[];
  trailing: boolean;
  minQualityScore: number;
  spreadGateAtrPct: number;
  volatilityGatePercentile: number;
  maxBars: number;
}

export interface FvgSimulationSetup {
  zone: ZoneOutput["zones"][number];
  formationCandles?: [Candle, Candle, Candle];
  preFormationCandles?: Candle[];
  candlesAfterFormation: Candle[];
  atr?: number;
  spread?: number;
  atrPercentile?: number;
  qualityScore: number;
}

export interface FvgMetadata {
  atr: number;
  gapSize: number;
  gapAtrRatio: number;
  middleBodyRatio: number;
  middleBodyVsAverage: number;
  directionAligned: boolean;
}

function trueRange(candle: Candle, previous?: Candle): number {
  return previous ? Math.max(candle.h - candle.l, Math.abs(candle.h - previous.c), Math.abs(candle.l - previous.c)) : candle.h - candle.l;
}

function computeAtr(candles: Candle[], period: number): number {
  if (!candles.length) return 0;
  const recent = candles.slice(-period);
  return recent.reduce((sum, candle, index) => sum + trueRange(candle, recent[index - 1]), 0) / recent.length;
}

export function computeSetupMetadata(setup: FvgSimulationSetup): FvgMetadata {
  if (!setup.formationCandles || !setup.preFormationCandles?.length) throw new Error("CANDLE_ONLY FVG setup requires formation and pre-formation candles");
  const [c1, c2, c3] = setup.formationCandles;
  const bullish = setup.zone.direction === "bullish";
  const atr = computeAtr(setup.preFormationCandles, 14);
  const gapSize = bullish ? c3.l - c1.h : c1.l - c3.h;
  const c2Body = Math.abs(c2.c - c2.o);
  const c2Range = c2.h - c2.l;
  const bodies = setup.preFormationCandles.slice(-20).map((candle) => Math.abs(candle.c - candle.o));
  const averageBody = bodies.length ? bodies.reduce((sum, value) => sum + value, 0) / bodies.length : 0;
  return {
    atr,
    gapSize,
    gapAtrRatio: atr > 0 ? gapSize / atr : 0,
    middleBodyRatio: c2Range > 0 ? c2Body / c2Range : 0,
    middleBodyVsAverage: averageBody > 0 ? c2Body / averageBody : 0,
    directionAligned: bullish ? c2.c > c2.o : c2.c < c2.o,
  };
}

export interface TradeResult {
  r: number;
  mfeR: number;
  maeR: number;
  exitReason: string;
  barsHeld: number;
  filled: boolean;
}

export interface SimulationResult {
  totalSetups: number;
  filteredByQuality: number;
  filteredBySpread: number;
  filteredByVolatility: number;
  executedTrades: number;
  wins: number;
  losses: number;
  avgR: number;
  maxMaeR: number;
  expectancy: number;
  label: "CANDLE_ONLY";
  trades: TradeResult[];
}

function entryPrice(zone: FvgSimulationSetup["zone"], entryAt: EntryAt): number {
  if (entryAt === "top") return zone.top;
  if (entryAt === "bottom") return zone.bottom;
  return (zone.top + zone.bottom) / 2;
}

export function simulateExit(setup: FvgSimulationSetup, params: SimulationParams): TradeResult {
  const zone = setup.zone;
  const bullish = zone.direction === "bullish";
  const entry = entryPrice(zone, params.entryAt);
  const atr = setup.atr ?? computeSetupMetadata(setup).atr;
  const stop = bullish ? zone.bottom - params.stopBufferAtr * atr : zone.top + params.stopBufferAtr * atr;
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= 0) throw new Error("FVG simulation requires positive risk");

  let filled = false;
  let mfeR = 0;
  let maeR = 0;
  let lastPrice = entry;
  const candles = setup.candlesAfterFormation.slice(0, params.maxBars);
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!filled) {
      const touched = candle.l <= entry && candle.h >= entry;
      if (!touched) continue;
      filled = true;
    }
    if (bullish) {
      mfeR = Math.max(mfeR, (candle.h - entry) / risk);
      maeR = Math.min(maeR, (candle.l - entry) / risk);
    } else {
      mfeR = Math.max(mfeR, (entry - candle.l) / risk);
      maeR = Math.min(maeR, (entry - candle.h) / risk);
    }

    const stopHit = bullish ? candle.l <= stop : candle.h >= stop;
    if (stopHit) {
      const gapThroughStop = bullish ? candle.o < stop : candle.o > stop;
      // Broker stop fills at stop. Do not turn a gap into an artificial -25R.
      const exitPrice = stop;
      const stopR = bullish ? (exitPrice - entry) / risk : (entry - exitPrice) / risk;
      // Intrabar wick beyond an executable stop is not realizable MAE. Use
      // stop/open execution boundary instead of recording impossible depth.
      maeR = Math.max(maeR, stopR);
      return { r: stopR, mfeR, maeR, exitReason: gapThroughStop ? "gap_stop" : "stop", barsHeld: i + 1, filled };
    }
    for (const targetR of [...params.targetRs].sort((a, b) => a - b)) {
      const target = bullish ? entry + risk * targetR : entry - risk * targetR;
      if ((bullish && candle.h >= target) || (!bullish && candle.l <= target)) {
        return { r: targetR, mfeR, maeR, exitReason: `tp${targetR}r`, barsHeld: i + 1, filled };
      }
    }
    lastPrice = candle.c;
  }

  if (!filled) return { r: 0, mfeR: 0, maeR: 0, exitReason: "unfilled", barsHeld: candles.length, filled: false };
  const r = bullish ? (lastPrice - entry) / risk : (entry - lastPrice) / risk;
  return { r, mfeR, maeR, exitReason: "expired", barsHeld: candles.length, filled: true };
}

export function simulateFvgs(setups: FvgSimulationSetup[], params: SimulationParams): SimulationResult {
  const result: SimulationResult = { totalSetups: setups.length, filteredByQuality: 0, filteredBySpread: 0, filteredByVolatility: 0, executedTrades: 0, wins: 0, losses: 0, avgR: 0, maxMaeR: 0, expectancy: 0, label: "CANDLE_ONLY", trades: [] };
  for (const setup of setups) {
    if (setup.qualityScore < params.minQualityScore) { result.filteredByQuality++; continue; }
    const metadata = setup.formationCandles && setup.preFormationCandles ? computeSetupMetadata(setup) : undefined;
    const atr = setup.atr ?? metadata?.atr ?? 0;
    if (setup.spread !== undefined && setup.spread > atr * params.spreadGateAtrPct) { result.filteredBySpread++; continue; }
    if (setup.atrPercentile !== undefined && setup.atrPercentile > params.volatilityGatePercentile) { result.filteredByVolatility++; continue; }
    const trade = simulateExit(setup, params);
    if (!trade.filled) continue;
    if (trade.r < -5 || trade.r > 10 || trade.maeR < -5) {
      const entry = entryPrice(setup.zone, params.entryAt);
      const atr = setup.atr ?? metadata?.atr ?? 0;
      const stop = setup.zone.direction === "bullish" ? setup.zone.bottom - params.stopBufferAtr * atr : setup.zone.top + params.stopBufferAtr * atr;
      const target = setup.zone.direction === "bullish" ? entry + Math.abs(entry - stop) * Math.max(...params.targetRs) : entry - Math.abs(entry - stop) * Math.max(...params.targetRs);
      console.error(JSON.stringify({ anomaly: true, zoneTs: setup.zone.ts, zoneType: setup.zone.direction, entry, stop, target, risk: Math.abs(entry - stop), zoneHeight: Math.abs(setup.zone.top - setup.zone.bottom), atr, exitPrice: trade.exitReason === "gap_stop" || trade.exitReason === "stop" ? stop : undefined, exitReason: trade.exitReason, r: trade.r, maeR: trade.maeR, barsHeld: trade.barsHeld, firstPostOpen: setup.candlesAfterFormation[0]?.o, firstPostLow: setup.candlesAfterFormation[0]?.l }));
    }
    result.trades.push(trade);
  }
  result.executedTrades = result.trades.length;
  result.wins = result.trades.filter((trade) => trade.r > 0).length;
  result.losses = result.trades.filter((trade) => trade.r < 0).length;
  result.avgR = result.executedTrades ? result.trades.reduce((sum, trade) => sum + trade.r, 0) / result.executedTrades : 0;
  result.maxMaeR = result.trades.reduce((min, trade) => Math.min(min, trade.maeR), 0);
  result.expectancy = result.avgR;
  return result;
}
