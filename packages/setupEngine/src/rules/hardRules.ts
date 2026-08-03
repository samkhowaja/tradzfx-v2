import type { EvaluationContext } from "../types";

/**
 * Family-aware hard rules.
 *
 * Universal safety rules (direction, candle availability, spread, HTF opposition,
 * active position count, high-vol + wide-spread) always apply — they are the
 * safety floor that no family can drop.
 *
 * Family-specific rules are dispatched by `setupFamily` so an ORB strategy is
 * never blocked because "all nearby zones have already been tapped", and a
 * moving-average strategy is never blocked because "no entry zone within 1.5
 * ATR of current price". (RC-3 / Bug #14)
 */

/** Universal safety rules — the floor that no family can drop. */
function runUniversalRules(ctx: EvaluationContext): string[] {
  const blocks: string[] = [];

  if (ctx.direction === "neutral") {
    blocks.push("No directional bias established");
  }

  if (!ctx.latestCandle) {
    blocks.push("No candle data available for analysis");
    return blocks; // No point checking further without a candle
  }

  if (ctx.spreadPips > ctx.maxAllowedSpreadPips) {
    blocks.push(`Spread ${ctx.spreadPips.toFixed(1)}p exceeds max allowed ${ctx.maxAllowedSpreadPips.toFixed(1)}p`);
  }

  if (ctx.htfBias && ctx.htfBias.state === "BLOCK" && ctx.htfBias.direction !== "neutral") {
    if (ctx.htfBias.direction !== ctx.direction) {
      blocks.push(`HTF bias is BLOCK (${ctx.htfBias.direction}) vs setup (${ctx.direction})`);
    }
  }

  if (ctx.activePositionCount >= ctx.maxPositionsPerSymbol) {
    blocks.push(`Already at max ${ctx.maxPositionsPerSymbol} active positions for ${ctx.symbol}`);
  }

  if (ctx.volatility.regime === "high" && ctx.spreadPips > ctx.maxAllowedSpreadPips * 0.5) {
    blocks.push("High volatility + wide spread — avoid new entries");
  }

  return blocks;
}

/** Zone-reversal family: requires active, untapped zones within ATR range. */
function runZoneReversalRules(ctx: EvaluationContext): string[] {
  const blocks: string[] = [];

  if (ctx.zones.length === 0) {
    blocks.push("No active zones available for entry");
  }

  if (!ctx.entryZone) {
    blocks.push("No entry zone within 1.5 ATR of current price");
  }

  return blocks;
}

/** FVG continuation family: requires an unmitigated FVG aligned with direction. */
function runFvgContinuationRules(ctx: EvaluationContext): string[] {
  const blocks: string[] = [];

  // FVG strategies need at least one active FVG zone aligned with the setup direction.
  // Reuse the zones list (FVGs are stored as zone_kind='fvg' in features_zone).
  const alignedFvgs = ctx.zones.filter(
    (z) => z.type === "fvg" && (z.direction === ctx.direction || z.direction === undefined)
  );
  if (alignedFvgs.length === 0) {
    blocks.push("No active FVG aligned with setup direction");
  }

  return blocks;
}

/** ORB breakout family: no zone-specific hard rules. */
function runOrbBreakoutRules(_ctx: EvaluationContext): string[] {
  // ORB strategies are validated by the signal SQL (opening range exists,
  // breakout direction, session window). No zone-specific hard rules.
  return [];
}

/** Trend pullback (MA) family: no zone-specific hard rules. */
function runTrendPullbackRules(_ctx: EvaluationContext): string[] {
  // MA strategies are validated by the signal SQL (fast/slow MA alignment,
  // pullback to MA). No zone-specific hard rules.
  return [];
}

/** Indicator family: no zone-specific hard rules. */
function runIndicatorRules(_ctx: EvaluationContext): string[] {
  // Indicator strategies are validated by the signal SQL (indicator value
  // threshold, direction alignment). No zone-specific hard rules.
  return [];
}

/** Liquidity sweep family: requires a recent sweep event. */
function runLiquiditySweepRules(ctx: EvaluationContext): string[] {
  const blocks: string[] = [];

  // Liquidity sweep strategies need recent structure events (sweeps are
  // detected as structure events). If no structure events exist, block.
  if (ctx.structure.length === 0) {
    blocks.push("No recent structure events for liquidity sweep entry");
  }

  return blocks;
}

/** Unknown family: fall back to zone-reversal rules (safe default). */
function runUnknownRules(ctx: EvaluationContext): string[] {
  return runZoneReversalRules(ctx);
}

export function runHardRules(ctx: EvaluationContext): string[] {
  // 1. Universal safety floor — always applies.
  const blocks = runUniversalRules(ctx);

  // If the universal rules already blocked (e.g. no candle), return early —
  // family rules can't add useful information without a candle.
  if (blocks.length > 0 && blocks.includes("No candle data available for analysis")) {
    return blocks;
  }

  // 2. Family-specific rules.
  // Signal source is authoritative fallback. Older callers and persisted
  // backtest contexts may omit setupFamily; never apply zone rules to an
  // indicator signal in that case.
  const family = ctx.setupFamily === "zone_reversal" && ctx.signalSource === "indicator"
    ? "indicator"
    : ctx.setupFamily ?? "zone_reversal";
  let familyBlocks: string[] = [];
  switch (family) {
    case "zone_reversal":
      familyBlocks = runZoneReversalRules(ctx);
      break;
    case "fvg_continuation":
      familyBlocks = runFvgContinuationRules(ctx);
      break;
    case "orb_breakout":
      familyBlocks = runOrbBreakoutRules(ctx);
      break;
    case "trend_pullback":
      familyBlocks = runTrendPullbackRules(ctx);
      break;
    case "indicator":
      familyBlocks = runIndicatorRules(ctx);
      break;
    case "liquidity_sweep":
      familyBlocks = runLiquiditySweepRules(ctx);
      break;
    default:
      familyBlocks = runUnknownRules(ctx);
      break;
  }

  return [...blocks, ...familyBlocks];
}