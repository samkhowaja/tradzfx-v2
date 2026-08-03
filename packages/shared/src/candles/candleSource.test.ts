import { describe, it, expect, vi } from "vitest";
import { getCandles, getRecentCandles } from "./candleSource";

function createFakePool(
  handlers: Array<{ match: RegExp; rows: any[] }>,
  canonicalBrokerId: string | null = "1x Trade Ltd."
): any {
  return {
    query: vi.fn(async (sql: string) => {
      if (/FROM ops\.feature_pipeline_symbols/.test(sql)) {
        return { rows: canonicalBrokerId ? [{ canonical_broker_id: canonicalBrokerId }] : [] };
      }
      const h = handlers.find((x) => x.match.test(sql));
      if (!h) throw new Error(`Unexpected query in test: ${sql.slice(0, 140)}`);
      return { rows: h.rows };
    }),
  };
}

const t0 = new Date("2026-06-01T10:00:00.000Z");
const t1 = new Date("2026-06-01T10:05:00.000Z");
const t2 = new Date("2026-06-01T10:10:00.000Z");
const from = t0;
const to = t2; // 3 x 5m bars expected

function caggRow(ts: Date, tick?: number) {
  return {
    symbol: "XAUUSD", ts, o: 100, h: 101, l: 99, c: 100.5, v: 10,
    ...(tick != null ? { tick_count: tick } : {}),
  };
}

