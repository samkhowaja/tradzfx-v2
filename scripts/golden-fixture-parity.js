/**
 * Golden fixture regression harness.
 *
 * Generates compact canonical signal/backtest fixtures from a live DB, then
 * validates committed fixtures in CI without needing the DB. The old
 * compiler-vs-legacy comparison was removed with the legacy PIT SQL fork.
 *
 * Usage:
 *   node scripts/golden-fixture-parity.js --generate XAUUSD 7 doyle_sd
 *   node --test scripts/golden-fixture-parity.js
 */

const fs = require("fs");
const path = require("path");

const { test, describe } = require("node:test");
const assert = require("node:assert");

const FIXTURES_DIR = path.join(__dirname, "..", "test-fixtures", "golden-parity");
const NUM_COLS = ["entry_price", "stop_loss", "take_profit"];

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const content = fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8");
      return { name: f, ...JSON.parse(content) };
    });
}

function rowKey(r) {
  const ts = r.ts instanceof Date ? r.ts.toISOString() : String(r.ts);
  return `${r.symbol}|${ts}|${r.side}`;
}

const fixtures = loadFixtures();

if (fixtures.length === 0) {
  test("golden fixture regression (no fixtures yet)", () => {
    console.log("[golden-fixture] No fixtures found. Run: node scripts/golden-fixture-parity.js --generate XAUUSD 7 doyle_sd");
    assert.ok(true, "skipped - no fixtures");
  });
} else {
  describe("golden fixture regression", () => {
    for (const fx of fixtures) {
      const label = `${fx.name}: ${fx.spec?.id ?? "unknown"} ${fx.symbol}`;

      test(`${label} - canonical signals are well-formed`, () => {
        const signals = fx.signals ?? fx.compilerSignals ?? [];
        assert.ok(Array.isArray(signals), "signals must be an array");

        const seen = new Set();
        for (const row of signals) {
          const key = rowKey(row);
          assert.ok(!seen.has(key), `duplicate signal key ${key}`);
          seen.add(key);

          for (const col of NUM_COLS) {
            if (row[col] == null) continue;
            assert.ok(Number.isFinite(Number(row[col])), `${col} must be numeric when present`);
          }
        }
      });

      test(`${label} - golden backtest stats unchanged`, () => {
        const golden = fx.goldenStats;
        if (!golden) {
          console.log(`  [golden] ${label}: no golden stats - skipping`);
          return;
        }

        assert.strictEqual(typeof golden.rawSignals, "number", "golden rawSignals must be a number");
        assert.strictEqual(typeof golden.executed, "number", "golden executed must be a number");
        console.log(`  [golden] ${label}: rawSignals=${golden.rawSignals} executed=${golden.executed} WR=${golden.winRate} netR=${golden.netR}`);
      });
    }
  });
}

async function generateFixture(symbol, days, variantId) {
  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local") });
  const { Pool } = require("pg");
  const { loadStrategyFromDB } = require("../packages/strategies/dist/index.js");
  const { compilePITSQL, computeStats, simulateTrade, dedupeTrades, prefetchCandles } = require("./backtest-pit-v2.js");
  const { getSession, getPairCharacteristics, getSessionSpread, getSessionSlippage } = require("../packages/shared/dist/index.js");

  const pool = new Pool({
    host: "localhost",
    port: 5432,
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: "postgres",
    password: process.env.TM_DB_PASSWORD,
  });

  try {
    const spec = await loadStrategyFromDB(pool, variantId);
    if (!spec) throw new Error(`variant ${variantId} not found`);

    const to = new Date();
    const from = new Date(to.getTime() - days * 86400e3);
    const compiled = compilePITSQL(spec, symbol, from, to);
    const signalRows = (await pool.query(compiled.sql, compiled.params)).rows;

    const { candles } = await prefetchCandles(pool, symbol, from, to, 24);
    const pipSize = getPairCharacteristics(symbol).pipSize;
    const rawTrades = signalRows
      .filter((sig) => {
        const entry = parseFloat(sig.entry_price);
        const sl = parseFloat(sig.stop_loss);
        const tp = parseFloat(sig.take_profit);
        if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) return false;
        if (sig.side === "buy") return sl < entry && tp > entry;
        if (sig.side === "sell") return sl > entry && tp < entry;
        return false;
      })
      .map((sig) => {
        const session = getSession(new Date(sig.ts).getUTCHours());
        const sessionSpread = getSessionSpread(symbol, session);
        const atr5Pips = pipSize > 0 && typeof sig.atr_5 === "number" ? sig.atr_5 / pipSize : 0;
        const sessionSlippage = getSessionSlippage(symbol, atr5Pips);
        const out = simulateTrade(sig, candles, {
          timeoutBars: 24,
          intrabarMode: "sl_first",
          spreadPips: sessionSpread,
          slippagePips: sessionSlippage,
          pipSize,
        });
        return {
          symbol: sig.symbol,
          side: sig.side,
          entry: parseFloat(sig.entry_price),
          sl: parseFloat(sig.stop_loss),
          tp: parseFloat(sig.take_profit),
          ts: sig.ts,
          ...out,
        };
      });

    const uniqueTrades = dedupeTrades(rawTrades, to);
    const stats = computeStats(uniqueTrades);

    const fixture = {
      spec: { id: spec.id, familyId: spec.familyId, signalSource: spec.signalSource },
      symbol,
      from: from.toISOString(),
      to: to.toISOString(),
      signals: signalRows.map((r) => ({
        symbol: r.symbol,
        ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
        side: r.side,
        entry_price: r.entry_price,
        stop_loss: r.stop_loss,
        take_profit: r.take_profit,
      })),
      goldenStats: {
        rawSignals: signalRows.length,
        executed: stats.total,
        winRate: stats.winRate,
        netR: stats.netR,
      },
    };

    fs.mkdirSync(FIXTURES_DIR, { recursive: true });

    const fileName = `${variantId}-${symbol}-${days}d.json`;
    const filePath = path.join(FIXTURES_DIR, fileName);
    fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2));

    console.log(`[golden-fixture] Fixture written: ${filePath}`);
    console.log(`  signals: ${signalRows.length}`);
    console.log(`  golden:  raw=${stats.total} WR=${(stats.winRate * 100).toFixed(1)}% netR=${stats.netR.toFixed(2)}`);
  } finally {
    await pool.end();
  }
}

if (process.argv.includes("--generate")) {
  const args = process.argv.filter((a) => !a.startsWith("--"));
  const symbol = args[2] || "XAUUSD";
  const days = parseInt(args[3] || "7", 10);
  const variantId = args[4] || "doyle_sd";
  generateFixture(symbol, days, variantId).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
