import { describe, it, expect, vi } from "vitest";
import { validateSpec } from "./validate";
import type { StrategySpec } from "@tm/shared";

function orbSpec(overrides: Partial<StrategySpec> = {}): StrategySpec {
  return {
    id: "orb_test",
    name: "ORB Test",
    version: "1",
    signalSource: "orb",
    filters: { symbols: ["EURUSD"] },
    setup: [
      {
        id: "orb",
        feature: "features_opening_range",
        tf: "15m",
        session: "london",
        predicate: "1 = 1",
        required: true,
      },
    ],
    entry: [
      {
        id: "structure",
        feature: "features_structure",
        tf: "15m",
        predicate: "event_type IN ('bos','mss')",
        required: true,
      },
    ],
    risk: { sl: "atr(15m) * 1.2", tp: "sl * 3.0", minRR: 3, timeoutBars: 10 },
    gates: [],
    ...overrides,
  };
}

describe("validateSpec", () => {
  it("accepts a well-formed ORB spec", () => {
    expect(validateSpec(orbSpec())).toEqual([]);
  });

  it("rejects a session-scoped condition without a session", () => {
    const spec = orbSpec();
    delete spec.setup[0].session;
    const errors = validateSpec(spec);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/must declare session/);
  });

  it("rejects an invalid session value", () => {
    const spec = orbSpec();
    spec.setup[0].session = "tokyo";
    const errors = validateSpec(spec);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/asia, london, ny/);
  });

  it("rejects signalSource 'orb' without an opening-range condition", () => {
    const spec = orbSpec({ setup: [] });
    const errors = validateSpec(spec);
    expect(errors.some((e) => /requires a features_opening_range condition/.test(e))).toBe(true);
  });

  it("rejects an ORB source with the wrong setup family", () => {
    const errors = validateSpec(orbSpec({ setupFamily: "zone_reversal" }));
    expect(errors.some((e) => /must use setupFamily 'orb_breakout'/.test(e))).toBe(true);
  });

  it("accepts an ORB source with the ORB setup family", () => {
    expect(validateSpec(orbSpec({ setupFamily: "orb_breakout" }))).toEqual([]);
  });

  it("does not require session on non-session-scoped features", () => {
    const spec = orbSpec({ signalSource: "zone", setup: [] });
    expect(validateSpec(spec)).toEqual([]);
  });

  it("accepts a valid warmupBars override", () => {
    expect(validateSpec(orbSpec({ warmupBars: 96 }))).toEqual([]);
  });

  it("rejects non-integer warmupBars", () => {
    const errors = validateSpec(orbSpec({ warmupBars: 100.5 }));
    expect(errors.some((e) => /warmupBars must be a positive integer/.test(e))).toBe(true);
  });

  it("rejects warmupBars below the 50-bar floor", () => {
    const errors = validateSpec(orbSpec({ warmupBars: 10 }));
    expect(errors.some((e) => /below the minimum 50/.test(e))).toBe(true);
  });

  // ── New structural validations ──────────────────────────────────────

  it("rejects an unknown gate name", () => {
    const errors = validateSpec(orbSpec({ gates: [{ name: "bogus_gate", enabled: true }] }));
    expect(errors.some((e) => /unknown gate/.test(e))).toBe(true);
  });

  it("accepts all known gate names", () => {
    const known = ["volatility", "session", "spread", "portfolioHeat", "familyPosition", "rateLimit", "dailyLoss", "dailyWin"];
    for (const name of known) {
      const errs = validateSpec(orbSpec({ gates: [{ name, enabled: true }] }));
      const bad = errs.filter((e) => /unknown gate/.test(e));
      expect(bad).toEqual([]);
    }
  });

  it("rejects an unknown signal source", () => {
    const errors = validateSpec(orbSpec({ signalSource: "bogus_source" as any }));
    expect(errors.some((e) => /signalSource.*invalid/.test(e))).toBe(true);
  });

  it("rejects a condition referencing an unknown feature", () => {
    const spec = orbSpec();
    spec.setup[0].feature = "features_bais"; // deliberate typo
    const errors = validateSpec(spec);
    expect(errors.some((e) => /unknown feature 'features_bais'/.test(e))).toBe(true);
  });

  it("rejects missing risk.sl", () => {
    const spec = orbSpec();
    delete spec.risk.sl;
    const errors = validateSpec(spec);
    expect(errors.some((e) => /risk\.sl is required/.test(e))).toBe(true);
  });

  it("rejects missing risk.tp", () => {
    const spec = orbSpec();
    delete spec.risk.tp;
    const errors = validateSpec(spec);
    expect(errors.some((e) => /risk\.tp is required/.test(e))).toBe(true);
  });

  it("rejects missing risk.minRR", () => {
    const spec = orbSpec();
    delete spec.risk.minRR;
    const errors = validateSpec(spec);
    expect(errors.some((e) => /risk\.minRR is required/.test(e))).toBe(true);
  });

  it("rejects missing risk.timeoutBars", () => {
    const spec = orbSpec();
    delete spec.risk.timeoutBars;
    const errors = validateSpec(spec);
    expect(errors.some((e) => /risk\.timeoutBars is required/.test(e))).toBe(true);
  });

  it("rejects invalid entryConfig.type", () => {
    const spec = orbSpec({ entryConfig: { type: "bogus_entry" as any } });
    const errors = validateSpec(spec);
    expect(errors.some((e) => /entryConfig\.type must be/.test(e))).toBe(true);
  });

  it("accepts valid entryConfig types", () => {
    for (const t of ["market", "limit", "stop"] as const) {
      const errs = validateSpec(orbSpec({ entryConfig: { type: t } }));
      const bad = errs.filter((e) => /entryConfig\.type/.test(e));
      expect(bad).toEqual([]);
    }
  });

  it("warns when ignoreLifecycle is set on a level feature", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const spec = orbSpec();
      // features_zone has joinPolicy="active_window", so ignoreLifecycle triggers a warning
      spec.entry[0] = {
        id: "zone_retest",
        feature: "features_zone",
        tf: "15m",
        predicate: "1=1",
        required: true,
        ignoreLifecycle: true,
      };
      validateSpec(spec);
      const msgs = warnSpy.mock.calls.map((c) => c[0]);
      expect(msgs.some((m) => /ignoreLifecycle=true/.test(m))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not warn about ignoreLifecycle on non-level features", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const spec = orbSpec();
      // features_structure has joinPolicy="candidate_set", so no lifecycle warning
      spec.entry[0] = {
        id: "structure",
        feature: "features_structure",
        tf: "15m",
        predicate: "1=1",
        required: true,
        ignoreLifecycle: true,
      };
      validateSpec(spec);
      const msgs = warnSpy.mock.calls.map((c) => c[0]);
      expect(msgs.some((m) => /ignoreLifecycle=true/.test(m))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
