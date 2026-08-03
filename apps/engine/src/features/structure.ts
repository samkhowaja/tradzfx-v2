/**
 * Structure Detection v2.
 *
 * Detects BOS (Break of Structure), MSS (Market Structure Shift), CHoCH (Change of Character),
 * plus failure events (bos_failed / choch_failed) when a break is subsequently reversed.
 *
 * Enhancements over v1:
 *   - Confirmation tracking: a break is confirmed by a following close beyond the level
 *     or a volume spike > 1.5x the 20-bar average.
 *   - Strength grading by body% relative to ATR.
 *   - HTF alignment flag against features_htf_bias.
 *   - Failure events emitted when price closes back through the broken level.
 */

import type {
  Candle,
  FeatureDefinition,
  StructureOutput,
  StructureEvent,
  Direction,
  AtrOutput,
  HtfBiasOutput,
} from "@tm/shared";
import { sha256, computeStructureLifecycle } from "@tm/shared";
import { TF_MS } from "@tm/shared";
import type { PivotOutput } from "@tm/shared";
import { detectCausal, type CausalEvent, type CausalPivot } from "./causalPrototype";

export interface StructureInput {
  candles: Candle[];
  features_pivot: PivotOutput;
  features_atr: AtrOutput;
  features_htf_bias: HtfBiasOutput;
}

const CONFIRMATION_WINDOW_BARS = 5;

interface RawBreakEvent {
  eventType: "bos" | "choch" | "mss";
  direction: Direction;
  level: number;
  ts: Date;
  breakCandle: Candle;
  opposingSweepTs?: Date;
  availableAtTs: Date;
}

function findFirstCandle(
  candles: Candle[],
  startTs: Date,
  endTs: Date | undefined,
  predicate: (c: Candle) => boolean
): Candle | undefined {
  for (const c of candles) {
    if (c.ts.getTime() < startTs.getTime()) continue;
    if (endTs && c.ts.getTime() > endTs.getTime()) break;
    if (predicate(c)) return c;
  }
  return undefined;
}

function findFirstCandleAfter(
  candles: Candle[],
  afterTs: Date,
  predicate: (c: Candle) => boolean
): Candle | undefined {
  for (const c of candles) {
    if (c.ts.getTime() <= afterTs.getTime()) continue;
    if (predicate(c)) return c;
  }
  return undefined;
}

function getAtr14(atr: AtrOutput): number {
  return atr.values.find((v) => v.period === 14)?.value ?? 0;
}

function gradeStrength(bodySize: number, atr14: number): StructureEvent["strength"] {
  if (atr14 <= 0) return "medium";
  const ratio = bodySize / atr14;
  if (ratio >= 0.75) return "strong";
  if (ratio >= 0.35) return "medium";
  return "weak";
}

function bodySize(candle: Candle): number {
  return Math.abs(candle.c - candle.o);
}

function isHtfAligned(eventDirection: Direction, htf: HtfBiasOutput): boolean {
  if (htf.direction === "neutral") return false;
  return htf.direction === eventDirection;
}

export interface CausalStructureResult {
  events: CausalEvent[];
  pivots: CausalPivot[];
}

/**
 * Phase 3 adapter. Kept outside production path until parity review completes.
 * Converts engine feature contracts to deterministic causal prototype inputs.
 */
export function detectCausalStructure(
  input: StructureInput,
  context: { symbol?: string; tf: keyof typeof TF_MS; endTs: Date; trace?: Parameters<typeof detectCausal>[0]["trace"] }
): CausalStructureResult {
  const tfMs = TF_MS[context.tf];
  const pivots = input.features_pivot.pivots.map((pivot, index) => ({
    levelId: `${pivot.ts.getTime()}|${pivot.kind}|${pivot.price}|${index}`,
    kind: pivot.kind,
    price: pivot.price,
    centerTs: pivot.ts,
    availableAt: pivot.confirmationTs ?? pivot.ts,
    confirmationTs: pivot.confirmationTs,
  }));
  const candles = input.candles.map(({ ts, h, l, c }) => ({ ts, h, l, c }));
  return {
    pivots,
    events: detectCausal({
      symbol: context.symbol ?? input.candles[0]?.symbol ?? "unknown",
      tf: context.tf,
      tfMs,
      anchorTs: context.endTs,
      candles,
      pivots,
      trace: context.trace,
    }).events,
  };
}

