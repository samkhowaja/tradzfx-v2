import { describe, expect, it } from "vitest";
import type { StrategySpec } from "@tm/shared";
import { resolveReadinessRequirements } from "./readinessRequirements";

function spec(): StrategySpec {
  return {
    id: "readiness_test",
    name: "Readiness test",
    version: "1",
    signalSource: "generic",
    filters: { symbols: ["XAUUSD"] },
    setup: [
      {
        id: "zone",
        feature: "features_zone",
        tf: "15m",
        predicate: "direction = 'bullish'",
        required: true,
      },
    ],
    entry: [
      {
        id: "structure",
        feature: "features_structure",
        tf: "5m",
        predicate: "direction = 'bullish'",
        required: true,
      },
    ],
    risk: { sl: "atr(1h) * 1.2", tp: "sl * 2", minRR: 2, timeoutBars: 8 },
    gates: [],
  };
}

describe("resolveReadinessRequirements", () => {
  it("resolves explicit, gate-core, and risk dependencies into canonical cells", () => {
    const cells = resolveReadinessRequirements(spec());
    const keys = cells.map((cell) => `${cell.feature}@${cell.tf}`);

    expect(keys).toEqual([
      "features_atr@15m",
      "features_atr@1h",
      "features_session@1m",
      "features_spread@1m",
      "features_structure@5m",
      "features_zone@15m",
    ]);
  });

  it("carries semantic, producer, version, and lifecycle ownership evidence", () => {
    const cells = resolveReadinessRequirements(spec());
    const zone = cells.find((cell) => cell.feature === "features_zone");
    const structure = cells.find((cell) => cell.feature === "features_structure");

    expect(zone).toMatchObject({
      semanticType: "level",
      joinPolicy: "active_window",
      producer: "engine",
      engineVersion: "2.2.0",
      lifecycleOwned: true,
    });
    expect(structure).toMatchObject({
      semanticType: "event",
      engineVersion: "2.1.0",
      lifecycleOwned: false,
    });
  });

  it("includes progressive steps in readiness requirements", () => {
    const progressive = spec();
    progressive.setup = undefined;
    progressive.steps = [
      {
        id: "zone",
        feature: "features_zone",
        tf: "15m",
        predicate: "direction = 'bullish'",
        required: true,
      },
    ];

    expect(resolveReadinessRequirements(progressive).map((cell) => `${cell.feature}@${cell.tf}`))
      .toContain("features_zone@15m");
  });
});
