import { describe, it, expect } from "vitest";
import {
  isTradableInstant,
  expectedTradableBars,
  tradableBarStarts,
  gapInfo,
} from "./marketCalendar";

const d = (s: string) => new Date(s);

describe("isTradableInstant (FX 24/5, 21:00 UTC NY boundary)", () => {
  it.each([
    ["2026-06-06T12:00:00.000Z", false], // Saturday
    ["2026-05-31T20:59:00.000Z", false], // Sunday before Asia open
    ["2026-05-31T21:00:00.000Z", true],  // Sunday Asia open
    ["2026-05-31T23:59:00.000Z", true],  // Sunday late
    ["2026-06-05T20:59:00.000Z", true],  // Friday before NY close
    ["2026-06-05T21:00:00.000Z", false], // Friday NY close
    ["2026-06-05T12:00:00.000Z", true],  // Friday midday
    ["2026-06-01T00:00:00.000Z", true],  // Monday open
    ["2026-06-04T23:59:00.000Z", true],  // Thursday late
    ["2026-06-03T12:00:00.000Z", true],  // Wednesday
  ])("%s -> %s", (iso, want) => {
    expect(isTradableInstant(d(iso))).toBe(want);
  });
});

describe("expectedTradableBars", () => {
  const mon = d("2026-06-01T00:00:00.000Z"); // Monday
  const friClose = d("2026-06-05T21:00:00.000Z"); // Friday 21:00 (excluded)

  it("counts 1h bars Mon..Fri (no weekend, no Fri>=21)", () => {
    // Mon-Thu 24h each = 96, Fri 00..20 = 21 -> 117
    expect(expectedTradableBars("1h", mon, friClose)).toBe(117);
  });

  it("includes the Sunday 21:00 Asia open when the range starts then", () => {
    const sunOpen = d("2026-05-31T21:00:00.000Z"); // Sunday 21:00
    // 117 + Sun 21/22/23 = 120
    expect(expectedTradableBars("1h", sunOpen, friClose)).toBe(120);
  });

  it("is 0 over a pure closed window (Sat + Sun<21)", () => {
    const sat = d("2026-06-06T00:00:00.000Z");
    const sunPre = d("2026-06-07T20:00:00.000Z");
    expect(expectedTradableBars("1h", sat, sunPre)).toBe(0);
  });

  it("counts 5m bars over a single Monday", () => {
    const dayEnd = d("2026-06-01T23:59:00.000Z");
    expect(expectedTradableBars("5m", mon, dayEnd)).toBe(24 * 12); // 288
  });
});

describe("gapInfo", () => {
  const mon = d("2026-06-01T00:00:00.000Z");
  const friClose = d("2026-06-05T21:00:00.000Z");

  it("reports no gaps when every tradable bar is present", () => {
    const rows = tradableBarStarts("1h", mon, friClose).map((ts) => ({ ts }));
    const g = gapInfo(rows, "1h", mon, friClose);
    expect(g.hasGaps).toBe(false);
    expect(g.gapCount).toBe(0);
    expect(g.largestGapMinutes).toBe(0);
  });

  it("flags a single missing mid-week bar but ignores the weekend", () => {
    const rows = tradableBarStarts("1h", mon, friClose).map((ts) => ({ ts }));
    // drop one Wednesday bar (2026-06-03 10:00)
    const drop = d("2026-06-03T10:00:00.000Z").getTime();
    const gappy = rows.filter((r) => r.ts.getTime() !== drop);
    const g = gapInfo(gappy, "1h", mon, friClose);
    expect(g.hasGaps).toBe(true);
    expect(g.gapCount).toBe(1);
    expect(g.largestGapMinutes).toBe(60);
  });

  it("treats empty rows as fully gappy across tradable buckets", () => {
    const g = gapInfo([], "1h", mon, d("2026-06-01T23:00:00.000Z")); // 24 Mon buckets
    expect(g.hasGaps).toBe(true);
    expect(g.gapCount).toBe(24);
  });
});

