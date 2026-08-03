import { describe, expect, it } from "vitest";
import {
  classifyReadiness,
  READINESS_BLOCKING_VERDICTS,
  READINESS_DEGRADED_VERDICTS,
  readinessSeverity,
  summarizeReadiness,
  type ReadinessEvidence,
} from "./verdict";

const base: ReadinessEvidence = {
  tableExists: true,
  missingColumns: [],
  semanticType: "state",
  rowCount: 100,
  lifecycleAgeHours: null,
  lifecycleMaxAgeHours: 2,
  latestAgeHours: 0,
  maxFreshnessMinutes: 20,
  producerLagHours: 0,
  producerAgeHours: 0,
  producerMaxAgeHours: 2,
};

describe("classifyReadiness", () => {
  it("orders structural and coverage failures before freshness", () => {
    expect(classifyReadiness({ ...base, tableExists: false })).toBe("MISSING_TABLE");
    expect(classifyReadiness({ ...base, missingColumns: ["ts"] })).toBe("CONTRACT_MISMATCH");
    expect(classifyReadiness({ ...base, rowCount: 0 })).toBe("EMPTY_DENSE");
  });

  it("degrades empty sparse events", () => {
    expect(classifyReadiness({ ...base, semanticType: "event", rowCount: 0 })).toBe(
      "SPARSE_EVENT_EMPTY"
    );
  });

  it("blocks lifecycle, state, and producer staleness", () => {
    expect(classifyReadiness({ ...base, lifecycleAgeHours: 3 })).toBe("BLOCKED_LIFECYCLE");
    expect(classifyReadiness({ ...base, latestAgeHours: 21 / 60 })).toBe("STALE_STATE");
    expect(classifyReadiness({ ...base, producerLagHours: 3 })).toBe("PRODUCER_STALE");
    expect(classifyReadiness({ ...base, producerSucceeded: false })).toBe("PRODUCER_STALE");
  });

  it("blocks missing or mismatched required engine versions", () => {
    expect(
      classifyReadiness({ ...base, expectedEngineVersion: "2.2.0", observedEngineVersions: ["2.1.0"] })
    ).toBe("BLOCKED_VERSION");
    expect(
      classifyReadiness({ ...base, expectedEngineVersion: "2.2.0", observedEngineVersions: ["2.2.0"] })
    ).toBe("READY");
  });

  it("uses producer age only when source-edge lag is unavailable", () => {
    expect(
      classifyReadiness({ ...base, producerLagHours: null, producerAgeHours: 3 })
    ).toBe("PRODUCER_STALE");
    expect(
      classifyReadiness({ ...base, producerLagHours: 0, producerAgeHours: 3 })
    ).toBe("READY");
  });

  it("returns semantic ready verdicts", () => {
    expect(classifyReadiness(base)).toBe("READY");
    expect(classifyReadiness({ ...base, semanticType: "event" })).toBe("READY_EVENT");
    expect(classifyReadiness({ ...base, semanticType: "level" })).toBe("READY_LEVEL");
  });
});

describe("readinessSeverity", () => {
  it("classifies every exported policy verdict", () => {
    for (const verdict of READINESS_BLOCKING_VERDICTS) {
      expect(readinessSeverity(verdict)).toBe("blocked");
    }
    for (const verdict of READINESS_DEGRADED_VERDICTS) {
      expect(readinessSeverity(verdict)).toBe("degraded");
    }
  });

  it("aggregates READY, DEGRADED, and BLOCKED with worst status winning", () => {
    expect(summarizeReadiness(["READY", "READY_LEVEL"]).status).toBe("READY");
    expect(summarizeReadiness(["READY", "SPARSE_EVENT_EMPTY"]).status).toBe("DEGRADED");
    expect(summarizeReadiness(["SPARSE_EVENT_EMPTY", "STALE_STATE"]).status).toBe("BLOCKED");
  });
});
