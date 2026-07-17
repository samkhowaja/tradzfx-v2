/**
 * Unit tests for scripts/backfill-candles-from-mt5-csv.js
 *
 * Run with: node --test scripts/backfill-candles-from-mt5-csv.test.js
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseArgs,
  findCsvFiles,
  validateCandle,
  pipSizeFromDigits,
  suspectRangeReason,
  MAX_1M_RANGE_PIPS,
} = require("./backfill-candles-from-mt5-csv.js");

function makeCandle(overrides = {}) {
  return { o: 100, h: 105, l: 99, c: 102, v: 10, ...overrides };
}

describe("guarded import arguments", () => {
  it("parses missing-only and export filters", () => {
    const args = parseArgs([
      "C:\\exports",
      "--tz-offset-minutes=180",
      "--broker=1x Trade Ltd.",
      "--insert-missing-only",
      "--symbols=AUDUSD,eurusd",
      "--filename-contains=20260717172600",
    ]);
    assert.strictEqual(args.dir, "C:\\exports");
    assert.strictEqual(args.tzOffsetMinutes, 180);
    assert.strictEqual(args.broker, "1x Trade Ltd.");
    assert.strictEqual(args.insertMissingOnly, true);
    assert.deepStrictEqual([...args.symbols], ["AUDUSD", "EURUSD"]);
    assert.strictEqual(args.filenameContains, "20260717172600");
  });

  it("filters files by symbol and export marker", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt5-csv-test-"));
    try {
      for (const name of [
        "AUDUSD_M1_old.csv",
        "AUDUSD_M1_20260717172600.csv",
        "EURUSD_M1_20260717172600.csv",
        "notes.csv",
      ]) fs.writeFileSync(path.join(dir, name), "");
      const files = findCsvFiles(dir, {
        symbols: new Set(["AUDUSD"]),
        filenameContains: "20260717172600",
      });
      assert.deepStrictEqual(files.map(({ name }) => name), ["AUDUSD_M1_20260717172600.csv"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("validateCandle", () => {
  it("accepts a normal candle", () => {
    assert.strictEqual(validateCandle(makeCandle()).valid, true);
  });

  it("rejects high < low", () => {
    const r = validateCandle(makeCandle({ h: 98, l: 99 }));
    assert.strictEqual(r.valid, false);
    assert.ok(String(r.reason).includes("high < low"));
  });

  it("rejects high below open", () => {
    const r = validateCandle(makeCandle({ h: 99, o: 100 }));
    assert.strictEqual(r.valid, false);
    assert.ok(String(r.reason).includes("high below"));
  });

  it("rejects high below close", () => {
    const r = validateCandle(makeCandle({ h: 101, c: 102 }));
    assert.strictEqual(r.valid, false);
    assert.ok(String(r.reason).includes("high below"));
  });

  it("rejects low above open", () => {
    const r = validateCandle(makeCandle({ l: 101, o: 100 }));
    assert.strictEqual(r.valid, false);
    assert.ok(String(r.reason).includes("low above"));
  });

  it("rejects low above close", () => {
    const r = validateCandle(makeCandle({ l: 103, c: 102 }));
    assert.strictEqual(r.valid, false);
    assert.ok(String(r.reason).includes("low above"));
  });

  it("rejects negative OHLCV values", () => {
    assert.strictEqual(validateCandle(makeCandle({ o: -1 })).valid, false);
    assert.strictEqual(validateCandle(makeCandle({ v: -1 })).valid, false);
  });

  it("rejects non-finite OHLC values", () => {
    assert.strictEqual(validateCandle(makeCandle({ c: NaN })).valid, false);
    assert.strictEqual(validateCandle(makeCandle({ h: Infinity })).valid, false);
  });
});

describe("pipSizeFromDigits", () => {
  it("4-digit: 1 point = 1 pip", () => {
    assert.ok(Math.abs(pipSizeFromDigits(4) - 0.0001) < 1e-12);
  });
  it("5-digit FX: 10 points = 1 pip", () => {
    assert.ok(Math.abs(pipSizeFromDigits(5) - 0.0001) < 1e-12);
  });
  it("3-digit JPY: 10 points = 1 pip", () => {
    assert.strictEqual(pipSizeFromDigits(3), 0.01);
  });
  it("2-digit XAU: 10 points = 1 pip", () => {
    assert.strictEqual(pipSizeFromDigits(2), 0.1);
  });
  it("invalid digits -> null", () => {
    assert.strictEqual(pipSizeFromDigits(-1), null);
    assert.strictEqual(pipSizeFromDigits(NaN), null);
  });
});

describe("suspectRangeReason (SK-65 magnitude prefilter)", () => {
  it("cap is 1000 pips", () => {
    assert.strictEqual(MAX_1M_RANGE_PIPS, 1000);
  });
  it("accepts a normal XAU 1m range ($50 = 500p)", () => {
    // digits=2 => pipSize=0.1 ; range 50 => 500p < 1000p
    assert.strictEqual(suspectRangeReason({ h: 2700, l: 2650, digits: 2 }), null);
  });
  it("flags an extreme XAU 1m range ($150 = 1500p > cap)", () => {
    const r = suspectRangeReason({ h: 2800, l: 2650, digits: 2 });
    assert.ok(r && r.includes("> 1000p cap"), r);
  });
  it("flags an extreme EURUSD 1m range (0.15 = 1500p)", () => {
    // digits=5 => pipSize=0.0001 ; range 0.15 => 1500p
    const r = suspectRangeReason({ h: 1.20, l: 1.05, digits: 5 });
    assert.ok(r && r.includes("> 1000p cap"), r);
  });
  it("returns null when digits unusable", () => {
    assert.strictEqual(suspectRangeReason({ h: 2, l: 1, digits: NaN }), null);
  });
});
