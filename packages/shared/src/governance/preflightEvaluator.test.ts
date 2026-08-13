import { describe, expect, it } from "vitest";
import { buildPreflightEnvelope, evaluatePreflight, type CandidateContext, type PreflightChecks } from "./preflightEvaluator";

const candidate: CandidateContext = {
  strategyId: "watukushay_no1", symbol: "XAUUSD", timeframe: "1m",
  fromTs: "2026-07-19T00:00:00Z", toTs: "2026-07-23T00:00:00Z",
};
const pass = () => ({ ok: true });
const checks = (): PreflightChecks => ({
  canonical: pass(), trustedPrehistory: pass(), warmup: pass(), featureLineage: pass(),
  dxy: pass(), setupLineage: pass(), parity: pass(),
});

describe("preflight evaluator", () => {
  it("returns readonly eligibility only when every check passes", () => {
    const result = evaluatePreflight(candidate, checks());
    expect(result.verdict).toBe("PROMOTION_ELIGIBLE_READONLY");
    expect(result.blockers).toHaveLength(0);
  });

  it("keeps all blockers and preserves precedence", () => {
    const input = checks();
    input.canonical = { ok: false, reason: "gap", evidence: { symbol: "XAUUSD" } };
    input.warmup = { ok: false };
    input.dxy = { ok: false };
    const result = evaluatePreflight(candidate, input);
    expect(result.verdict).toBe("PROMOTION_FORBIDDEN");
    expect(result.blockers.map((item) => item.code)).toEqual([
      "BLOCKED_CANONICAL_GAP", "BLOCKED_WARMUP", "BLOCKED_DXY_POLICY",
    ]);
  });

  it("builds deterministic schema v1 envelope with derived blocked verdict", () => {
    const result = evaluatePreflight(candidate, checks());
    const envelope = buildPreflightEnvelope(result, "2026-08-12T00:00:00.000Z");
    expect(envelope.schema).toBe("tradzfx.preflight-result");
    expect(envelope.schemaVersion).toBe("1.0.0");
    expect(envelope.mode).toBe("READ_ONLY_PREFLIGHT");
    expect(envelope.checks.map((check) => check.id)).toEqual([
      "canonical", "trustedWindow", "prehistory", "warmup", "featureLineage",
      "dxy", "setupLineage", "parity",
    ]);
    expect(envelope.verdict).toMatchObject({ status: "READY", ready: true, blockingCheckIds: [] });
    expect(envelope.overallStatus).toBe("PASS");
  });

  it("preserves FAIL over BLOCKED_UNKNOWN and NOT_RUN", () => {
    const input = checks();
    input.canonical = { ok: false, status: "FAIL" };
    input.warmup = { ok: false, status: "BLOCKED_UNKNOWN" };
    input.parity = { ok: false, status: "NOT_RUN" };
    const envelope = buildPreflightEnvelope(evaluatePreflight(candidate, input));
    expect(envelope.checks.find((check) => check.id === "canonical")?.status).toBe("FAIL");
    expect(envelope.overallStatus).toBe("FAIL");
  });

  it("never treats NOT_RUN as PASS", () => {
    const input = checks();
    input.parity = { ok: false, status: "NOT_RUN" };
    const envelope = buildPreflightEnvelope(evaluatePreflight(candidate, input));
    expect(envelope.checks.find((check) => check.id === "parity")?.status).toBe("NOT_RUN");
    expect(envelope.overallStatus).toBe("NOT_RUN");
  });
});