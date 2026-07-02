/**
 * Post-fill execution safety helpers.
 */

export function computeActualRR(
  side: "buy" | "sell",
  fillPrice: number,
  stopLoss: number,
  takeProfit: number
): number {
  const risk = side === "buy" ? fillPrice - stopLoss : stopLoss - fillPrice;
  const reward = side === "buy" ? takeProfit - fillPrice : fillPrice - takeProfit;
  if (!Number.isFinite(risk) || !Number.isFinite(reward) || risk === 0) return 0;
  return reward / risk;
}

export function isBadFill(actualRR: number, minRR: number): boolean {
  return Number.isFinite(actualRR) && actualRR < minRR;
}
