import { describe, expect, it } from "vitest";
import { buildPreflightHistoryRecord, canonicalizePreflightEvidence, hashPreflightEvidence } from "./preflightEvidence";
import { buildPreflightEnvelope, evaluatePreflight } from "./preflightEvaluator";

const envelope = buildPreflightEnvelope(evaluatePreflight({ strategyId: "s", symbol: "XAUUSD", timeframe: "1m", fromTs: "2026-08-11T00:00:00.000Z", toTs: "2026-08-12T00:00:00.000Z" }, {
  canonical: { ok: true }, trustedPrehistory: { ok: true }, warmup: { ok: false }, featureLineage: { ok: true }, dxy: { ok: false }, setupLineage: { ok: true }, parity: { ok: false },
}), "2026-08-12T00:00:00.000Z");

describe("preflight evidence", () => {
  it("excludes generatedAt from stable evidence hash", () => {
    const changed = { ...envelope, generatedAt: "2026-09-01T00:00:00.000Z" };
    expect(hashPreflightEvidence(envelope)).toBe(hashPreflightEvidence(changed));
  });
  it("sorts object keys and creates versioned records", () => {
    expect(canonicalizePreflightEvidence(envelope).indexOf('"candidate"')).toBeGreaterThan(-1);
    expect(buildPreflightHistoryRecord(envelope).evidenceVersion).toBe("preflight-evidence-v1");
  });
});