/**
 * Order Block feature.
 *
 * Detects bullish/bearish order blocks as the last opposing candle before a
 * displacement move that causes a structure break (BOS / MSS). The block extends
 * to the right until price mitigates it (first touch) or violates it (close
 * beyond the far side).
 */

import type { Candle, FeatureDefinition, OrderBlockOutput, Direction } from "@tm/shared";
import { sha256, computeZoneLifecycle } from "@tm/shared";
import type { StructureOutput } from "@tm/shared";

export interface OrderBlockInput {
  candles: Candle[];
  features_structure: StructureOutput;
}

function findOrderBlockCandle(
  candles: Candle[],
  eventTs: Date,
  direction: Direction,
  maxLookbackBars = 15
): { candle: Candle; index: number } | undefined {
  const eventIndex = candles.findIndex((c) => c.ts.getTime() === eventTs.getTime());
  if (eventIndex < 0) return undefined;

  const start = Math.max(0, eventIndex - maxLookbackBars);

  // Look for the last opposing candle before the break.
  // Bullish move -> last bearish candle; bearish move -> last bullish candle.
  for (let i = eventIndex - 1; i >= start; i--) {
    const c = candles[i];
    const bullish = c.c > c.o;
    const bearish = c.c < c.o;

    if (direction === "bullish" && bearish) {
      return { candle: c, index: i };
    }
    if (direction === "bearish" && bullish) {
      return { candle: c, index: i };
    }
  }

  return undefined;
}

function computeOrderBlockLifecycle(
  ob: OrderBlockOutput["orderBlocks"][number],
  candles: Candle[],
  fromIndex: number
): { firstTouchAt?: Date; mitigatedAt?: Date; invalidatedAt?: Date; fillPct?: number } {
  return computeZoneLifecycle(
    {
      zoneKind: ob.obKind === "bullish" ? "demand" : "supply",
      top: ob.top,
      bottom: ob.bottom,
      ts: ob.ts,
      direction: ob.obKind,
    },
    candles,
    fromIndex
  );
}

function detectOrderBlocks(
  candles: Candle[],
  structure: StructureOutput["events"]
): OrderBlockOutput["orderBlocks"] {
  const orderBlocks: OrderBlockOutput["orderBlocks"] = [];
  if (candles.length < 5) return orderBlocks;

  // Keep one OB per direction per approximate time to avoid duplicates.
  const seen = new Set<string>();

  for (const event of structure) {
    if (event.eventType !== "bos" && event.eventType !== "mss") continue;

    const direction: Direction =
      event.direction === "bullish" || event.direction === "bearish"
        ? event.direction
        : "bullish";

    const forming = findOrderBlockCandle(candles, event.ts, direction);
    if (!forming) continue;

    const { candle, index } = forming;
    const key = `${candle.ts.toISOString()}_${direction}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const top = candle.h;
    const bottom = candle.l;

    const ob: OrderBlockOutput["orderBlocks"][number] = {
      obKind: direction,
      degree: "swing",
      top,
      bottom,
      ts: candle.ts,
      formationTs: candle.ts,
      ageBars: candles.length - index,
      isFresh: true,
      strengthScore: 0.5,
    };

    const lifecycle = computeOrderBlockLifecycle(ob, candles, index);
    ob.firstTouchAt = lifecycle.firstTouchAt;
    ob.mitigatedAt = lifecycle.mitigatedAt;
    ob.invalidatedAt = lifecycle.invalidatedAt;
    ob.fillPct = lifecycle.fillPct ?? 0;
    ob.isFresh = !lifecycle.invalidatedAt;

    // Strength: body/range of the opposing candle + recency + freshness.
    const range = top - bottom;
    const body = Math.abs(candle.c - candle.o);
    const bodyStrength = range > 0 ? body / range : 0.5;
    const ageFactor = Math.max(0, 1 - (ob.ageBars ?? 0) / 50);
    const freshFactor = ob.isFresh ? 1 : 0.3;
    ob.strengthScore = Math.min(1, bodyStrength * 0.5 + ageFactor * 0.2 + freshFactor * 0.3);

    orderBlocks.push(ob);
  }

  return orderBlocks;
}

export const orderBlockFeature: FeatureDefinition<OrderBlockInput, OrderBlockOutput> = {
  name: "features_order_block",
  version: "1.1.0",
  dependencies: ["features_structure"],

  compute(input): OrderBlockOutput {
    return { orderBlocks: detectOrderBlocks(input.candles, input.features_structure.events) };
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|") +
        "|" +
        input.features_structure.events
          .map((e) => `${e.ts.toISOString()}:${e.eventType}:${e.direction}:${e.level}`)
          .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.orderBlocks
        .map(
          (ob) =>
            `${ob.ts.toISOString()}:${ob.obKind}:${ob.top}:${ob.bottom}:${ob.firstTouchAt?.toISOString() ?? ""}:${ob.mitigatedAt?.toISOString() ?? ""}:${ob.invalidatedAt?.toISOString() ?? ""}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.orderBlocks.map((ob) => ({
      ob_kind: ob.obKind,
      degree: ob.degree,
      top: ob.top,
      bottom: ob.bottom,
      formation_ts: ob.formationTs ?? null,
      age_bars: ob.ageBars ?? null,
      is_fresh: ob.isFresh ?? true,
      strength_score: ob.strengthScore ?? null,
      fill_pct: ob.fillPct ?? 0,
      ts: ob.ts,
      first_touch_at: ob.firstTouchAt ?? null,
      mitigated_at: ob.mitigatedAt ?? null,
      invalidated_at: ob.invalidatedAt ?? null,
    }));
  },

  deserialize(rows): OrderBlockOutput {
    return {
      orderBlocks: rows.map((r) => ({
        obKind: r.ob_kind as "bullish" | "bearish",
        degree: (r.degree as "internal" | "swing") ?? "swing",
        top: r.top as number,
        bottom: r.bottom as number,
        formationTs: r.formation_ts ? new Date(r.formation_ts as string) : undefined,
        ts: new Date(r.ts as string),
        ageBars: r.age_bars as number | undefined,
        isFresh: r.is_fresh as boolean | undefined,
        strengthScore: r.strength_score as number | undefined,
        fillPct: r.fill_pct as number | undefined,
        firstTouchAt: r.first_touch_at ? new Date(r.first_touch_at as string) : undefined,
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at as string) : undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at as string) : undefined,
      })),
    };
  },
};
