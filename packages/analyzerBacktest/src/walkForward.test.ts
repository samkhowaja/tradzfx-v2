import { describe, it, expect } from "vitest";

function generateWindows(
  startTs: Date,
  endTs: Date,
  trainDays: number,
  testDays: number,
  stepDays: number
) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const windows = [];
  let trainStart = new Date(startTs.getTime());
  while (true) {
    const trainEnd = new Date(trainStart.getTime() + trainDays * msPerDay);
    const testStart = new Date(trainEnd.getTime());
    const testEnd = new Date(testStart.getTime() + testDays * msPerDay);
    if (testEnd > endTs) break;
    windows.push({ trainStart, trainEnd, testStart, testEnd });
    trainStart = new Date(trainStart.getTime() + stepDays * msPerDay);
  }
  return windows;
}

describe("walk-forward window generation", () => {
  it("produces non-overlapping test windows", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-03-01T00:00:00Z");
    const windows = generateWindows(start, end, 20, 5, 5);

    expect(windows.length).toBeGreaterThan(0);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].testStart.getTime()).toBeGreaterThanOrEqual(windows[i - 1].testEnd.getTime());
    }
  });

  it("stops before test window exceeds endTs", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-15T00:00:00Z");
    const windows = generateWindows(start, end, 5, 5, 5);
    expect(windows.length).toBe(1);
    expect(windows[0].testEnd.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});
