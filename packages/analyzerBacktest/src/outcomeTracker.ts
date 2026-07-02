export interface Candle {
  ts: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface TrackedOutcome {
  outcome: "win" | "loss" | "open" | "missed";
  outcomeR: number;
  exitPrice: number | null;
  exitTs: string | null;
  barsHeld: number;
}

export function trackOutcome(
  direction: "long" | "short" | "neutral",
  entryZone: { top: number; bottom: number },
  stopLoss: number | null,
  takeProfit: number | null,
  futureCandles: Candle[]
): TrackedOutcome {
  if (direction === "neutral" || stopLoss == null || takeProfit == null) {
    return { outcome: "missed", outcomeR: 0, exitPrice: null, exitTs: null, barsHeld: 0 };
  }

  // Assume entry at the midpoint of the proposed entry zone.
  const entryPrice = (entryZone.top + entryZone.bottom) / 2;
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);

  if (risk === 0) {
    return { outcome: "missed", outcomeR: 0, exitPrice: null, exitTs: null, barsHeld: 0 };
  }

  for (let i = 0; i < futureCandles.length; i++) {
    const candle = futureCandles[i];
    if (direction === "long") {
      if (candle.l <= stopLoss) {
        return {
          outcome: "loss",
          outcomeR: -1,
          exitPrice: stopLoss,
          exitTs: candle.ts,
          barsHeld: i + 1,
        };
      }
      if (candle.h >= takeProfit) {
        return {
          outcome: "win",
          outcomeR: reward / risk,
          exitPrice: takeProfit,
          exitTs: candle.ts,
          barsHeld: i + 1,
        };
      }
    } else {
      if (candle.h >= stopLoss) {
        return {
          outcome: "loss",
          outcomeR: -1,
          exitPrice: stopLoss,
          exitTs: candle.ts,
          barsHeld: i + 1,
        };
      }
      if (candle.l <= takeProfit) {
        return {
          outcome: "win",
          outcomeR: reward / risk,
          exitPrice: takeProfit,
          exitTs: candle.ts,
          barsHeld: i + 1,
        };
      }
    }
  }

  return {
    outcome: "open",
    outcomeR: 0,
    exitPrice: null,
    exitTs: null,
    barsHeld: futureCandles.length,
  };
}
