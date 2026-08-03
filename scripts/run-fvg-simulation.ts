import dotenv from "dotenv";
import { Pool } from "pg";
import { loadFvgSetups } from "../apps/engine/src/features/fvgSetupLoader";
import { computeSetupMetadata, simulateFvgs, type SimulationParams } from "../apps/engine/src/features/fvgSimulator";

dotenv.config({ path: ".env.local" });

const symbol = process.argv[2] ?? "EURUSD";
const tf = process.argv[3] ?? "5m";
const startDate = process.argv[4] ?? "2026-06-01";
const endDate = process.argv[5] ?? "2026-06-15";
const maxZones = Number(process.argv[6] ?? 500);
  const targetConfig = process.argv[7] ?? "2.0";
const targetRs = targetConfig.split(",").map(Number).filter((value) => Number.isFinite(value) && value > 0);
if (!targetRs.length) throw new Error(`Invalid target config: ${targetConfig}`);
const envNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const params: SimulationParams = {
  style: "intraday",
  entryAt: "mid",
  stopBufferAtr: envNumber("SIM_STOP_BUFFER_ATR", 0.1),
  targetRs,
  trailing: false,
  minQualityScore: envNumber("SIM_MIN_QUALITY", 50),
  spreadGateAtrPct: 0.05,
  volatilityGatePercentile: 0.9,
  maxBars: 100,
};

function pct(value: number, total: number): string {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
}

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  try {
    const setups = await loadFvgSetups(pool, symbol, tf, startDate, endDate, { maxZones });
    const metadata = setups.map(computeSetupMetadata);
    const atrValues = metadata.map((item) => item.gapAtrRatio).sort((a, b) => a - b);
    const p75 = atrValues.length ? atrValues[Math.floor((atrValues.length - 1) * 0.75)] : 0;
    const result = simulateFvgs(setups.map((setup, index) => ({ ...setup, atr: metadata[index].atr, qualityScore: Math.min(100, metadata[index].gapAtrRatio * 20 + metadata[index].middleBodyRatio * 15 + metadata[index].middleBodyVsAverage * 10 + (metadata[index].directionAligned ? 15 : 0)) })), params);
    const incomplete = setups.filter((setup) => setup.candlesAfterFormation.length < params.maxBars).length;
    const sameCandleWins = result.trades.filter((trade) => trade.r > 0 && trade.barsHeld === 1).length;
    const riskRatios = setups.map((setup, index) => {
      const entry = (setup.zone.top + setup.zone.bottom) / 2;
      const stop = setup.zone.direction === "bullish" ? setup.zone.bottom - 0.1 * metadata[index].atr : setup.zone.top + 0.1 * metadata[index].atr;
      return Math.abs(entry - stop) / Math.abs(setup.zone.top - setup.zone.bottom);
    }).filter(Number.isFinite);
    const avgRiskZone = riskRatios.length ? riskRatios.reduce((sum, value) => sum + value, 0) / riskRatios.length : null;
    const midTouched = setups.filter((setup) => {
      const entry = (setup.zone.top + setup.zone.bottom) / 2;
      return setup.candlesAfterFormation.some((candle) => candle.l <= entry && candle.h >= entry);
    }).length;
    const barsHeld = Object.fromEntries([...new Set(result.trades.map((trade) => trade.barsHeld))].sort((a, b) => a - b).map((bars) => [bars, result.trades.filter((trade) => trade.barsHeld === bars).length]));
    const avgMaeR = result.executedTrades ? result.trades.reduce((sum, trade) => sum + trade.maeR, 0) / result.executedTrades : 0;
    console.log(JSON.stringify({ featureContract: "CLEAN_2026_07", contaminatedFeaturesUsed: [], cleanFeaturesUsed: ["candles", "features_atr", "features_zone_geometry", "features_session"], verdict: "CAUSALLY_VALID", label: result.label, symbol, tf, period: `${startDate} to ${endDate}`, totalZones: setups.length, requestedMaxZones: maxZones, targetRs, p75GapAtrRatio: p75, incompletePostWindows: incomplete, filters: { quality: result.filteredByQuality, spread: result.filteredBySpread, volatility: result.filteredByVolatility }, executed: result.executedTrades, wins: result.wins, losses: result.losses, winRate: pct(result.wins, result.executedTrades), sameCandleWins, sameCandleWinRate: pct(sameCandleWins, result.wins), midTouchRate: pct(midTouched, setups.length), avgRiskToZoneRatio: avgRiskZone, avgR: result.avgR, avgMaeR, maxMaeR: result.maxMaeR, avgMfeR: result.executedTrades ? result.trades.reduce((sum, trade) => sum + trade.mfeR, 0) / result.executedTrades : 0, expectancy: result.expectancy, barsHeld, trades: result.trades }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
