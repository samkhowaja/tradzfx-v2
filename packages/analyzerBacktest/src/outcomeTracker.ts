import { getRegistryPipSize } from "@tm/shared";

export interface Candle {
  ts: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface TrackedOutcome {
  outcome: "win" | "loss" | "open" | "missed" | "timeout";
  outcomeR: number;
  exitPrice: number | null;
  exitTs: string | null;
  barsHeld: number;
  /** Effective entry price after spread/slippage adjustments */
  effectiveEntry: number | null;
  /** Maximum adverse excursion in R during the trade */
  maxAdverseR: number;
  /** Maximum favorable excursion in R during the trade */
  maxFavorableR: number;
}

export interface TrackOutcomeOptions {
  /** Spread in pips. Applied once at entry for market orders (half each side) and at exit. */
  spreadPips?: number;
  /** Slippage in pips applied pessimistically to entry and exit. */
  slippagePips?: number;
  /** Commission in pips per round-trip lot. Half is applied to entry and half to exit. */
  commissionPips?: number;
  /** How to resolve when both SL and TP are touched inside the same 1m bar. */
  intrabarMode?: "optimistic" | "pessimistic" | "midpoint" | "proportion";
  /** Optional pip size for the symbol. Defaults to 0.0001 (FX) or 0.01 if entry > 50. */
  pipSize?: number;
}

function resolvePipSize(_entryPrice: number, symbol?: string, pipSize?: number): number {
  if (pipSize != null && pipSize > 0) return pipSize;
  if (symbol) return getRegistryPipSize(symbol);
  return 0.0001;
}

function pipsToPrice(pips: number, pipSize: number): number {
  return pips * pipSize;
}

/**
 * Determine whether SL or TP was hit first within a single bar.
 * Uses the chosen intrabar resolution mode.
 */
function resolveIntrabar(
  direction: "long" | "short",
  sl: number,
  tp: number,
  candle: Candle,
  mode: TrackOutcomeOptions["intrabarMode"]
): "sl" | "tp" {
  if (mode === "optimistic") return direction === "long" ? "tp" : "sl";
  if (mode === "pessimistic") return direction === "long" ? "sl" : "tp";

  if (mode === "proportion") {
    // Estimate which level was closer to the open relative to the full range.
    const range = candle.h - candle.l;
    if (range === 0) return "sl";
    if (direction === "long") {
      const slDistance = Math.abs(candle.o - sl);
      const tpDistance = Math.abs(tp - candle.o);
      return slDistance <= tpDistance ? "sl" : "tp";
    } else {
      const slDistance = Math.abs(sl - candle.o);
      const tpDistance = Math.abs(candle.o - tp);
      return slDistance <= tpDistance ? "sl" : "tp";
    }
  }

  // midpoint: assume the level that is closer to the midpoint of the bar was hit first
  const mid = (candle.h + candle.l) / 2;
  if (direction === "long") {
    return Math.abs(sl - mid) <= Math.abs(tp - mid) ? "sl" : "tp";
  } else {
    return Math.abs(sl - mid) <= Math.abs(tp - mid) ? "sl" : "tp";
  }
}

export function trackOutcome(
  direction: "long" | "short" | "neutral",
  entryZone: { top: number; bottom: number },
  stopLoss: number | null,
  takeProfit: number | null,
  futureCandles: Candle[],
  options: TrackOutcomeOptions = {}
): TrackedOutcome {
  const {
    spreadPips = 0,
    slippagePips = 0,
    commissionPips = 0,
    intrabarMode = "pessimistic",
  } = options;

  if (direction === "neutral" || stopLoss == null || takeProfit == null) {
    return {
      outcome: "missed",
      outcomeR: 0,
      exitPrice: null,
      exitTs: null,
      barsHeld: 0,
      effectiveEntry: null,
      maxAdverseR: 0,
      maxFavorableR: 0,
    };
  }

  // Assume entry at the midpoint of the proposed entry zone.
  const rawEntryPrice = (entryZone.top + entryZone.bottom) / 2;
  const pipSize = resolvePipSize(rawEntryPrice, undefined, options.pipSize);
  const spreadPrice = pipsToPrice(spreadPips, pipSize);
  const slippagePrice = pipsToPrice(slippagePips, pipSize);

  // For a market entry, the effective entry is worse by half spread + slippage + half commission.
  const commissionPrice = pipsToPrice(commissionPips, pipSize);
  const halfCommission = commissionPrice / 2;
  const entryAdjustment = spreadPrice / 2 + slippagePrice + halfCommission;
  const effectiveEntry = direction === "long"
    ? rawEntryPrice + entryAdjustment
    : rawEntryPrice - entryAdjustment;

  const risk = Math.abs(effectiveEntry - stopLoss);

  if (risk <= 0 || !Number.isFinite(risk)) {
    return {
      outcome: "missed",
      outcomeR: 0,
      exitPrice: null,
      exitTs: null,
      barsHeld: 0,
      effectiveEntry,
      maxAdverseR: 0,
      maxFavorableR: 0,
    };
  }

  const reward = Math.abs(takeProfit - effectiveEntry);
  if (reward <= 0 || !Number.isFinite(reward)) {
    return {
      outcome: "missed",
      outcomeR: 0,
      exitPrice: null,
      exitTs: null,
      barsHeld: 0,
      effectiveEntry,
      maxAdverseR: 0,
      maxFavorableR: 0,
    };
  }
  const targetR = reward / risk;

  let maxAdverseR = 0;
  let maxFavorableR = 0;

  for (let i = 0; i < futureCandles.length; i++) {
    const candle = futureCandles[i];

    // Track excursions relative to effective entry, normalized by risk.
    if (direction === "long") {
      const adverse = (effectiveEntry - candle.l) / risk;
      if (adverse > maxAdverseR) maxAdverseR = adverse;
      const favorable = (candle.h - effectiveEntry) / risk;
      if (favorable > maxFavorableR) maxFavorableR = favorable;
    } else {
      const adverse = (candle.h - effectiveEntry) / risk;
      if (adverse > maxAdverseR) maxAdverseR = adverse;
      const favorable = (effectiveEntry - candle.l) / risk;
      if (favorable > maxFavorableR) maxFavorableR = favorable;
    }

    const exitAdjustment = spreadPrice / 2 + slippagePrice + halfCommission;

    const slHit = direction === "long" ? candle.l <= stopLoss : candle.h >= stopLoss;
    const tpHit = direction === "long" ? candle.h >= takeProfit : candle.l <= takeProfit;

    function outcomeRFromExit(effectiveExit: number): number {
      const delta = direction === "long" ? effectiveExit - effectiveEntry : effectiveEntry - effectiveExit;
      return delta / risk;
    }

    if (slHit && tpHit) {
      const first = resolveIntrabar(direction, stopLoss, takeProfit, candle, intrabarMode);
      const effectiveExit =
        first === "sl"
          ? direction === "long" ? stopLoss - exitAdjustment : stopLoss + exitAdjustment
          : direction === "long" ? takeProfit - exitAdjustment : takeProfit + exitAdjustment;
      const r = outcomeRFromExit(effectiveExit);
      return {
        outcome: r >= 0 ? "win" : "loss",
        outcomeR: r,
        exitPrice: effectiveExit,
        exitTs: candle.ts,
        barsHeld: i + 1,
        effectiveEntry,
        maxAdverseR,
        maxFavorableR,
      };
    }

    if (slHit) {
      const effectiveExit = direction === "long" ? stopLoss - exitAdjustment : stopLoss + exitAdjustment;
      return {
        outcome: "loss",
        outcomeR: outcomeRFromExit(effectiveExit),
        exitPrice: effectiveExit,
        exitTs: candle.ts,
        barsHeld: i + 1,
        effectiveEntry,
        maxAdverseR,
        maxFavorableR,
      };
    }

    if (tpHit) {
      const effectiveExit = direction === "long" ? takeProfit - exitAdjustment : takeProfit + exitAdjustment;
      return {
        outcome: "win",
        outcomeR: outcomeRFromExit(effectiveExit),
        exitPrice: effectiveExit,
        exitTs: candle.ts,
        barsHeld: i + 1,
        effectiveEntry,
        maxAdverseR,
        maxFavorableR,
      };
    }
  }

  // Trade was still open at the end of the backtest window.
  // Report as timeout/no-result and exclude from win/loss/R stats.
  return {
    outcome: "timeout",
    outcomeR: 0,
    exitPrice: null,
    exitTs: null,
    barsHeld: futureCandles.length,
    effectiveEntry,
    maxAdverseR,
    maxFavorableR,
  };
}
