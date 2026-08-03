import { describe, expect, it } from "vitest";
import { localDateTimeToUtc, resolveMarketWindows, resolveWindowOccurrence } from "./resolver";

const iso = (value: Date): string => value.toISOString();

describe("market-window resolver", () => {
  it("resolves London winter and summer using local policy time", () => {
    expect(iso(resolveWindowOccurrence("LONDON_KILLZONE", "2026-01-15", "XAUUSD").startsAt))
      .toBe("2026-01-15T07:00:00.000Z");
    expect(iso(resolveWindowOccurrence("LONDON_KILLZONE", "2026-07-15", "XAUUSD").startsAt))
      .toBe("2026-07-15T06:00:00.000Z");
  });

  it("resolves New York winter and summer using local policy time", () => {
    expect(iso(resolveWindowOccurrence("NY_KILLZONE", "2026-01-15", "XAUUSD").startsAt))
      .toBe("2026-01-15T13:00:00.000Z");
    expect(iso(resolveWindowOccurrence("NY_KILLZONE", "2026-07-15", "XAUUSD").startsAt))
      .toBe("2026-07-15T12:00:00.000Z");
  });

  it("handles US and UK DST mismatch weeks independently", () => {
    expect(iso(resolveWindowOccurrence("NY_KILLZONE", "2026-03-20", "EURUSD").startsAt))
      .toBe("2026-03-20T12:00:00.000Z");
    expect(iso(resolveWindowOccurrence("LONDON_KILLZONE", "2026-03-20", "EURUSD").startsAt))
      .toBe("2026-03-20T07:00:00.000Z");
  });

  it("uses inclusive start and exclusive end", () => {
    expect(resolveMarketWindows(new Date("2026-07-15T12:00:00.000Z"), "XAUUSD").map((x) => x.id))
      .toContain("NY_KILLZONE");
    expect(resolveMarketWindows(new Date("2026-07-15T15:00:00.000Z"), "XAUUSD").map((x) => x.id))
      .not.toContain("NY_KILLZONE");
  });

  it("returns overlapping windows instead of selecting one", () => {
    const ids = resolveMarketWindows(new Date("2026-07-15T14:30:00.000Z"), "EURUSD").map((x) => x.id);
    expect(ids).toContain("NY_KILLZONE");
    expect(ids).toContain("LONDON_CLOSE");
  });

  it("marks symbol preference from symbol class", () => {
    expect(resolveWindowOccurrence("NY_KILLZONE", "2026-07-15", "XAUUSD").preferredForSymbol).toBe(true);
    expect(resolveWindowOccurrence("ASIA_KILLZONE", "2026-07-15", "XAUUSD").preferredForSymbol).toBe(false);
  });

  it("rejects nonexistent DST wall-clock time", () => {
    expect(() => localDateTimeToUtc("2026-03-08", "02:30", "America/New_York")).toThrow();
  });

  it("rejects closed weekend occurrence", () => {
    expect(() => resolveWindowOccurrence("LONDON_KILLZONE", "2026-07-18", "EURUSD")).toThrow(/closed/);
  });
});
