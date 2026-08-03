/**
 * Structural liquidity pools feature.
 * Labels session ranges, prior day/week extremes, and round-number clusters.
 */

import type { Candle, FeatureDefinition, LiquidityPoolsOutput, LiquidityPool, SweepOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface LiquidityPoolsInput {
  candles: Candle[];
  features_sweep: SweepOutput;
}

const ASIA_START_HOUR = 0;
const ASIA_END_HOUR = 8;
const LONDON_START_HOUR = 8;
const LONDON_END_HOUR = 13;

function highLowOfCandles(candles: Candle[]): { high: number; low: number } {
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (c.h > high) high = c.h;
    if (c.l < low) low = c.l;
  }
  return { high, low };
}

function computeAsianRange(candles: Candle[]): { high: number; low: number; ts: number } | null {
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1];
  const lastDate = new Date(last.ts);
  const lastHour = lastDate.getUTCHours();

  const targetDate = new Date(lastDate);
  if (lastHour < ASIA_END_HOUR) {
    targetDate.setUTCDate(targetDate.getUTCDate() - 1);
  }
  targetDate.setUTCHours(0, 0, 0, 0);
  const startMs = targetDate.getTime();
  const endMs = startMs + ASIA_END_HOUR * 60 * 60 * 1000;

  const sessionCandles = candles.filter((c) => c.ts.getTime() >= startMs && c.ts.getTime() < endMs);
  if (sessionCandles.length === 0) return null;

  const { high, low } = highLowOfCandles(sessionCandles);
  return { high, low, ts: startMs };
}

function computeLondonRange(candles: Candle[]): { high: number; low: number; ts: number } | null {
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1];
  const lastDate = new Date(last.ts);
  const lastHour = lastDate.getUTCHours();

  const targetDate = new Date(lastDate);
  if (lastHour < LONDON_END_HOUR) {
    targetDate.setUTCDate(targetDate.getUTCDate() - 1);
  }
  targetDate.setUTCHours(LONDON_START_HOUR, 0, 0, 0);
  const startMs = targetDate.getTime();
  const endMs = startMs + (LONDON_END_HOUR - LONDON_START_HOUR) * 60 * 60 * 1000;

  const sessionCandles = candles.filter((c) => c.ts.getTime() >= startMs && c.ts.getTime() < endMs);
  if (sessionCandles.length === 0) return null;

  const { high, low } = highLowOfCandles(sessionCandles);
  return { high, low, ts: startMs };
}

function computePrevDayExtremes(candles: Candle[]): { high: number; low: number } | null {
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1];
  const lastDate = new Date(last.ts);
  lastDate.setUTCHours(0, 0, 0, 0);
  const startMs = lastDate.getTime() - 86400000;
  const endMs = lastDate.getTime();

  const dayCandles = candles.filter((c) => c.ts.getTime() >= startMs && c.ts.getTime() < endMs);
  if (dayCandles.length === 0) return null;

  const { high, low } = highLowOfCandles(dayCandles);
  return { high, low };
}

function computePrevWeekExtremes(candles: Candle[]): { high: number; low: number } | null {
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1];
  const lastDate = new Date(last.ts);
  const day = lastDate.getUTCDay();
  const diff = (day + 6) % 7; // Monday = 0
  const currentMonday = new Date(lastDate);
  currentMonday.setUTCDate(lastDate.getUTCDate() - diff);
  currentMonday.setUTCHours(0, 0, 0, 0);
  const startMs = currentMonday.getTime() - 7 * 86400000;
  const endMs = currentMonday.getTime();

  const weekCandles = candles.filter((c) => c.ts.getTime() >= startMs && c.ts.getTime() < endMs);
  if (weekCandles.length === 0) return null;

  const { high, low } = highLowOfCandles(weekCandles);
  return { high, low };
}

