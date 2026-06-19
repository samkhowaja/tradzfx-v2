import { describe, it, expect } from "vitest";
import { htfBiasFeature } from "./htfBias";

function mockPool(
  resolver: (table: "ob" | "structure", tf: string) => any[]
) {
  return {
    query: async (sql: string, params: any[]) => {
      const table = sql.includes("features_order_block")
        ? "ob"
        : sql.includes("features_structure")
        ? "structure"
        : "unknown";
      const tf = params[1] as string;
      return { rows: resolver(table as "ob" | "structure", tf) };
    },
  };
}

describe("htfBiasFeature", () => {
  it("returns READY bullish when 1D OB and 4H structure align", async () => {
    const pool = mockPool((table, tf) => {
      if (table === "ob" && tf === "1d") return [{ ob_kind: "bullish" }];
      if (table === "structure" && tf === "4h") return [{ direction: "bullish", event_type: "bos" }];
      return [];
    });

    const output = await htfBiasFeature.compute({}, {
      tf: "15m",
      pool: pool as any,
      symbol: "XAUUSD",
      endTs: new Date(),
    });

    expect(output.direction).toBe("bullish");
    expect(output.state).toBe("READY");
    expect(output.confidence).toBe(90);
    expect(output.score).toBe(5.0);
  });

  it("returns bearish SOFT_WARN with 4H bearish OB offset by 1H bullish structure", async () => {
    const pool = mockPool((table, tf) => {
      if (table === "ob" && tf === "4h") return [{ ob_kind: "bearish" }];
      if (table === "structure" && tf === "1h") return [{ direction: "bullish", event_type: "bos" }];
      return [];
    });

    const output = await htfBiasFeature.compute({}, {
      tf: "15m",
      pool: pool as any,
      symbol: "XAUUSD",
      endTs: new Date(),
    });

    expect(output.direction).toBe("bearish");
    expect(output.state).toBe("SOFT_WARN");
    expect(output.confidence).toBe(70);
    expect(output.score).toBe(-1.0);
  });

  it("returns BLOCK when no fresh HTF context exists", async () => {
    const pool = mockPool(() => []);

    const output = await htfBiasFeature.compute({}, {
      tf: "15m",
      pool: pool as any,
      symbol: "XAUUSD",
      endTs: new Date(),
    });

    expect(output.direction).toBe("neutral");
    expect(output.state).toBe("BLOCK");
    expect(output.confidence).toBe(0);
  });

  it("only considers TFs at or above the feature tf", async () => {
    const seenTfs: string[] = [];
    const pool = mockPool((table, tf) => {
      seenTfs.push(tf);
      if (table === "ob" && tf === "1d") return [{ ob_kind: "bullish" }];
      return [];
    });

    await htfBiasFeature.compute({}, {
      tf: "1h",
      pool: pool as any,
      symbol: "XAUUSD",
      endTs: new Date(),
    });

    expect(seenTfs).toContain("1d");
    expect(seenTfs).toContain("4h");
    expect(seenTfs).toContain("1h");
    expect(seenTfs).not.toContain("15m");
  });
});
