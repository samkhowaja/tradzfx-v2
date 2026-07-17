/**
 * Unit tests for scripts/ingestion-server.js
 *
 * Run with: node --test scripts/ingestion-server.test.js
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  isValidCandle,
  normalizeSymbol,
  normalizeBars,
  roundToMinute,
  pointsToPips,
  spool,
} = require("./ingestion-server.js");

const TMP_ROOT = path.join(__dirname, "..", "temp");
function tmpSpoolDir() {
  return fs.mkdtempSync(path.join(TMP_ROOT, "spooltest-"));
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makePayload(symbol, n) {
  return {
    schemaVersion: "mt5-bars-v1",
    symbol,
    timeframe: "M1",
    source: { broker: "test", accountType: "demo", digits: 2 },
    bars: Array.from({ length: n }, (_, i) => ({
      ts: 1700000000000 + i * 60000,
      o: 100,
      h: 101,
      l: 99,
      c: 100,
      tickVol: 5,
    })),
  };
}

describe("isValidCandle", () => {
  it("accepts a normal candle", () => {
    assert.strictEqual(
      isValidCandle({ time: 1700000000, open: 100, high: 105, low: 99, close: 102, tick_volume: 10 }).valid,
      true
    );
  });

  it("rejects high < low", () => {
    const r = isValidCandle({ time: 1, open: 100, high: 98, low: 99, close: 100, tick_volume: 1 });
    assert.strictEqual(r.valid, false);
  });

  it("rejects negative values", () => {
    const r = isValidCandle({ time: 1, open: -1, high: 100, low: 99, close: 100, tick_volume: 1 });
    assert.strictEqual(r.valid, false);
  });

  it("rejects non-finite values", () => {
    const r = isValidCandle({ time: 1, open: NaN, high: 100, low: 99, close: 100, tick_volume: 1 });
    assert.strictEqual(r.valid, false);
  });
});

describe("normalizeSymbol", () => {
  it("strips non-alphanumerics and uppercases", () => {
    assert.strictEqual(normalizeSymbol("EUR/USD"), "EURUSD");
    assert.strictEqual(normalizeSymbol("XAUUSD.pro"), "XAUUSDPRO");
  });
});

describe("normalizeBars", () => {
  it("converts V1 bars", () => {
    const payload = {
      bars: [{ ts: 1700000000000, o: 1, h: 2, l: 0, c: 1, tickVol: 5, spread: 10 }],
    };
    const out = normalizeBars(payload);
    assert.strictEqual(out[0].time, 1700000000);
    assert.strictEqual(out[0].tick_volume, 5);
  });

  it("passes V2 bars through", () => {
    const payload = {
      bars: [{ time: 1700000000, open: 1, high: 2, low: 0, close: 1, tick_volume: 5 }],
    };
    const out = normalizeBars(payload);
    assert.strictEqual(out[0].time, 1700000000);
    assert.strictEqual(out[0].tick_volume, 5);
  });
});

describe("roundToMinute", () => {
  it("drops seconds and milliseconds", () => {
    const d = roundToMinute(1700000015000);
    assert.strictEqual(d.getSeconds(), 0);
    assert.strictEqual(d.getMilliseconds(), 0);
  });
});

describe("pointsToPips", () => {
  it("divides by 10 for 5-digit symbols", () => {
    assert.strictEqual(pointsToPips(20, 5), 2);
  });

  it("returns points unchanged for 4-digit symbols", () => {
    assert.strictEqual(pointsToPips(2, 4), 2);
  });
});

describe("ingest spool (disk queue for DB outages)", () => {
  it("appendToSpool writes a JSONL record with the payload", () => {
    const dir = tmpSpoolDir();
    try {
      const file = spool.appendToSpool(makePayload("XAUUSD", 3), { dir });
      assert.ok(fs.existsSync(file));
      const lines = fs.readFileSync(file, "utf8").trim().split("\n");
      assert.strictEqual(lines.length, 1);
      const rec = JSON.parse(lines[0]);
      assert.strictEqual(rec.payload.symbol, "XAUUSD");
      assert.strictEqual(rec.payload.bars.length, 3);
      assert.ok(rec.spooledAt);
    } finally {
      rmDir(dir);
    }
  });

  it("spoolStats counts files and bytes", () => {
    const dir = tmpSpoolDir();
    try {
      assert.deepStrictEqual(spool.spoolStats({ dir }), { files: 0, bytes: 0 });
      spool.appendToSpool(makePayload("XAUUSD", 1), { dir });
      const s = spool.spoolStats({ dir });
      assert.strictEqual(s.files, 1);
      assert.ok(s.bytes > 0);
    } finally {
      rmDir(dir);
    }
  });

  it("listSpoolFiles is chronological and ignores non-spool files", () => {
    const dir = tmpSpoolDir();
    try {
      fs.writeFileSync(path.join(dir, "ingest-2026-07-07.jsonl"), "{}\n");
      fs.writeFileSync(path.join(dir, "ingest-2026-07-06.jsonl"), "{}\n");
      fs.writeFileSync(path.join(dir, "corrupt.jsonl"), "x\n");
      fs.writeFileSync(path.join(dir, "notes.txt"), "x\n");
      const names = spool.listSpoolFiles({ dir }).map((f) => f.name);
      assert.deepStrictEqual(names, ["ingest-2026-07-06.jsonl", "ingest-2026-07-07.jsonl"]);
    } finally {
      rmDir(dir);
    }
  });

  it("drainSpool replays FIFO and deletes fully-sent files", async () => {
    const dir = tmpSpoolDir();
    try {
      fs.writeFileSync(
        path.join(dir, "ingest-2026-07-06.jsonl"),
        JSON.stringify({ payload: makePayload("AAA", 1) }) + "\n" +
          JSON.stringify({ payload: makePayload("BBB", 1) }) + "\n"
      );
      fs.writeFileSync(
        path.join(dir, "ingest-2026-07-07.jsonl"),
        JSON.stringify({ payload: makePayload("CCC", 1) }) + "\n"
      );
      const sent = [];
      const summary = await spool.drainSpool(async (p) => sent.push(p.symbol), { dir });
      assert.deepStrictEqual(sent, ["AAA", "BBB", "CCC"]);
      assert.strictEqual(summary.batchesSent, 3);
      assert.strictEqual(summary.filesDrained, 2);
      assert.strictEqual(summary.stoppedEarly, false);
      assert.strictEqual(spool.spoolStats({ dir }).files, 0);
    } finally {
      rmDir(dir);
    }
  });

  it("drainSpool keeps the failed line + remainder on a transient error and stops", async () => {
    const dir = tmpSpoolDir();
    try {
      const file = path.join(dir, "ingest-2026-07-06.jsonl");
      fs.writeFileSync(
        file,
        ["AAA", "BBB", "CCC"]
          .map((s) => JSON.stringify({ payload: makePayload(s, 1) }))
          .join("\n") + "\n"
      );
      const sent = [];
      const summary = await spool.drainSpool(
        async (p) => {
          if (p.symbol === "BBB") throw new Error("connection terminated"); // transient
          sent.push(p.symbol);
        },
        { dir }
      );
      assert.deepStrictEqual(sent, ["AAA"]);
      assert.strictEqual(summary.batchesSent, 1);
      assert.strictEqual(summary.stoppedEarly, true);
      assert.ok(summary.error.includes("connection terminated"));
      // File still holds BBB + CCC, in order.
      const remaining = fs
        .readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l).payload.symbol);
      assert.deepStrictEqual(remaining, ["BBB", "CCC"]);
      // Next tick with a healthy DB finishes the file.
      const summary2 = await spool.drainSpool(async (p) => sent.push(p.symbol), { dir });
      assert.strictEqual(summary2.stoppedEarly, false);
      assert.deepStrictEqual(sent, ["AAA", "BBB", "CCC"]);
      assert.strictEqual(spool.spoolStats({ dir }).files, 0);
    } finally {
      rmDir(dir);
    }
  });

  it("drainSpool quarantines corrupt lines and permanent (400) failures instead of wedging", async () => {
    const dir = tmpSpoolDir();
    try {
      fs.writeFileSync(
        path.join(dir, "ingest-2026-07-06.jsonl"),
        "not json at all\n" +
          JSON.stringify({ payload: makePayload("BAD", 1) }) + "\n" +
          JSON.stringify({ payload: makePayload("GOOD", 1) }) + "\n"
      );
      const sent = [];
      const summary = await spool.drainSpool(
        async (p) => {
          if (p.symbol === "BAD") {
            const e = new Error("invalid candle");
            e.statusCode = 400;
            throw e;
          }
          sent.push(p.symbol);
        },
        { dir }
      );
      assert.deepStrictEqual(sent, ["GOOD"]);
      assert.strictEqual(summary.quarantined, 2);
      assert.strictEqual(summary.stoppedEarly, false);
      const corrupt = fs.readFileSync(path.join(dir, "corrupt.jsonl"), "utf8").trim().split("\n");
      assert.strictEqual(corrupt.length, 2);
      assert.ok(corrupt[0].startsWith("not json"));
    } finally {
      rmDir(dir);
    }
  });

  it("enforceSpoolCap drops oldest files first", () => {
    const dir = tmpSpoolDir();
    try {
      fs.writeFileSync(path.join(dir, "ingest-2026-07-05.jsonl"), "x".repeat(100));
      fs.writeFileSync(path.join(dir, "ingest-2026-07-06.jsonl"), "x".repeat(100));
      fs.writeFileSync(path.join(dir, "ingest-2026-07-07.jsonl"), "x".repeat(100));
      const deleted = spool.enforceSpoolCap(150, { dir });
      assert.deepStrictEqual(deleted, ["ingest-2026-07-05.jsonl", "ingest-2026-07-06.jsonl"]);
      assert.deepStrictEqual(
        spool.listSpoolFiles({ dir }).map((f) => f.name),
        ["ingest-2026-07-07.jsonl"]
      );
    } finally {
      rmDir(dir);
    }
  });
});