function computeRoundNumbers(symbol: string, currentPrice: number): LiquidityPool[] {
  const s = (symbol ?? "").toUpperCase();
  let interval = 1.0;

  if (s.includes("XAU") || s.includes("GOLD")) {
    interval = 50.0;
  } else if (s.includes("XAG") || s.includes("SILVER")) {
    interval = 1.0;
  } else if (s.includes("NAS") || s.includes("US30") || s.includes("SPX") || s.includes("US500")) {
    interval = 100.0;
  } else if (s.includes("JPY")) {
    interval = 1.0;
  } else if (s.includes("USDCAD") || s.includes("USDCHF") || s.includes("AUDUSD") || s.includes("NZDUSD")) {
    interval = 0.05;
  } else {
    interval = 0.05;
  }

  const center = Math.round(currentPrice / interval) * interval;
  const pools: LiquidityPool[] = [];

  for (let i = -3; i <= 3; i++) {
    const price = center + i * interval;
    if (price <= 0) continue;
    pools.push({
      kind: "round_number",
      label: `RN ${price.toFixed(price < 10 ? 2 : 0)}`,
      price,
      distance: Math.abs(price - currentPrice),
      strength: 0,
      interval,
    });
  }

  return pools;
}

function computeStrength(distance: number, atr: number): number {
  if (!atr || atr <= 0) return 0;
  const ratio = distance / atr;
  if (ratio < 0.5) return 100;
  if (ratio < 1.0) return 80;
  if (ratio < 2.0) return 60;
  if (ratio < 3.0) return 40;
  if (ratio < 5.0) return 20;
  return 0;
}

export function sweepMatchesPool(
  sweptPrice: number,
  pools: LiquidityPool[],
  toleranceAtr: number,
  atr: number
): { matched: boolean; pool?: LiquidityPool; distance: number } {
  if (!atr || atr <= 0) return { matched: false, distance: Infinity };
  const tolerance = toleranceAtr * atr;

  for (const pool of pools) {
    const dist = Math.abs(pool.price - sweptPrice);
    if (dist <= tolerance) {
      return { matched: true, pool, distance: dist };
    }
  }
  return { matched: false, distance: Infinity };
}

function computeAtr(candles: Candle[]): number {
  const lookback = Math.min(20, candles.length);
  if (lookback === 0) return 0;
  let sum = 0;
  for (let i = candles.length - lookback; i < candles.length; i++) {
    sum += candles[i].h - candles[i].l;
  }
  return sum / lookback;
}

function sideForPool(kind: LiquidityPool["kind"], price: number, currentPrice: number): LiquidityPool["side"] {
  if (kind.includes("_high") || kind === "eqh") return "sell_side";
  if (kind.includes("_low") || kind === "eql") return "buy_side";
  if (kind === "round_number") return price >= currentPrice ? "sell_side" : "buy_side";
  return undefined;
}