/**
 * Opt-in production-shaped causal output. Default compute path stays legacy
 * until downstream parity and persistence review complete.
 */
export function detectCausalStructureOutput(
  input: StructureInput,
  context: { symbol?: string; tf: keyof typeof TF_MS; endTs: Date }
): StructureOutput {
  const result = detectCausalStructure(input, context);
  const candles = input.candles.filter((c) => c.ts.getTime() + TF_MS[context.tf] <= context.endTs.getTime());
  const atr14 = getAtr14(input.features_atr);
  const events = result.events.filter((event): event is CausalEvent & { eventType: "bos" | "choch" | "mss" } => event.eventType === "bos" || event.eventType === "choch" || event.eventType === "mss").map((event) => {
    const breakCandle = candles.find((c) => c.ts.getTime() === event.eventTs.getTime());
    if (!breakCandle) return undefined;
    return enrichEvent({
      eventType: event.eventType,
      direction: event.direction,
      level: event.level,
      ts: event.eventTs,
      breakCandle,
      availableAtTs: event.availableAt,
    }, candles, atr14, input.features_htf_bias);
  }).filter((event): event is StructureOutput["events"][number] => !!event);
  for (const event of events) {
    event.sourceLevelId = result.events.find((candidate) => candidate.eventTs.getTime() === event.ts.getTime() && candidate.level === event.level)?.levelId;
    const causal = result.events.find((candidate) => candidate.eventTs.getTime() === event.ts.getTime() && candidate.level === event.level);
    event.sourceLevelKind = causal?.sourceKind;
    event.sourceLevelConfirmationTs = causal?.sourceConfirmationTs;
    event.sweptLevelId = causal?.sweptLevelId;
    event.sweptLevelPrice = causal?.sweptLevel;
    event.sweptLevelKind = causal?.sweptKind;
    event.isCisd = false;
    const index = input.candles.findIndex((c) => c.ts.getTime() === event.ts.getTime());
    if (index >= 0) event.invalidatedAt = computeStructureLifecycle({ direction: event.direction, level: event.level }, input.candles, index).invalidatedAt;
  }
  return { events };
}

function enrichEvent(
  raw: RawBreakEvent,
  candles: Candle[],
  atr14: number,
  htf: HtfBiasOutput
): StructureEvent {
  // A break is confirmed by a following close beyond the broken level within
  // the confirmation window. Volume-spike confirmation has been removed.
  const confirmation = findFirstCandleAfter(candles, raw.ts, (c) => {
    if (raw.direction === "bullish" && c.c > raw.level) return true;
    if (raw.direction === "bearish" && c.c < raw.level) return true;
    return false;
  });

  const withinWindow = confirmation
    ? candles.filter((c) => c.ts.getTime() > raw.ts.getTime() && c.ts.getTime() <= confirmation.ts.getTime()).length <=
      CONFIRMATION_WINDOW_BARS
    : false;

  const confirmed = !!confirmation && withinWindow;
  const confirmationTs = confirmed ? confirmation.ts : undefined;

  const strength = gradeStrength(bodySize(raw.breakCandle), atr14);
  const htfAligned = isHtfAligned(raw.direction, htf);

  return {
    eventType: raw.eventType,
    direction: raw.direction,
    level: raw.level,
    ts: raw.ts,
    availableAtTs: raw.availableAtTs,
    strength,
    confirmed,
    confirmationTs,
    opposingSweepTs: raw.opposingSweepTs,
    htfAligned,
  };
}

function detectStructure(input: StructureInput, anchorTs: Date | undefined, tf: keyof typeof TF_MS): StructureOutput["events"] {
  const endTs = anchorTs ?? new Date(Math.max(...input.candles.map((c) => c.ts.getTime() + TF_MS[tf])));
  return detectCausalStructureOutput(input, { symbol: input.candles[0]?.symbol, tf, endTs }).events;
}

