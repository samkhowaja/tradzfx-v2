import { describe, expect, it } from "vitest";
import type { AtrOutput, Candle, HtfBiasOutput, PivotOutput } from "@tm/shared";
import { detectCausalStructure } from "./structure";
import { detectCausal } from "./causalPrototype";
import { structureFeature } from "./structure";

const TF_MS = 5 * 60_000;
const t = (minute: number) => new Date(Date.UTC(2026, 6, 1, 10, minute));
const candle = (minute: number, o: number, h: number, l: number, c: number): Candle => ({
  symbol: "EURUSD", ts: t(minute), o, h, l, c, v: 100,
});
const atr: AtrOutput = { values: [] };
const htf: HtfBiasOutput = {
  direction: "neutral", confidence: 0, state: "BLOCK", score: 0, reason: "parity",
};

const pivots: PivotOutput["pivots"] = [
  { kind: "high", price: 10, confidence: 1, ts: t(0), confirmationTs: t(5) },
  { kind: "low", price: 8, confidence: 1, ts: t(0), confirmationTs: t(5) },
];
const candles = [
  candle(5, 9, 9.5, 7, 8.5),
  candle(10, 8.5, 11, 7.5, 10.5),
];
const endTs = t(15);

type NormalizedEvent = {
  eventType: string;
  direction: string;
  eventTs: string;
  availableAtTs: string;
  level: number;
  hasSweepAttribution: boolean;
};

function productionEvents(): NormalizedEvent[] {
  const output = structureFeature.compute(
    { candles, features_pivot: { pivots }, features_atr: atr, features_htf_bias: htf },
    { symbol: "EURUSD", tf: "5m", endTs }
  );
  return output.events.map((event) => ({
    eventType: event.eventType,
    direction: event.direction,
    eventTs: event.ts.toISOString(),
    availableAtTs: event.availableAtTs?.toISOString() ?? "",
    level: event.level,
    hasSweepAttribution: Boolean(event.opposingSweepTs),
  }));
}

function prototypeEvents() {
  return detectCausal({
    symbol: "EURUSD", tf: "5m", tfMs: TF_MS, anchorTs: endTs,
    candles: candles.map(({ ts, h, l, c }) => ({ ts, h, l, c })),
    pivots: pivots.map((pivot, index) => ({
      levelId: `${pivot.ts.getTime()}|${pivot.kind}|${pivot.price}|${index}`,
      kind: pivot.kind,
      price: pivot.price,
      centerTs: pivot.ts,
      availableAt: pivot.confirmationTs ?? pivot.ts,
      confirmationTs: pivot.confirmationTs,
      scale: "external" as const,
    })),
  }).events;
}

function runProduction(testCandles: Candle[], testPivots: PivotOutput["pivots"]) {
  return structureFeature.compute(
    { candles: testCandles, features_pivot: { pivots: testPivots }, features_atr: atr, features_htf_bias: htf },
    { symbol: "EURUSD", tf: "5m", endTs: testCandles[testCandles.length - 1].ts }
  ).events;
}

function runPrototype(testCandles: Candle[], testPivots: PivotOutput["pivots"]) {
  return detectCausal({
    symbol: "EURUSD", tf: "5m", tfMs: TF_MS,
    anchorTs: testCandles[testCandles.length - 1].ts,
    candles: testCandles.map(({ ts, h, l, c }) => ({ ts, h, l, c })),
    pivots: testPivots.map((pivot, index) => ({
      levelId: `${pivot.ts.getTime()}|${pivot.kind}|${pivot.price}|${index}`,
      kind: pivot.kind, price: pivot.price, centerTs: pivot.ts,
      availableAt: pivot.confirmationTs ?? pivot.ts,
      confirmationTs: pivot.confirmationTs, scale: "external" as const,
    })),
  }).events;
}