function computePools(input: LiquidityPoolsInput): LiquidityPoolsOutput {
  const candles = input.candles;
  const sweeps = input.features_sweep?.sweeps ?? [];
  if (candles.length === 0) {
    return { pools: [], nearestAbove: null, nearestBelow: null, roundNumbers: [] };
  }

  const last = candles[candles.length - 1];
  const currentPrice = last.c;
  const symbol = last.symbol;
  const atr = computeAtr(candles);

  const pools: LiquidityPool[] = [];

  const asian = computeAsianRange(candles);
  if (asian) {
    pools.push(
      { kind: "asian_high", label: "Asian High", price: asian.high, distance: Math.abs(asian.high - currentPrice), strength: 0 },
      { kind: "asian_low", label: "Asian Low", price: asian.low, distance: Math.abs(asian.low - currentPrice), strength: 0 }
    );
  }

  const london = computeLondonRange(candles);
  if (london) {
    pools.push(
      { kind: "london_high", label: "London High", price: london.high, distance: Math.abs(london.high - currentPrice), strength: 0 },
      { kind: "london_low", label: "London Low", price: london.low, distance: Math.abs(london.low - currentPrice), strength: 0 }
    );
  }

  const prevDay = computePrevDayExtremes(candles);
  if (prevDay) {
    pools.push(
      { kind: "prev_day_high", label: "PDH", price: prevDay.high, distance: Math.abs(prevDay.high - currentPrice), strength: 0 },
      { kind: "prev_day_low", label: "PDL", price: prevDay.low, distance: Math.abs(prevDay.low - currentPrice), strength: 0 }
    );
  }

  const prevWeek = computePrevWeekExtremes(candles);
  if (prevWeek) {
    pools.push(
      { kind: "prev_week_high", label: "PWH", price: prevWeek.high, distance: Math.abs(prevWeek.high - currentPrice), strength: 0 },
      { kind: "prev_week_low", label: "PWL", price: prevWeek.low, distance: Math.abs(prevWeek.low - currentPrice), strength: 0 }
    );
  }

  const roundNumbers = computeRoundNumbers(symbol, currentPrice);
  pools.push(...roundNumbers);

  for (const pool of pools) {
    pool.strength = computeStrength(pool.distance, atr);
    pool.side = sideForPool(pool.kind, pool.price, currentPrice);
  }

  pools.sort((a, b) => b.strength - a.strength);

  const above = pools
    .filter((p) => p.price > currentPrice)
    .sort((a, b) => a.distance - b.distance)[0] ?? null;
  const below = pools
    .filter((p) => p.price < currentPrice)
    .sort((a, b) => a.distance - b.distance)[0] ?? null;

  // Check if the most recent sweep touched a recognized pool on the correct side.
  // A bullish sweep sweeps liquidity below price (lows/support), so it should only
  // match low-side structural pools and round-number supports. A bearish sweep sweeps
  // highs/resistance, so it should only match high-side structural pools and round-number
  // resistances. We use the pool kind rather than `side` because `side` is computed
  // relative to the *current* price, not the price at the time of the sweep.
  let recentSweepMatched = false;
  if (sweeps.length > 0) {
    const latestSweep = sweeps[sweeps.length - 1];
    const sweepPrice = latestSweep.extreme;
    const isLowPool = (p: LiquidityPool) =>
      p.kind.endsWith("_low") || p.kind === "eql" || p.kind === "round_number";
    const isHighPool = (p: LiquidityPool) =>
      p.kind.endsWith("_high") || p.kind === "eqh" || p.kind === "round_number";
    const relevantPools = pools.filter((p) =>
      latestSweep.direction === "bullish" ? isLowPool(p) : isHighPool(p)
    );
    const match = sweepMatchesPool(sweepPrice, relevantPools, 0.5, atr);
    recentSweepMatched = match.matched;
  }

  return { pools, nearestAbove: above, nearestBelow: below, roundNumbers, recentSweepMatched };
}

export const liquidityPoolsFeature: FeatureDefinition<LiquidityPoolsInput, LiquidityPoolsOutput> = {
  name: "features_liquidity_pools",
  version: "1.1.1",
  dependencies: ["features_sweep"],

  compute(input): LiquidityPoolsOutput {
    return computePools(input);
  },

  hashInput(input): string {
    const candles = input.candles ?? [];
    const last = candles[candles.length - 1];
    if (!last) return sha256("empty");
    const sweepHash = (input.features_sweep?.sweeps ?? [])
      .map((s) => `${s.ts.toISOString()}:${s.direction}:${s.level}:${s.extreme}`)
      .join("|") ?? "";
    return sha256(`${last.symbol}:${last.ts.toISOString()}|${sweepHash}`);
  },

  hashOutput(output): string {
    return sha256(
      output.pools.map((p) => `${p.kind}:${p.price}:${p.strength}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    const base = {
      recent_sweep_matched: output.recentSweepMatched ?? false,
      nearest_above_price: output.nearestAbove?.price ?? null,
      nearest_below_price: output.nearestBelow?.price ?? null,
    };
    return output.pools.map((p) => ({
      ...base,
      kind: p.kind,
      side: p.side ?? null,
      label: p.label,
      price: p.price,
      distance: p.distance,
      strength: p.strength,
      interval: p.interval ?? null,
    }));
  },

  deserialize(rows): LiquidityPoolsOutput {
    const first = rows[0];
    const pools = rows.map((r) => ({
      kind: r.kind as LiquidityPool["kind"],
      side: (r.side as LiquidityPool["side"]) ?? undefined,
      label: r.label as string,
      price: r.price as number,
      distance: r.distance as number,
      strength: r.strength as number,
      interval: r.interval ? (r.interval as number) : undefined,
    }));

    return {
      pools,
      nearestAbove: pools.find((p) => p.price === (first?.nearest_above_price as number)) ?? null,
      nearestBelow: pools.find((p) => p.price === (first?.nearest_below_price as number)) ?? null,
      roundNumbers: pools.filter((p) => p.kind === "round_number"),
      recentSweepMatched: (first?.recent_sweep_matched as boolean) ?? false,
    };
  },
};
