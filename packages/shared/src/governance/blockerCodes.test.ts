import { describe, expect, it } from "vitest";
import {
  canonicalGapBlock,
  candleEligibilityBlock,
  dxyPolicyBlock,
  featureLineageBlock,
  parityUnverifiedBlock,
  setupCacheLineageBlock,
  trustedPrehistoryBlock,
  unknownLegacyBlock,
  warmupBlock,
} from "./blockerCodes";

describe("governance blocker taxonomy", () => {
  it("creates typed blockers with shared evidence", () => {
    const evidence = { symbol: "XAUUSD", details: { source: "test" } };
    const blockers = [
      canonicalGapBlock(evidence), trustedPrehistoryBlock(evidence),
      featureLineageBlock(evidence), dxyPolicyBlock(evidence),
      setupCacheLineageBlock(evidence), warmupBlock(evidence),
      parityUnverifiedBlock(evidence), candleEligibilityBlock(evidence),
      unknownLegacyBlock("legacy", evidence),
    ];
    expect(blockers.map((item) => item.code)).toEqual([
      "BLOCKED_CANONICAL_GAP", "BLOCKED_TRUSTED_PREHISTORY",
      "BLOCKED_FEATURE_LINEAGE", "BLOCKED_DXY_POLICY",
      "BLOCKED_SETUP_CACHE_LINEAGE", "BLOCKED_WARMUP",
      "BLOCKED_PARITY_UNVERIFIED", "BLOCKED_CANDLE_ELIGIBILITY",
      "BLOCKED_UNKNOWN_LEGACY",
    ]);
    expect(blockers.every((item) => item.fatal)).toBe(true);
    expect(blockers.every((item) => item.evidence === evidence)).toBe(true);
  });

  it("preserves retry policy", () => {
    expect(canonicalGapBlock({}).retryable).toBe(true);
    expect(trustedPrehistoryBlock({}).retryable).toBe(true);
    expect(parityUnverifiedBlock({}).retryable).toBe(true);
    expect(featureLineageBlock({}).retryable).toBe(false);
    expect(dxyPolicyBlock({}).retryable).toBe(false);
    expect(setupCacheLineageBlock({}).retryable).toBe(false);
    expect(warmupBlock({}).retryable).toBe(false);
  });
});