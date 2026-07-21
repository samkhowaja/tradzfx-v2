import { describe, expect, it } from "vitest";
import type { StagedStrategyConfig } from "@tm/shared";
import { coordinateStagedEvents } from "./coordinator";
import type { StagedEvent } from "./types";

const config: StagedStrategyConfig = {
  enabled: true, mode: "compare",
  context: { tf: "5m", maxAgeBars: 12, requireAgreement: true },
  setup: { tf: "5m", eventTypes: ["bos"], maxAgeBars: 2, requireZone: true, zoneMaxAgeBars: 24 },
  entry: { tf: "1m", eventTypes: ["bos"], maxBarsAfterTouch: 5 },
  cancellation: { onBiasFlip: true, onZoneInvalidation: true, oneTradePerSetup: true },
};
const options = { strategyId: "staged", config };
const context: StagedEvent = { id:"c", type:"context", symbol:"XAUUSD", ts:"2026-07-18T08:00:00Z", side:"buy", agreement:true };

function zone(id: string, bottom: number, top: number): StagedEvent {
  return { id:`z-${id}`, type:"zone_formed", symbol:"XAUUSD", ts:"2026-07-18T08:01:00Z", side:"buy", zoneId:id, zoneKind:"fvg", bottom, top };
}

describe("staged coordinator", () => {
  it("isolates simultaneous exact zones", () => {
    const events: StagedEvent[] = [context, zone("one",100,101), zone("two",90,91),
      { id:"s",type:"setup_structure",symbol:"XAUUSD",ts:"2026-07-18T08:02:00Z",side:"buy",eventType:"bos" },
      { id:"b",type:"candle_closed",symbol:"XAUUSD",ts:"2026-07-18T08:03:00Z",high:101,low:99,close:100 },
      { id:"e",type:"entry_structure",symbol:"XAUUSD",ts:"2026-07-18T08:04:00Z",side:"buy",eventType:"bos" },
    ];
    const result = coordinateStagedEvents("XAUUSD", events, options);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].state.evidence.zoneId).toBe("one");
    expect(result.active.find((state) => state.evidence.zoneId === "two")?.phase).toBe("waiting_touch");
  });

  it("generates deterministic entry expiry from event clock", () => {
    const events: StagedEvent[] = [context, zone("one",100,101),
      { id:"s",type:"setup_structure",symbol:"XAUUSD",ts:"2026-07-18T08:02:00Z",side:"buy",eventType:"bos" },
      { id:"b",type:"candle_closed",symbol:"XAUUSD",ts:"2026-07-18T08:03:00Z",high:101,low:99,close:100 },
      { id:"late",type:"entry_structure",symbol:"XAUUSD",ts:"2026-07-18T08:09:00Z",side:"buy",eventType:"bos" },
    ];
    const result = coordinateStagedEvents("XAUUSD", events, options);
    expect(result.signals).toHaveLength(0);
    expect(result.completed.at(-1)?.reason).toBe("entry_window_expired");
  });

  it("cancels candidates independently by zone identity", () => {
    const events: StagedEvent[] = [context, zone("one",100,101), zone("two",90,91),
      { id:"i",type:"zone_invalidated",symbol:"XAUUSD",ts:"2026-07-18T08:02:00Z",zoneId:"one" },
    ];
    const result = coordinateStagedEvents("XAUUSD", events, options);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].evidence.zoneId).toBe("one");
    expect(result.active[0].evidence.zoneId).toBe("two");
  });

  it("emits one trade when one entry event readies overlapping zones", () => {
    const events: StagedEvent[] = [context, zone("one",100,102), zone("two",101,103),
      { id:"s",type:"setup_structure",symbol:"XAUUSD",ts:"2026-07-18T08:02:00Z",side:"buy",eventType:"bos" },
      { id:"b",type:"candle_closed",symbol:"XAUUSD",ts:"2026-07-18T08:03:00Z",high:103,low:100,close:102 },
      { id:"e",type:"entry_structure",symbol:"XAUUSD",ts:"2026-07-18T08:04:00Z",side:"buy",eventType:"bos" },
    ];
    const result = coordinateStagedEvents("XAUUSD", events, options);
    expect(result.signals).toHaveLength(1);
    expect(result.ignoredReasons.duplicate_zone_same_entry_event).toBe(1);
  });
});
