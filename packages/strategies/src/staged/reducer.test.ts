import { describe, expect, it } from "vitest";
import type { StagedStrategyConfig } from "@tm/shared";
import { createInitialStagedState, reduceStagedSetup } from "./reducer";
import type { StagedEvent, StagedSetupState } from "./types";

const config: StagedStrategyConfig = {
  enabled: true,
  mode: "compare",
  context: { tf: "5m", maxAgeBars: 12, requireAgreement: true },
  setup: { tf: "5m", eventTypes: ["bos", "mss"], maxAgeBars: 6, requireZone: true, zoneMaxAgeBars: 24 },
  entry: { tf: "1m", eventTypes: ["bos"], maxBarsAfterTouch: 5 },
  cancellation: { onBiasFlip: true, onZoneInvalidation: true, oneTradePerSetup: true },
};
const options = { strategyId: "five_one_scalp_staged", config };
const event = (value: StagedEvent): StagedEvent => value;

function replay(events: StagedEvent[]): StagedSetupState {
  let state = createInitialStagedState(options.strategyId, "XAUUSD");
  for (const item of events) state = reduceStagedSetup(state, item, options).state;
  return state;
}

const validPrefix: StagedEvent[] = [
  event({ id: "c1", type: "context", symbol: "XAUUSD", ts: "2026-07-18T08:00:00Z", side: "buy", agreement: true }),
  event({ id: "z1", type: "zone_formed", symbol: "XAUUSD", ts: "2026-07-18T08:05:00Z", side: "buy", zoneId: "zone-1", zoneKind: "fvg", top: 3335, bottom: 3330 }),
  event({ id: "s1", type: "setup_structure", symbol: "XAUUSD", ts: "2026-07-18T08:10:00Z", side: "buy", eventType: "bos" }),
  event({ id: "b1", type: "candle_closed", symbol: "XAUUSD", ts: "2026-07-18T08:15:00Z", high: 3332, low: 3329, close: 3331 }),
];

describe("staged setup reducer", () => {
  it("advances only through ordered setup, touch, and entry stages", () => {
    const state = replay([
      ...validPrefix,
      event({ id: "e1", type: "entry_structure", symbol: "XAUUSD", ts: "2026-07-18T08:16:00Z", side: "buy", eventType: "bos" }),
      event({ id: "x1", type: "execution_accepted", symbol: "XAUUSD", ts: "2026-07-18T08:17:00Z" }),
    ]);
    expect(state.phase).toBe("entered");
    expect(state.setupId).toContain("zone-1");
    expect(state.evidence.touchTs).toBe("2026-07-18T08:15:00Z");
  });

  it("ignores entry structure before zone touch", () => {
    const state = replay([
      ...validPrefix.slice(0, 3),
      event({ id: "e0", type: "entry_structure", symbol: "XAUUSD", ts: "2026-07-18T08:11:00Z", side: "buy", eventType: "bos" }),
    ]);
    expect(state.phase).toBe("waiting_touch");
    expect(state.evidence.entryTriggerTs).toBeUndefined();
  });

  it("does not count the formation or setup candle as a later zone touch", () => {
    const state = replay([
      ...validPrefix.slice(0, 3),
      event({ id: "same-ts", type: "candle_closed", symbol: "XAUUSD", ts: "2026-07-18T08:10:00Z", high: 3332, low: 3329, close: 3331 }),
    ]);
    expect(state.phase).toBe("waiting_touch");
    expect(state.evidence.touchTs).toBeUndefined();
  });

  it("cancels assigned setup when zone invalidates", () => {
    const state = replay([
      ...validPrefix.slice(0, 3),
      event({ id: "i1", type: "zone_invalidated", symbol: "XAUUSD", ts: "2026-07-18T08:12:00Z", zoneId: "zone-1" }),
    ]);
    expect(state.phase).toBe("cancelled");
    expect(state.reason).toBe("zone_invalidated");
  });

  it("cancels active setup on bias flip", () => {
    const state = replay([
      ...validPrefix,
      event({ id: "c2", type: "context", symbol: "XAUUSD", ts: "2026-07-18T08:16:00Z", side: "sell", agreement: true }),
    ]);
    expect(state.phase).toBe("cancelled");
    expect(state.reason).toBe("bias_flip");
  });

  it("rejects out-of-order events", () => {
    const state = replay(validPrefix);
    const reduced = reduceStagedSetup(state, event({ id: "old", type: "entry_structure", symbol: "XAUUSD", ts: "2026-07-18T08:14:00Z", side: "buy", eventType: "bos" }), options);
    expect(reduced.state).toBe(state);
    expect(reduced.ignoredReason).toBe("out_of_order_event");
  });

  it("treats retried event IDs as idempotent", () => {
    const first = reduceStagedSetup(createInitialStagedState(options.strategyId, "XAUUSD"), validPrefix[0], options);
    const duplicate = reduceStagedSetup(first.state, validPrefix[0], options);
    expect(duplicate.state).toBe(first.state);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.ignoredReason).toBe("duplicate_event");
  });

  it("cancels deterministically on explicit expiry", () => {
    const state = replay(validPrefix.slice(0, 3));
    const expired = reduceStagedSetup(state, event({ id: "expiry-1", type: "expired", symbol: "XAUUSD", ts: "2026-07-18T08:41:00Z", reason: "entry_window_expired" }), options);
    expect(expired.state.phase).toBe("cancelled");
    expect(expired.state.reason).toBe("entry_window_expired");
  });
});
