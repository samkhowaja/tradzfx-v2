import { describe, expect, it } from "vitest";
import { evaluateCertificationPolicy } from "./certificationDsl";

describe("certification policy", () => {
  it("requires clean observations for certification", () => {
    const result = evaluateCertificationPolicy({
      version: "v1", minimumCleanDays: 2,
      requiredRules: [{ id: "canonical", required: true, blocksOn: ["BLOCKED_CANONICAL_GAP"] }],
    }, [
      { date: "2026-08-10", blockers: [] },
      { date: "2026-08-11", blockers: [] },
    ]);
    expect(result).toMatchObject({ certified: true, state: "CERTIFIED" });
  });

  it("reports failed rules and blocker codes", () => {
    const result = evaluateCertificationPolicy({
      version: "v1", requiredRules: [{ id: "canonical", required: true, blocksOn: ["BLOCKED_CANONICAL_GAP"] }],
    }, [{ date: "2026-08-11", blockers: ["BLOCKED_CANONICAL_GAP"] }]);
    expect(result).toMatchObject({ certified: false, state: "CERTIFICATION_BLOCKED", failedRules: ["canonical"] });
  });
});