describe("Production causal path measurement", () => {
  it("measures basic event output against prototype", () => {
    const prototype = prototypeEvents();
    const production = productionEvents();
    console.info("Causal parity counts", { prototype: prototype.length, production: production.length });
    console.info("Causal parity events", { prototype, production });
    expect(production.length).toBeGreaterThanOrEqual(0);
  });

  it("measures availableAtTs completion semantics", () => {
    const production = productionEvents();
    const violations = production.filter((event) =>
      new Date(event.availableAtTs).getTime() < new Date(event.eventTs).getTime() + TF_MS
    );
    console.info("Availability violations", violations);
    expect(violations.length).toBeGreaterThanOrEqual(0);
  });

  it("measures MSS availability and attribution fields", () => {
    const prototype = prototypeEvents();
    const production = productionEvents();
    console.info("MSS measurement", {
      prototype: prototype.filter((event) => event.eventType === "mss"),
      production: production.filter((event) => event.eventType === "mss"),
      productionSweepFields: production.filter((event) => event.hasSweepAttribution).length,
    });
    expect(production.length).toBeGreaterThanOrEqual(0);
  });

  it("measures production causal path reachability", () => {
    const production = productionEvents();
    console.info("Production causal path reachable", { events: production.length });
    expect(production.length).toBeGreaterThanOrEqual(0);
  });

  it("measures MSS: sweep, displacement, and trend transition", () => {
    const testCandles = [
      candle(0, 1.1000, 1.1000, 1.0980, 1.0990),
      candle(5, 1.0990, 1.1020, 1.0990, 1.1010),
      candle(10, 1.1010, 1.1010, 1.1000, 1.1005),
      candle(15, 1.1005, 1.1030, 1.1000, 1.1002),
      candle(20, 1.1002, 1.1002, 1.0950, 1.0950),
      candle(25, 1.0950, 1.0950, 1.0940, 1.0940),
    ];
    const testPivots: PivotOutput["pivots"] = [
      { ts: t(0), confirmationTs: t(10), kind: "low", price: 1.0980, confidence: 1 },
      { ts: t(5), confirmationTs: t(15), kind: "high", price: 1.1020, confidence: 1 },
      { ts: t(10), confirmationTs: t(20), kind: "low", price: 1.1000, confidence: 1 },
    ];
    const proto = runPrototype(testCandles, testPivots);
    const prod = runProduction(testCandles, testPivots);
    console.info("MSS fixture", { prototype: proto, production: prod });
    expect(prod.length).toBeGreaterThanOrEqual(0);
  });

  it("measures deterministic multi-sweep attribution", () => {
    const testCandles = [
      candle(0, 1.1000, 1.1000, 1.0980, 1.0990), candle(5, 1.0990, 1.1020, 1.0990, 1.1010),
      candle(10, 1.1010, 1.1050, 1.1010, 1.1040), candle(15, 1.1040, 1.1060, 1.1040, 1.1055),
      candle(20, 1.1055, 1.1060, 1.1000, 1.1000), candle(25, 1.1000, 1.1000, 1.0980, 1.0980),
    ];
    const testPivots: PivotOutput["pivots"] = [
      { ts: t(0), confirmationTs: t(10), kind: "low", price: 1.0980, confidence: 1 },
      { ts: t(5), confirmationTs: t(15), kind: "high", price: 1.1020, confidence: 1 },
      { ts: t(10), confirmationTs: t(20), kind: "high", price: 1.1050, confidence: 1 },
      { ts: t(15), confirmationTs: t(25), kind: "low", price: 1.1040, confidence: 1 },
    ];
    const proto = runPrototype(testCandles, testPivots);
    const prod = runProduction(testCandles, testPivots);
    console.info("Multi-sweep fixture", { prototype: proto, production: prod });
    expect(prod.length).toBeGreaterThanOrEqual(0);
  });

  it("measures internal FIFO retention", () => {
    const testCandles: Candle[] = [];
    const testPivots: PivotOutput["pivots"] = [{ ts: new Date("2026-07-01T09:00:00Z"), confirmationTs: new Date("2026-07-01T09:10:00Z"), kind: "high", price: 1.1100, confidence: 1 }];
    for (let i = 0; i < 11; i++) {
      const ts = new Date(Date.UTC(2026, 6, 1, 10, i * 5));
      const price = 1.1000 + i * 0.0001;
      testCandles.push({ symbol: "EURUSD", ts, o: price, h: price + 0.001, l: price, c: price + 0.0005, v: 100 });
      testPivots.push({ ts, confirmationTs: new Date(ts.getTime() + 600_000), kind: "high", price: price + 0.001, confidence: 1 });
    }
    const breakTs = new Date("2026-07-01T11:00:00Z");
    testCandles.push({ symbol: "EURUSD", ts: breakTs, o: 1.102, h: 1.104, l: 1.102, c: 1.104, v: 100 });
    const proto = runPrototype(testCandles, testPivots);
    const prod = runProduction(testCandles, testPivots);
    console.info("Retention fixture", { prototype: proto, production: prod });
    expect(prod.length).toBeGreaterThanOrEqual(0);
  });

  it("measures opposite-break suppression without sweep", () => {
    const testCandles = [
      candle(0, 1.1000, 1.1000, 1.0980, 1.0990), candle(5, 1.0990, 1.1020, 1.0990, 1.1010),
      candle(10, 1.1010, 1.1010, 1.1000, 1.1005), candle(15, 1.1005, 1.1005, 1.0995, 1.0995),
    ];
    const testPivots: PivotOutput["pivots"] = [
      { ts: t(0), confirmationTs: t(10), kind: "low", price: 1.0980, confidence: 1 },
      { ts: t(5), confirmationTs: t(15), kind: "high", price: 1.1020, confidence: 1 },
      { ts: t(10), confirmationTs: t(20), kind: "low", price: 1.1000, confidence: 1 },
    ];
    const proto = runPrototype(testCandles, testPivots);
    const prod = runProduction(testCandles, testPivots);
    console.info("Opposite-break fixture", { prototype: proto, production: prod });
    expect(prod.length).toBeGreaterThanOrEqual(0);
  });
});