describe("getCandles (candleSource)", () => {
  it("returns canonical projection rows and carries tickCount when coverage is complete", async () => {
    const pool = createFakePool([
      { match: /FROM market\.candles_5m_canonical/, rows: [caggRow(t0, 12), caggRow(t1, 15), caggRow(t2, 9)] },
    ]);
    const out = await getCandles(pool, "XAUUSD", "5m", from, to);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.tickCount)).toEqual([12, 15, 9]);
    // rollup (1m time_bucket) must NOT have been queried on a complete cagg
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringMatching(/time_bucket/), expect.anything());
  });

  it("falls back to the deterministic canonical 1m rollup when projection coverage is low", async () => {
    const pool = createFakePool([
      { match: /FROM market\.candles_5m_canonical/, rows: [caggRow(t0, 12)] }, // 1 of 3 expected -> 33% < 0.98
      { match: /time_bucket/, rows: [caggRow(t0), caggRow(t1), caggRow(t2)] },
    ]);
    const out = await getCandles(pool, "XAUUSD", "5m", from, to);
    expect(out).toHaveLength(3);
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/time_bucket/), expect.anything());
  });

  it("rollup path yields undefined tickCount when query rows omit it", async () => {
    const pool = createFakePool([
      { match: /FROM market\.candles_5m_canonical/, rows: [] },
      { match: /time_bucket/, rows: [caggRow(t0), caggRow(t1)] },
    ]);
    const out = await getCandles(pool, "XAUUSD", "5m", from, to);
    expect(out.every((c) => c.tickCount === undefined)).toBe(true);
  });

  it("1m reads the effective-dated canonical relation without a broker predicate", async () => {
    const pool = createFakePool([
      { match: /FROM market\.candles_1m_canonical/, rows: [caggRow(t0), caggRow(new Date("2026-06-01T10:01:00.000Z"))] },
    ], null);
    const end = new Date("2026-06-01T10:01:00.000Z");
    const out = await getCandles(pool, "XAUUSD", "1m", t0, end);
    expect(out).toHaveLength(2);
    expect(pool.query).toHaveBeenCalledWith(
      expect.not.stringMatching(/broker =/),
      ["XAUUSD", t0, end]
    );
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/FROM ops\.feature_pipeline_symbols/),
      expect.anything()
    );
  });

  it("fails closed naturally when canonical relation returns no policy-covered rows", async () => {
    const pool = createFakePool([
      { match: /FROM market\.candles_1m_canonical/, rows: [] },
    ], null);
    await expect(getCandles(pool, "XAUUSD", "1m", t0, t1)).resolves.toEqual([]);
  });

  it("uses canonical HTF and canonical 1m fallback without broker predicates", async () => {
    const pool = createFakePool([
      { match: /FROM market\.candles_5m_canonical/, rows: [] },
      { match: /time_bucket/, rows: [caggRow(t0), caggRow(t1), caggRow(t2)] },
    ]);
    await getCandles(pool, "XAUUSD", "5m", from, to);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM market\.candles_5m_canonical/),
      ["XAUUSD", from, to]
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM market\.candles_1m_canonical/),
      ["XAUUSD", from, to, "300 seconds"]
    );
    for (const call of pool.query.mock.calls) expect(call[0]).not.toMatch(/broker =/);
  });

  it("supports explicit broker snapshots without consulting live policy", async () => {
    const pool = createFakePool([
      { match: /FROM candles_1m/, rows: [caggRow(t0)] },
    ], null);
    const out = await getCandles(pool, "XAUUSD", "1m", t0, t0, {
      canonicalBrokerId: "MT5",
    });
    expect(out).toHaveLength(1);
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/FROM ops\.feature_pipeline_symbols/),
      expect.anything()
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/broker = \$2/),
      ["XAUUSD", "MT5", t0, t0]
    );
  });

  it("does NOT fall back over a weekend-spanning window when tradable bars are complete (SK-10)", async () => {
    // Window: Sun 20:00 (closed) .. Mon 02:00. Tradable 1h buckets = Sun21/22/23 + Mon00/01/02 = 6.
    // Under the old 24/7 model this was 7 expected (incl. closed Sun20) -> ratio 6/7 and a
    // spurious boundary gap -> rollup. Calendar-aware: 6 expected, 6 present -> cagg path.
    const from = new Date("2026-06-07T20:00:00.000Z"); // Sun < 21:00 (closed)
    const to = new Date("2026-06-08T02:00:00.000Z");   // Mon 02:00
    const rows = [
      new Date("2026-06-07T21:00:00.000Z"),
      new Date("2026-06-07T22:00:00.000Z"),
      new Date("2026-06-07T23:00:00.000Z"),
      new Date("2026-06-08T00:00:00.000Z"),
      new Date("2026-06-08T01:00:00.000Z"),
      new Date("2026-06-08T02:00:00.000Z"),
    ].map((ts, i) => caggRow(ts, 100 + i));
    const pool = createFakePool([{ match: /FROM market\.candles_1h_canonical/, rows }]);
    // Use FX here: XAUUSD has an additional daily break at 21:00 UTC,
    // covered independently below.
    const out = await getCandles(pool, "EURUSD", "1h", from, to);
    expect(out).toHaveLength(6);
    expect(out.map((c) => c.tickCount)).toEqual([100, 101, 102, 103, 104, 105]);
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringMatching(/time_bucket/), expect.anything());
  });

  it("falls back when a mid-week tradable bar is missing (gap, not just low count)", async () => {
    const from = new Date("2026-06-01T00:00:00.000Z"); // Mon 00:00
    const to = new Date("2026-06-01T02:00:00.000Z");   // Mon 02:00 -> 3 tradable buckets
    const pool = createFakePool([
      // projection missing Mon 01:00 -> gapCount 1 -> fallback
      { match: /FROM market\.candles_1h_canonical/, rows: [caggRow(new Date("2026-06-01T00:00:00.000Z")), caggRow(new Date("2026-06-01T02:00:00.000Z"))] },
      { match: /time_bucket/, rows: [caggRow(new Date("2026-06-01T00:00:00.000Z")), caggRow(new Date("2026-06-01T01:00:00.000Z")), caggRow(new Date("2026-06-01T02:00:00.000Z"))] },
    ]);
    const out = await getCandles(pool, "XAUUSD", "1h", from, to);
    expect(out).toHaveLength(3);
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/time_bucket/), expect.anything());
  });

  it("rollup path carries tick_count (per-bucket 1m fullness) when present", async () => {
    const pool = createFakePool([
      { match: /FROM market\.candles_5m_canonical/, rows: [] }, // force fallback
      {
        match: /time_bucket/,
        rows: [
          { ...caggRow(t0), tick_count: 5 },
          { ...caggRow(t1), tick_count: 4 },
        ],
      },
    ]);
    const out = await getCandles(pool, "XAUUSD", "5m", from, to);
    expect(out.map((c) => c.tickCount)).toEqual([5, 4]);
  });

  it("XAUUSD: a missing 21:00 UTC bar is the daily break, NOT a gap (no rollup)", async () => {
    const from = new Date("2026-06-01T20:00:00.000Z"); // Mon 20:00
    const to = new Date("2026-06-01T23:00:00.000Z");   // Mon 23:00
    // XAU tradable buckets in window: 20, 22, 23 (21 is the daily break) = 3.
    const rows = [
      new Date("2026-06-01T20:00:00.000Z"),
      new Date("2026-06-01T22:00:00.000Z"),
      new Date("2026-06-01T23:00:00.000Z"),
    ].map((ts, i) => caggRow(ts, 60 + i));
    const pool = createFakePool([{ match: /FROM market\.candles_1h_canonical/, rows }]);
    const out = await getCandles(pool, "XAUUSD", "1h", from, to);
    expect(out).toHaveLength(3);
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringMatching(/time_bucket/), expect.anything());
  });
});