export const structureFeature: FeatureDefinition<StructureInput, StructureOutput> = {
  name: "features_structure",
  version: "2.2.0",
  dependencies: ["features_pivot", "features_atr", "features_htf_bias"],

  compute(input, context): StructureOutput {
    const tf = context?.tf as keyof typeof TF_MS | undefined;
    if (!tf) return { events: [] };
    const events = detectStructure(input, context?.endTs, tf);
    return { events };
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}:${c.v ?? 0}`)
        .join("|") +
        "|" +
        input.features_pivot.pivots
          .map((p) => `${p.ts.toISOString()}:${p.kind}:${p.price}`)
          .join("|") +
        "|" +
        input.features_atr.values.map((v) => `${v.period}=${v.value.toFixed(6)}`).join("|") +
        "|" +
        `${input.features_htf_bias.direction}:${input.features_htf_bias.confidence}:${input.features_htf_bias.score}`
    );
  },

  hashOutput(output): string {
    return sha256(
      output.events
        .map(
          (e) =>
            `${e.ts.toISOString()}:${e.eventType}:${e.direction}:${e.level}:` +
            `${e.availableAtTs?.toISOString() ?? ""}:` +
            `${e.strength ?? ""}:${e.confirmed ?? ""}:${e.confirmationTs?.toISOString() ?? ""}:` +
            `${e.htfAligned ?? ""}`
            + `:${e.sourceLevelId ?? ""}:${e.sourceLevelKind ?? ""}:${e.sourceLevelConfirmationTs?.toISOString() ?? ""}`
            + `:${e.sweptLevelId ?? ""}:${e.sweptLevelPrice ?? ""}:${e.sweptLevelKind ?? ""}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.events.map((e) => ({
      event_type: e.eventType,
      direction: e.direction,
      level: e.level,
      ts: e.ts,
      available_at_ts: e.availableAtTs ?? null,
      strength: e.strength ?? null,
      confirmed: e.confirmed ?? false,
      confirmation_ts: e.confirmationTs ?? null,
      opposing_sweep_ts: e.opposingSweepTs ?? null,
      is_cisd: e.isCisd ?? false,
      htf_aligned: e.htfAligned ?? false,
      source_level_id: e.sourceLevelId ?? null,
      source_level_kind: e.sourceLevelKind ?? null,
      source_level_confirmation_ts: e.sourceLevelConfirmationTs ?? null,
      swept_level_id: e.sweptLevelId ?? null,
      swept_level_price: e.sweptLevelPrice ?? null,
      swept_level_kind: e.sweptLevelKind ?? null,
    }));
  },

  deserialize(rows): StructureOutput {
    return {
      events: rows.map((r) => ({
        eventType: r.event_type as StructureEvent["eventType"],
        direction: r.direction as Direction,
        level: r.level as number,
        ts: new Date(r.ts as string),
        availableAtTs: r.available_at_ts ? new Date(r.available_at_ts as string) : undefined,
        strength: (r.strength as StructureEvent["strength"]) ?? undefined,
        confirmed: (r.confirmed as boolean) ?? undefined,
        confirmationTs: r.confirmation_ts ? new Date(r.confirmation_ts as string) : undefined,
        opposingSweepTs: r.opposing_sweep_ts ? new Date(r.opposing_sweep_ts as string) : undefined,
        isCisd: (r.is_cisd as boolean) ?? undefined,
        htfAligned: (r.htf_aligned as boolean) ?? undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at as string) : undefined,
        sourceLevelId: r.source_level_id ? r.source_level_id as string : undefined,
        sourceLevelKind: r.source_level_kind ? r.source_level_kind as "high" | "low" : undefined,
        sourceLevelConfirmationTs: r.source_level_confirmation_ts ? new Date(r.source_level_confirmation_ts as string) : undefined,
        sweptLevelId: r.swept_level_id ? r.swept_level_id as string : undefined,
        sweptLevelPrice: r.swept_level_price == null ? undefined : r.swept_level_price as number,
        sweptLevelKind: r.swept_level_kind ? r.swept_level_kind as "high" | "low" : undefined,
      })),
    };
  },
};