describe("per-symbol daily break (XAUUSD gold halt ~21:00 UTC)", () => {
  it.each([
    ["2026-06-01T20:00:00.000Z", true],  // Mon 20:00 tradable
    ["2026-06-01T21:00:00.000Z", false], // Mon 21:00 daily break
    ["2026-06-01T21:30:00.000Z", false], // inside break
    ["2026-06-01T22:00:00.000Z", true],  // Mon 22:00 tradable again
    ["2026-05-31T21:00:00.000Z", false], // Sun 21:00 = Asia open AND XAU break -> closed
    ["2026-05-31T22:00:00.000Z", true],  // Sun 22:00 tradable
  ])("XAUUSD %s -> %s", (iso, want) => {
    expect(isTradableInstant(d(iso), "XAUUSD")).toBe(want);
  });

  it("without a symbol, 21:00 UTC is tradable (FX 24/5 default)", () => {
    expect(isTradableInstant(d("2026-06-01T21:00:00.000Z"))).toBe(true);
  });

  it("expectedTradableBars excludes the daily 21:00 break bar", () => {
    const mon = d("2026-06-01T00:00:00.000Z");
    const friClose = d("2026-06-05T21:00:00.000Z");
    // FX baseline 117; XAU drops the Mon-Thu 21:00 bars (Fri 21:00 already closed) -> 113
    expect(expectedTradableBars("1h", mon, friClose)).toBe(117);
    expect(expectedTradableBars("1h", mon, friClose, "XAUUSD")).toBe(113);
  });
});

describe("date-keyed Sunday metals session overrides (SUNDAY_SESSION_BY_SYMBOL_DATE)", () => {
  it.each([
    // Registered full-stream Sunday 2026-07-12 (00:00-21:00 session).
    ["2026-07-12T00:00:00.000Z", true],  // session start
    ["2026-07-12T10:30:00.000Z", true],  // mid-session
    ["2026-07-12T20:59:00.000Z", true],  // session tail
    ["2026-07-12T21:00:00.000Z", false], // daily break still applies
    ["2026-07-12T22:00:00.000Z", true],  // post-break (FX week open)
    // Registered partial Sunday 2026-07-19 (00:00-02:00 session only).
    ["2026-07-19T00:00:00.000Z", true],
    ["2026-07-19T01:59:00.000Z", true],
    ["2026-07-19T02:00:00.000Z", false], // past session end, before FX open
    ["2026-07-19T10:00:00.000Z", false], // intra-day hole: NOT registered -> closed
    ["2026-07-19T21:00:00.000Z", false], // FX open hour but XAU daily break
    ["2026-07-19T22:00:00.000Z", true],
    // Unregistered Sunday stays fully closed before 21:00 (fail-closed).
    ["2026-07-05T00:00:00.000Z", false],
    ["2026-07-05T10:00:00.000Z", false],
    ["2026-07-05T21:00:00.000Z", false], // XAU daily break
    ["2026-07-05T22:00:00.000Z", true],
  ])("XAUUSD %s -> %s", (iso, want) => {
    expect(isTradableInstant(d(iso), "XAUUSD")).toBe(want);
  });

  it("registry is symbol-scoped: EURUSD Sunday stays closed on a registered XAUUSD date", () => {
    expect(isTradableInstant(d("2026-07-12T10:00:00.000Z"), "EURUSD")).toBe(false);
    expect(isTradableInstant(d("2026-07-12T10:00:00.000Z"), "XAUUSD")).toBe(true);
  });

  it("no symbol -> base FX calendar (Sunday pre-open closed)", () => {
    expect(isTradableInstant(d("2026-07-12T10:00:00.000Z"))).toBe(false);
  });

  it("expectedTradableBars counts a registered Sunday session", () => {
    const sun = d("2026-07-12T00:00:00.000Z");
    const sunEnd = d("2026-07-12T23:59:00.000Z");
    // Base FX (no symbol, no daily break): 21:00, 22:00, 23:00 are tradable -> 3.
    expect(expectedTradableBars("1h", sun, sunEnd)).toBe(3);
    // XAUUSD: 21:00 is the daily break -> base 2; registered session adds
    // 00:00..20:00 (21 bars) -> 23.
    expect(expectedTradableBars("1h", sun, sunEnd, "XAUUSD")).toBe(23);
  });

  it("expectedTradableBars on an unregistered Sunday matches base FX calendar", () => {
    const sun = d("2026-07-05T00:00:00.000Z");
    const sunEnd = d("2026-07-05T23:59:00.000Z");
    expect(expectedTradableBars("1h", sun, sunEnd, "XAUUSD")).toBe(2);
  });

  it("partial Sunday 2026-07-19 counts only the registered 00:00-02:00 window + post-break", () => {
    const sun = d("2026-07-19T00:00:00.000Z");
    const sunEnd = d("2026-07-19T23:59:00.000Z");
    // Registered 00:00,01:00 (2) + post-break 22:00,23:00 (2) = 4. The 02:00-20:59
    // hole and the 21:00 break bar stay closed.
    expect(expectedTradableBars("1h", sun, sunEnd, "XAUUSD")).toBe(4);
  });
});