describe("getRecentCandles (SK-08 count-based fetch)", () => {
  it("excludes the currently forming edge candle", async () => {
    const pool = createFakePool([
      { match: /FROM market\.candles_5m_canonical/, rows: [caggRow(t1, 15), caggRow(t0, 12)] },
    ]);

    const out = await getRecentCandles(pool, "XAUUSD", "5m", new Date("2026-06-01T10:10:00.000Z"), 3, { allowRealtimeFallback: false });

    expect(out.map((c) => c.ts)).toEqual([t0, t1]);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["XAUUSD", new Date("2026-06-01T10:05:00.000Z"), 3]);
  });

  const end = new Date("2026-06-01T05:00:00.000Z"); // Mon 05:00

  it("returns last-N from the canonical projection with tickCount and no rollup on a complete weekday series", async () => {
    const pool = createFakePool([
      {
        match: /FROM market\.candles_1h_canonical/,
        rows: [
          caggRow(new Date("2026-06-01T05:00:00.000Z"), 50),
          caggRow(new Date("2026-06-01T04:00:00.000Z"), 51),
          caggRow(new Date("2026-06-01T03:00:00.000Z"), 52),
        ],
      },
    ]);
    const out = await getRecentCandles(pool, "XAUUSD", "1h", end, 3);
    expect(out.map((c) => c.ts.toISOString())).toEqual([
      "2026-06-01T03:00:00.000Z",
      "2026-06-01T04:00:00.000Z",
      "2026-06-01T05:00:00.000Z",
    ]);
    expect(out.map((c) => c.tickCount)).toEqual([52, 51, 50]);
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringMatching(/time_bucket/), expect.anything());
  });

  it("falls back to the rollup when the canonical projection has a mid-week gap", async () => {
    const pool = createFakePool([
      {
        match: /FROM market\.candles_1h_canonical/,
        rows: [
          caggRow(new Date("2026-06-01T05:00:00.000Z"), 50),
          caggRow(new Date("2026-06-01T03:00:00.000Z"), 52), // Mon04 missing
        ],
      },
      {
        match: /time_bucket/,
        rows: [
          caggRow(new Date("2026-06-01T03:00:00.000Z"), 52),
          caggRow(new Date("2026-06-01T04:00:00.000Z"), 51),
          caggRow(new Date("2026-06-01T05:00:00.000Z"), 50),
        ],
      },
    ]);
    const out = await getRecentCandles(pool, "XAUUSD", "1h", end, 3);
    expect(out).toHaveLength(3);
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/time_bucket/), expect.anything());
  });

  it("treats weekend adjacency (Sun 23:00 -> Mon 00:00) as continuous, not a gap", async () => {
    const endMon = new Date("2026-06-08T02:00:00.000Z"); // Mon 02:00
    const pool = createFakePool([
      {
        match: /FROM market\.candles_1h_canonical/,
        rows: [
          caggRow(new Date("2026-06-08T02:00:00.000Z"), 40), // Mon02
          caggRow(new Date("2026-06-08T01:00:00.000Z"), 41), // Mon01
          caggRow(new Date("2026-06-08T00:00:00.000Z"), 42), // Mon00
          caggRow(new Date("2026-06-07T23:00:00.000Z"), 43), // Sun23
        ],
      },
    ]);
    const out = await getRecentCandles(pool, "XAUUSD", "1h", endMon, 4);
    expect(out).toHaveLength(4);
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringMatching(/time_bucket/), expect.anything());
  });
});
