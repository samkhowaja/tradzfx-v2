import type { EvaluationContext } from "../types";

export function runHardRules(ctx: EvaluationContext): string[] {
  const blocks: string[] = [];

  if (ctx.direction === "neutral") {
    blocks.push("No directional bias established");
  }

  if (!ctx.latestCandle) {
    blocks.push("No candle data available for analysis");
    return blocks;
  }

  if (ctx.spreadPips > ctx.maxAllowedSpreadPips) {
    blocks.push(`Spread ${ctx.spreadPips.toFixed(1)}p exceeds max allowed ${ctx.maxAllowedSpreadPips.toFixed(1)}p`);
  }

  if (ctx.htfBias && ctx.htfBias.state === "BLOCK" && ctx.htfBias.direction !== "neutral") {
    if (ctx.htfBias.direction !== ctx.direction) {
      blocks.push(`HTF bias is BLOCK (${ctx.htfBias.direction}) vs setup (${ctx.direction})`);
    }
  }

  if (ctx.zones.length === 0) {
    blocks.push("No active zones available for entry");
  }

  const freshZones = ctx.zones.filter((z) => !z.tapped);
  if (freshZones.length === 0 && ctx.zones.length > 0) {
    blocks.push("All nearby zones have already been tapped");
  }

  if (ctx.activePositionCount >= ctx.maxPositionsPerSymbol) {
    blocks.push(`Already at max ${ctx.maxPositionsPerSymbol} active positions for ${ctx.symbol}`);
  }

  if (ctx.volatility.regime === "high" && ctx.spreadPips > ctx.maxAllowedSpreadPips * 0.5) {
    blocks.push("High volatility + wide spread — avoid new entries");
  }

  if (!ctx.entryZone) {
    blocks.push("No entry zone within 1.5 ATR of current price");
  }

  return blocks;
}
