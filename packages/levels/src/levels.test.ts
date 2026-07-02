import { describe, it, expect } from "vitest";
import type { MarketLevel } from "./types.js";

describe("@tm/levels types", () => {
  it("exposes canonical level types", () => {
    const level: MarketLevel = {
      id: "test",
      symbol: "EURUSD",
      tf: "15m",
      level_type: "zone",
      kind: "demand",
      top: 1.1000,
      bottom: 1.0990,
      strength: 0.85,
      invalidated_at: null,
      tapped_at: null,
      touch_count: 0,
      source_id: null,
      source_json: null,
      ts: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    };
    expect(level.kind).toBe("demand");
  });
});
