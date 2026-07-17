import { describe, expect, it } from "vitest";
import { evaluateProducerInvariant, getProducerOutputMode } from "./producerInvariant";

const source = new Date("2026-07-17T10:00:00.000Z");

describe("producer output invariants", () => {
  it("requires dense output to reach source anchor", () => {
    expect(evaluateProducerInvariant({ mode: "dense", sourceMaxTs: source, outputMaxTs: null, executionSucceeded: true })).toEqual({
      passed: false,
      reason: "output_anchor_missing",
    });
    expect(evaluateProducerInvariant({
      mode: "dense",
      sourceMaxTs: source,
      outputMaxTs: new Date("2026-07-17T09:55:00.000Z"),
      executionSucceeded: true,
    }).reason).toBe("output_anchor_stale");
  });

  it("accepts dense output at source anchor", () => {
    expect(evaluateProducerInvariant({ mode: "dense", sourceMaxTs: source, outputMaxTs: source, executionSucceeded: true }).passed).toBe(true);
  });

  it("accepts sparse zero-output execution", () => {
    expect(evaluateProducerInvariant({ mode: "sparse", sourceMaxTs: source, outputMaxTs: null, executionSucceeded: true }).passed).toBe(true);
  });

  it("accepts session-scoped zero output before range completion", () => {
    expect(evaluateProducerInvariant({ mode: "session_scoped", sourceMaxTs: source, outputMaxTs: null, executionSucceeded: true }).passed).toBe(true);
  });

  it("rejects every mode when source coverage is missing", () => {
    expect(evaluateProducerInvariant({ mode: "sparse", sourceMaxTs: null, outputMaxTs: null, executionSucceeded: true }).reason).toBe("source_anchor_missing");
  });

  it("classifies known dense, sparse, and session-scoped features", () => {
    expect(getProducerOutputMode("features_sweep")).toBe("sparse");
    expect(getProducerOutputMode("features_pivot")).toBe("sparse");
    expect(getProducerOutputMode("features_opening_range")).toBe("session_scoped");
    expect(getProducerOutputMode("features_session_hl")).toBe("dense");
    expect(getProducerOutputMode("features_displacement")).toBe("dense");
    expect(getProducerOutputMode("features_atr")).toBe("dense");
  });

  it("fails closed when a producer has no timestamp contract", () => {
    expect(() => getProducerOutputMode("features_unregistered")).toThrow(
      "Missing producer output-mode contract: features_unregistered"
    );
  });
});
