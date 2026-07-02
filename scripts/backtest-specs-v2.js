/**
 * Quick signal-density backtest for V2 strategy specs.
 *
 * Uses the compiled strategy SQL (latest-as-of features) over a lookback window,
 * then simulates each generated signal against 1m candles. Because the compiled
 * SQL uses the latest feature rows, older signals benefit from lookahead; treat
 * results as indicative only. For a true point-in-time backtest use
 * pair-backtest-pit.js after backfilling historical features.
 *
 * Usage:
 *   node backtest-specs-v2.js [symbol] [days]
 *   node backtest-specs-v2.js EURUSD 30
 */

const { Pool } = require("pg");
const { loadStrategyFromYaml, compileStrategy } = require("../packages/strategies/dist/index.js");
const path = require("path");
const fs = require("fs");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 5,
});

const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");
const SPEC_FILES = [
  "doyle_sd.yaml",
  "orb_classic.yaml",
  "watukushay_no1.yaml",
  "watukushay_fe.yaml",
  "forex_strategy_orb.yaml",
  "scarface_5m_orb.yaml",
];

function formatR(r) {
  return typeof r === "number" ? r.toFixed(2) : "0.00";
}

async function simulateTrade(signal, timeoutBars) {
  const tsStr = signal.ts instanceof Date ? signal.ts.toISOString() : String(signal.ts);
  const { rows: candles } = await pool.query(
    `SELECT ts, h, l, c FROM candles_1m
     WHERE symbol = $1 AND ts > $2
     ORDER BY ts LIMIT $3`,
    [signal.symbol, tsStr, timeoutBars]
  );

  const entry = parseFloat(signal.entry_price);
  const sl = parseFloat(signal.stop_loss);
  const tp = parseFloat(signal.take_profit);
  const rr = Math.abs((tp - entry) / (entry - sl));

  for (let i = 0; i < candles.length; i++) {
    const high = parseFloat(candles[i].h);
    const low = parseFloat(candles[i].l);
    if (signal.side === "buy") {
      if (low <= sl) return { outcome: "loss", r: -1.0, holdBars: i + 1, closePrice: sl };
      if (high >= tp) return { outcome: "win", r: rr, holdBars: i + 1, closePrice: tp };
    } else {
      if (high >= sl) return { outcome: "loss", r: -1.0, holdBars: i + 1, closePrice: sl };
      if (low <= tp) return { outcome: "win", r: rr, holdBars: i + 1, closePrice: tp };
    }
  }

  const lastClose = candles.length > 0 ? parseFloat(candles[candles.length - 1].c) : entry;
  const risk = Math.abs(entry - sl);
  const r = risk > 0 ? (signal.side === "buy" ? lastClose - entry : entry - lastClose) / risk : 0;
  return { outcome: "timeout", r, holdBars: candles.length, closePrice: lastClose };
}

function computeStats(trades) {
  const wins = trades.filter((t) => t.outcome === "win");
  const losses = trades.filter((t) => t.outcome === "loss");
  const timeouts = trades.filter((t) => t.outcome === "timeout");
  const decisive = wins.length + losses.length;
  const longs = trades.filter((t) => t.side === "buy");
  const shorts = trades.filter((t) => t.side === "sell");

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    timeouts: timeouts.length,
    winRate: decisive > 0 ? wins.length / decisive : 0,
    netR: trades.reduce((s, t) => s + t.r, 0),
    avgWinR: wins.length > 0 ? wins.reduce((s, t) => s + t.r, 0) / wins.length : 0,
    avgLossR: losses.length > 0 ? losses.reduce((s, t) => s + t.r, 0) / losses.length : 0,
    longWinRate: longs.length > 0 ? longs.filter((t) => t.outcome === "win").length / longs.length : 0,
    shortWinRate: shorts.length > 0 ? shorts.filter((t) => t.outcome === "win").length / shorts.length : 0,
    longCount: longs.length,
    shortCount: shorts.length,
    avgHoldBars: trades.length > 0 ? trades.reduce((s, t) => s + t.holdBars, 0) / trades.length : 0,
  };
}

async function backtestSpec(file, symbol, days) {
  const spec = loadStrategyFromYaml(path.join(SPECS_DIR, file));
  const compiled = compileStrategy(spec, { lookbackHours: days * 24 });

  // Restrict to the requested symbol if not ALL
  let sql = compiled.sql;
  if (symbol !== "ALL") {
    sql = sql.replace(/WHERE s\.bias_direction IN \('bullish', 'bearish'\)/, `WHERE s.symbol = '${symbol}' AND s.bias_direction IN ('bullish', 'bearish')`);
  }

  const t0 = performance.now();
  const { rows: signals } = await pool.query(sql);
  const queryMs = performance.now() - t0;

  if (signals.length === 0) {
    return { specId: spec.id, signals: 0, queryMs, stats: null };
  }

  const timeoutBars = spec.risk?.timeoutBars ?? 24;
  const trades = [];
  for (const sig of signals) {
    const outcome = await simulateTrade(sig, timeoutBars);
    trades.push({
      symbol: sig.symbol,
      side: sig.side,
      entry: parseFloat(sig.entry_price),
      sl: parseFloat(sig.stop_loss),
      tp: parseFloat(sig.take_profit),
      ts: sig.ts,
      ...outcome,
    });
  }

  return { specId: spec.id, signals: signals.length, queryMs, stats: computeStats(trades), trades };
}

async function main() {
  const symbol = process.argv[2] || "EURUSD";
  const days = parseInt(process.argv[3] || "30", 10);

  console.log(`[backtest-v2] Symbol: ${symbol} | Window: ${days} days\n`);
  console.log("NOTE: This uses latest-as-of features, so older signals have lookahead.");
  console.log("Treat results as signal-density / pipeline validation only.\n");

  for (const file of SPEC_FILES) {
    try {
      const result = await backtestSpec(file, symbol, days);
      console.log(`\n${result.specId} (${file})`);
      console.log(`  Signals: ${result.signals} | Query: ${result.queryMs.toFixed(0)}ms`);
      if (!result.stats) {
        console.log("  No signals generated.");
        continue;
      }
      const s = result.stats;
      console.log(`  Trades: ${s.total} | Wins: ${s.wins} | Losses: ${s.losses} | Timeouts: ${s.timeouts}`);
      console.log(`  WR: ${(s.winRate * 100).toFixed(1)}% | Net R: ${formatR(s.netR)} | Avg Win: ${formatR(s.avgWinR)}R | Avg Loss: ${formatR(s.avgLossR)}R`);
      console.log(`  Long WR: ${(s.longWinRate * 100).toFixed(1)}% (${s.longCount}) | Short WR: ${(s.shortWinRate * 100).toFixed(1)}% (${s.shortCount})`);
      console.log(`  Avg hold: ${s.avgHoldBars.toFixed(1)} bars`);
    } catch (err) {
      console.error(`\n${file} => ERROR: ${err.message}`);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error("[backtest-v2] Fatal:", e);
  process.exit(1);
});
