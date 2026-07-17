import { describe, it, expect } from "vitest";
import { buildCacheInputHash } from "./runner";

/**
 * SK-57: the feature cache key must include engine_ver (feature.version) so an
 * engine bump busts stale entries. Before the fix, identical inputs across a
 * version bump collided and the cache returned the pre-bump output.
 */
describe("buildCacheInputHash (SK-57 engine_ver in cache key)", () => {
  const ts = new Date("2026-06-01T12:00:00.000Z");
  const content = "ohlc:deadbeef"; // stand-in for feature.hashInput(input)

  it("changes when engine_ver changes for identical inputs (the fix)", () => {
    const a = buildCacheInputHash("1.2.0", content, "XAUUSD", "1h", ts);
    const b = buildCacheInputHash("1.3.0", content, "XAUUSD", "1h", ts);
    expect(a).not.toBe(b);
  });

  it("documents the pre-fix collision (no version => identical across bumps)", () => {
    // Old format: `${content}:${symbol}:${tf}:${ts}` — version-independent → collision.
    const oldFmt = (ver: string) =>
      `${content}:XAUUSD:1h:${ts.toISOString()}`; // ver intentionally unused
    expect(oldFmt("1.2.0")).toBe(oldFmt("1.3.0")); // the bug
    // New format must NOT collide:
    expect(buildCacheInputHash("1.2.0", content, "XAUUSD", "1h", ts)).not.toBe(
      buildCacheInputHash("1.3.0", content, "XAUUSD", "1h", ts)
    );
  });

  it("still changes when the content hash changes", () => {
    const a = buildCacheInputHash("1.2.0", "ohlc:aaa", "XAUUSD", "1h", ts);
    const b = buildCacheInputHash("1.2.0", "ohlc:bbb", "XAUUSD", "1h", ts);
    expect(a).not.toBe(b);
  });

  it("still changes across symbol/tf/ts (context-sensitive features)", () => {
    const base = buildCacheInputHash("1.2.0", content, "XAUUSD", "1h", ts);
    expect(buildCacheInputHash("1.2.0", content, "EURUSD", "1h", ts)).not.toBe(base);
    expect(buildCacheInputHash("1.2.0", content, "XAUUSD", "4h", ts)).not.toBe(base);
    expect(
      buildCacheInputHash("1.2.0", content, "XAUUSD", "1h", new Date("2026-06-01T13:00:00.000Z"))
    ).not.toBe(base);
  });

  it("is stable for identical inputs", () => {
    const a = buildCacheInputHash("1.2.0", content, "XAUUSD", "1h", ts);
    const b = buildCacheInputHash("1.2.0", content, "XAUUSD", "1h", new Date(ts.getTime()));
    expect(a).toBe(b);
  });
});
