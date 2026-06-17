// apps/web/src/lib/robots/ninjaTurtleScalper.ts
// Ninja Turtle Scalper — Donchian Channel breakout with tight trailing stop.
// Defaults optimized for XAUUSD on a 5m timeframe.

import type { Bar } from "./indicators";
import { aggregateBars, donchianChannel } from "./indicators";

export type Side = "buy" | "sell";

export interface Signal {
  side: Side;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  comment?: string;
}

export interface StrategyContext {
  bars: readonly Bar[];
  index: number;
  currentBar: Bar;
  positions: { side: Side; open: boolean }[];
}

export interface NinjaTurtleConfig {
  donchianTfMinutes: number;
  donchianPeriod: number;
  slPct: number;
  tpPct: number;
  tslTriggerPct: number;
  tslValuePct: number;
  tslStepPct: number;
}

const defaults: NinjaTurtleConfig = {
  donchianTfMinutes: 5,
  donchianPeriod: 20,
  slPct: 0.005,
  tpPct: 0.015,
  tslTriggerPct: 0.0075,
  tslValuePct: 0.0025,
  tslStepPct: 0.000625,
};

export function createNinjaTurtleScalperStrategy(
  overrides: Partial<NinjaTurtleConfig> = {}
) {
  const cfg = { ...defaults, ...overrides };
  let cachedBars: readonly Bar[] = [];
  let tfBars: (Bar | null)[] = [];
  let dcUpper: (number | null)[] = [];
  let dcLower: (number | null)[] = [];

  return {
    id: "ninja_turtle_scalper",
    name: "Ninja Turtle Scalper",
    cfg,
    onBar(ctx: StrategyContext): Signal | null {
      const { bars, index, currentBar, positions } = ctx;
      if (bars !== cachedBars) {
        cachedBars = bars;
        tfBars = aggregateBars(bars, cfg.donchianTfMinutes * 60_000);
        const tfArray = tfBars.map((b) => b ?? currentBar);
        const dc = donchianChannel(tfArray, cfg.donchianPeriod);
        dcUpper = dc.upper;
        dcLower = dc.lower;
      }

      if (positions.some((p) => p.open)) return null;

      const tfBar = tfBars[index];
      if (!tfBar) return null;

      const prevUpper = index > 0 ? dcUpper[index - 1] : null;
      const prevLower = index > 0 ? dcLower[index - 1] : null;
      const upper = dcUpper[index];
      const lower = dcLower[index];
      if (!prevUpper || !prevLower || !upper || !lower) return null;

      const prevClose = index > 0 ? bars[index - 1].c : tfBar.o;

      let side: Side | null = null;
      if (tfBar.c > prevUpper && prevClose <= prevUpper) side = "buy";
      else if (tfBar.c < prevLower && prevClose >= prevLower) side = "sell";
      if (!side) return null;

      const entry = currentBar.c;
      const sl = side === "buy" ? entry * (1 - cfg.slPct) : entry * (1 + cfg.slPct);
      const tp = side === "buy" ? entry * (1 + cfg.tpPct) : entry * (1 - cfg.tpPct);

      return {
        side,
        entryPrice: entry,
        stopLoss: sl,
        takeProfit: tp,
        comment: "Ninja Turtle",
      };
    },
  };
}
