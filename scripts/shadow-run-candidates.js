/**
 * Shadow runner — replays candidate signals against real 1m candle data.
 *
 * Reads candidate JSONL files (from the live pipeline), simulates each trade
 * against actual candles to determine win/loss/R-multiple regardless of gate
 * decisions. This lets us see "what if gates hadn't blocked it?"
 *
 * Usage:
 *   node scripts/shadow-run-candidates.js [--date=2026-07-15] [--strategy=watukushay_no1]
 *   node scripts/shadow-run-candidates.js --date=2026-07-15 --strategy=watukushay_no1
 *
 * Output: per-strategy summary table + detailed CSV to stdout.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");

const { getSession, getPairCharacteristics, getSessionSpread, getSessionSlippage } = require("../packages/shared/dist/index.js");

// ---------------------------------------------------------------------------
// Helpers straight from backtest-pit-v2.js
// ---------------------------------------------------------------------------
function priceFromPips(pips, pipSize) {
  return (pips ?? 0) * pipSize;
}

function hashToFloat(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0) / 4294967296;
}

function resolveIntrabar(side, entry, sl, tp, high, low, close, mode, seed) {
  if (mode === "sl_first") return "loss";
  if (mode === "tp_first") return "win";
  if (mode === "close") {
    if (side === "buy") return close >= (sl + tp) / 2 ? "win" : "loss";
    return close <= (sl + tp) / 2 ? "win" : "loss";
  }
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const total = Math.abs(tp - sl);
  let pWin;
  if (mode === "random_walk") pWin = risk / total;
  else if (mode === "momentum") pWin = reward / total;
  else return "loss";
  return hashToFloat(seed) <= pWin ? "win" : "loss";
}

function computeOutcomeR(side, effectiveEntry, closePrice, risk) {
  if (risk <= 0) return 0;
  const delta = side === "buy" ? closePrice - effectiveEntry : effectiveEntry - closePrice;
  return delta / risk;
}

function findCandleIndexAfter(candles, ts) {
  const target = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  let lo = 0, hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const t = candles[mid].ts instanceof Date ? candles[mid].ts.getTime() : new Date(candles[mid].ts).getTime();
    if (t <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function simulateTrade(candidate, candles, options = {}) {
  const symbol = candidate.symbol ?? "";
  const tsStr = candidate.ts instanceof Date ? candidate.ts.toISOString() : String(candidate.ts);
  const ts = new Date(tsStr);
  const session = getSession(ts.getUTCHours());
  const pc = getPairCharacteristics(symbol);
  const defaultPipSize = pc.pipSize || 0.0001;
  const defaultSpread = getSessionSpread(symbol, session);
  const atr5Pips = defaultPipSize > 0 ? (candidate.feature_snapshot?.atr_5 ?? 0) / defaultPipSize : undefined;
  const defaultSlippage = getSessionSlippage(symbol, atr5Pips);

  const {
    timeoutBars = 48,
    intrabarMode = "sl_first",
    spreadPips = defaultSpread,
    slippagePips = defaultSlippage,
    pipSize = defaultPipSize,
    commissionPips = pc.commissionPipsPerLot ?? 0,
  } = options;

  const future = candles.slice(findCandleIndexAfter(candles, ts));
  if (future.length > timeoutBars) future.length = timeoutBars;
  if (future.length === 0) {
    return { outcome: "timeout", outcome_r: 0, holdBars: 0, closePrice: null, effectiveEntry: null, maxAdverse: null, maxFavorable: null };
  }

  const entry = parseFloat(candidate.entry_price);
  const sl = parseFloat(candidate.stop_loss);
  const tp = parseFloat(candidate.take_profit);
  const side = candidate.side;
  const entryType = candidate.entry_type ?? "market";

  const spreadPrice = priceFromPips(spreadPips, pipSize);
  const slippagePrice = priceFromPips(slippagePips, pipSize);
  const halfSpread = spreadPrice / 2;
  const commissionPrice = priceFromPips(commissionPips / 2, pipSize);
  const cost = halfSpread + slippagePrice + commissionPrice;

  let effectiveEntry = entry;
  if (entryType === "market") {
    effectiveEntry = side === "buy" ? entry + cost : entry - cost;
  }

  let fillIndex = 0;
  if (entryType !== "market") {
    fillIndex = -1;
    for (let i = 0; i < future.length; i++) {
      const h = parseFloat(future[i].h);
      const l = parseFloat(future[i].l);
      if ((entryType === "limit" && ((side === "buy" && l <= entry) || (side === "sell" && h >= entry))) ||
          (entryType === "stop" && ((side === "buy" && h >= entry) || (side === "sell" && l <= entry)))) {
        fillIndex = i;
        effectiveEntry = side === "buy" ? entry + slippagePrice + commissionPrice : entry - slippagePrice - commissionPrice;
        break;
      }
    }
    if (fillIndex === -1) {
      return { outcome: "timeout", outcome_r: 0, holdBars: 0, closePrice: null, effectiveEntry: null, maxAdverse: null, maxFavorable: null };
    }
  }

  const risk = side === "buy" ? effectiveEntry - sl : sl - effectiveEntry;
  if (risk <= 0 || !Number.isFinite(risk)) {
    return { outcome: "invalid", outcome_r: 0, holdBars: 0, closePrice: null, effectiveEntry, maxAdverse: effectiveEntry, maxFavorable: effectiveEntry };
  }

  let maxAdverse = effectiveEntry;
  let maxFavorable = effectiveEntry;

  for (let i = fillIndex; i < future.length; i++) {
    const high = parseFloat(future[i].h);
    const low = parseFloat(future[i].l);
    const close = parseFloat(future[i].c);

    if (side === "buy") {
      if (low < maxAdverse) maxAdverse = low;
      if (high > maxFavorable) maxFavorable = high;
      const slHit = low <= sl;
      const tpHit = high >= tp;
      const slExit = sl - cost;
      const tpExit = tp - cost;

      if (slHit && tpHit) {
        const expectedOutcome = resolveIntrabar(side, effectiveEntry, sl, tp, high, low, close, intrabarMode, `${tsStr}:${side}:${i}`);
        const cp = expectedOutcome === "win" ? tpExit : slExit;
        const r = computeOutcomeR(side, effectiveEntry, cp, risk);
        return { outcome: r >= 0 ? expectedOutcome : "loss", outcome_r: r, holdBars: i + 1, closePrice: cp, effectiveEntry, maxAdverse, maxFavorable };
      }
      if (slHit) return { outcome: "loss", outcome_r: computeOutcomeR(side, effectiveEntry, slExit, risk), holdBars: i + 1, closePrice: slExit, effectiveEntry, maxAdverse, maxFavorable };
      if (tpHit) {
        const r = computeOutcomeR(side, effectiveEntry, tpExit, risk);
        return { outcome: r >= 0 ? "win" : "loss", outcome_r: r, holdBars: i + 1, closePrice: tpExit, effectiveEntry, maxAdverse, maxFavorable };
      }
    } else {
      if (high > maxAdverse) maxAdverse = high;
      if (low < maxFavorable) maxFavorable = low;
      const slHit = high >= sl;
      const tpHit = low <= tp;
      const slExit = sl + cost;
      const tpExit = tp + cost;

      if (slHit && tpHit) {
        const expectedOutcome = resolveIntrabar(side, effectiveEntry, sl, tp, high, low, close, intrabarMode, `${tsStr}:${side}:${i}`);
        const cp = expectedOutcome === "win" ? tpExit : slExit;
        const r = computeOutcomeR(side, effectiveEntry, cp, risk);
        return { outcome: r >= 0 ? expectedOutcome : "loss", outcome_r: r, holdBars: i + 1, closePrice: cp, effectiveEntry, maxAdverse, maxFavorable };
      }
      if (slHit) return { outcome: "loss", outcome_r: computeOutcomeR(side, effectiveEntry, slExit, risk), holdBars: i + 1, closePrice: slExit, effectiveEntry, maxAdverse, maxFavorable };
      if (tpHit) {
        const r = computeOutcomeR(side, effectiveEntry, tpExit, risk);
        return { outcome: r >= 0 ? "win" : "loss", outcome_r: r, holdBars: i + 1, closePrice: tpExit, effectiveEntry, maxAdverse, maxFavorable };
      }
    }
  }

  // Timeout — trade neither hit SL nor TP
  const lastClose = parseFloat(future[future.length - 1].c);
  const r = computeOutcomeR(side, effectiveEntry, lastClose, risk);
  return { outcome: "timeout", outcome_r: r, holdBars: future.length, closePrice: lastClose, effectiveEntry, maxAdverse, maxFavorable };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const targetDate = args.find(a => a.startsWith("--date="))?.split("=")[1] || new Date().toISOString().split("T")[0];
  const filterStrategy = args.find(a => a.startsWith("--strategy="))?.split("=")[1] || null;
  const intrabarMode = args.find(a => a.startsWith("--mode="))?.split("=")[1] || "sl_first";

  // Read candidates file
  const logDir = path.resolve(__dirname, "..", "apps", "web", "logs", "candidate-spool");
  const filePath = path.join(logDir, `candidates-${targetDate}.jsonl`);

  if (!fs.existsSync(filePath)) {
    console.error(`No candidates file found for ${targetDate} at ${filePath}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
  console.error(`Loaded ${lines.length} candidates from ${filePath}`);

  const candidates = lines.map(l => {
    try { return JSON.parse(l); }
    catch { return null; }
  }).filter(Boolean);

  if (filterStrategy) {
    console.error(`Filtering to strategy: ${filterStrategy}`);
  }

  // Group by strategy
  const byStrategy = {};
  for (const c of candidates) {
    if (filterStrategy && c.strategy_id !== filterStrategy) continue;
    if (!byStrategy[c.strategy_id]) byStrategy[c.strategy_id] = [];
    byStrategy[c.strategy_id].push(c);
  }

  // Collect symbols + date range needed
  const symbols = new Set();
  let minTs = Infinity, maxTs = 0;
  for (const [sid, sigs] of Object.entries(byStrategy)) {
    for (const s of sigs) {
      symbols.add(s.symbol);
      const t = new Date(s.ts).getTime();
      if (t < minTs) minTs = t;
      if (t > maxTs) maxTs = t;
    }
  }

  if (symbols.size === 0) {
    console.log("No candidates matched.");
    process.exit(0);
  }

  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432"),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });

  // Fetch 1m candles for all needed symbols
  const from = new Date(minTs - 3600000).toISOString(); // 1h buffer before
  const to = new Date(maxTs + 86400000).toISOString();   // until end of day
  const symList = Array.from(symbols).map(s => `'${s.replace(/'/g, "''")}'`).join(",");

  console.error(`Fetching 1m candles for symbols=[${Array.from(symbols).join(",")}] from=${from} to=${to}...`);

  const { rows: candleRows } = await pool.query(`
    SELECT symbol, ts, o, h, l, c
    FROM market.candles_1m_canonical
    WHERE symbol IN (${symList})
      AND ts >= $1
      AND ts < $2
    ORDER BY symbol, ts
  `, [from, to]);

  console.error(`Got ${candleRows.length} 1m candle rows`);

  // Index candles by symbol
  const candlesBySymbol = {};
  for (const row of candleRows) {
    if (!candlesBySymbol[row.symbol]) candlesBySymbol[row.symbol] = [];
    candlesBySymbol[row.symbol].push(row);
  }

  // -----------------------------------------------------------------------
  // Simulate
  // -----------------------------------------------------------------------
  const results = [];

  for (const [strategyId, sigs] of Object.entries(byStrategy)) {
    console.error(`\nSimulating ${sigs.length} trades for ${strategyId}...`);

    for (const sig of sigs) {
      const symCandles = candlesBySymbol[sig.symbol];
      if (!symCandles || symCandles.length < 5) {
        results.push({
          strategy_id: strategyId,
          symbol: sig.symbol,
          side: sig.side,
          ts: sig.ts,
          entry_price: sig.entry_price,
          stop_loss: sig.stop_loss,
          take_profit: sig.take_profit,
          entry_type: sig.entry_type ?? "market",
          live_decision: sig.decision_stage,
          live_reason: sig.decision_reason,
          simulated_outcome: "no_data",
          simulated_r: null,
          holdBars: null,
          effectiveEntry: null,
        });
        continue;
      }

      const simOptions = {
        timeoutBars: 48,
        intrabarMode,
        pipSize: getPairCharacteristics(sig.symbol).pipSize || 0.0001,
      };

      const result = simulateTrade(sig, symCandles, simOptions);
      results.push({
        strategy_id: strategyId,
        symbol: sig.symbol,
        side: sig.side,
        ts: sig.ts,
        entry_price: sig.entry_price,
        stop_loss: sig.stop_loss,
        take_profit: sig.take_profit,
        entry_type: sig.entry_type ?? "market",
        live_decision: sig.decision_stage,
        live_reason: sig.decision_reason,
        simulated_outcome: result.outcome,
        simulated_r: result.outcome_r,
        holdBars: result.holdBars,
        effectiveEntry: result.effectiveEntry,
        maxAdverse: result.maxAdverse,
        maxFavorable: result.maxFavorable,
      });
    }
  }

  await pool.end();

  // -----------------------------------------------------------------------
  // Output
  // -----------------------------------------------------------------------
  // Summary by strategy
  const summary = {};
  for (const r of results) {
    if (!summary[r.strategy_id]) summary[r.strategy_id] = { total: 0, wins: 0, losses: 0, timeouts: 0, noData: 0, netR: 0, totalR: 0 };
    const s = summary[r.strategy_id];
    s.total++;
    if (r.simulated_outcome === "no_data") { s.noData++; continue; }
    if (r.simulated_outcome === "timeout" || r.simulated_outcome === "invalid") { s.timeouts++; continue; }
    if (r.simulated_outcome === "win") s.wins++;
    else s.losses++;
    s.netR += (r.simulated_r ?? 0);
    s.totalR += Math.abs(r.simulated_r ?? 0);
  }

  console.log("\n" + "=".repeat(120));
  console.log("SHADOW RUN RESULTS — Date: " + targetDate + " | Intrabar: " + intrabarMode);
  console.log("=".repeat(120));

  console.log("\n--- STRATEGY SUMMARY ---");
  console.log(`${"Strategy".padEnd(25)} ${"Total".padEnd(6)} ${"Wins".padEnd(5)} ${"Losses".padEnd(7)} ${"TO".padEnd(4)} ${"NoData".padEnd(7)} ${"WR%".padEnd(6)} ${"Net R".padEnd(8)} ${"Avg R".padEnd(7)}`);
  console.log("-".repeat(80));
  for (const [sid, s] of Object.entries(summary)) {
    const meaningful = s.total - s.noData - s.timeouts;
    const wr = meaningful > 0 ? ((s.wins / meaningful) * 100).toFixed(1) : "N/A";
    const avgR = (s.wins + s.losses) > 0 ? (s.netR / (s.wins + s.losses)).toFixed(2) : "N/A";
    console.log(`${sid.padEnd(25)} ${String(s.total).padEnd(6)} ${String(s.wins).padEnd(5)} ${String(s.losses).padEnd(7)} ${String(s.timeouts).padEnd(4)} ${String(s.noData).padEnd(7)} ${String(wr).padEnd(6)} ${s.netR.toFixed(2).padEnd(8)} ${String(avgR).padEnd(7)}`);
  }

  console.log("\n--- PER-TRADE DETAIL (top 50) ---");
  console.log(`${"Strategy".padEnd(22)} ${"Sym".padEnd(7)} ${"Side".padEnd(5)} ${"TS".padEnd(22)} ${"Entry".padEnd(10)} ${"SL".padEnd(10)} ${"TP".padEnd(10)} ${"Live".padEnd(12)} ${"Shadow".padEnd(10)} ${"R".padEnd(8)} ${"Held"}`);
  console.log("-".repeat(140));
  let shown = 0;
  for (const r of results) {
    if (shown >= 50) { console.log(`... and ${results.length - shown} more`); break; }
    shown++;
    console.log(`${(r.strategy_id || "").padEnd(22)} ${(r.symbol || "").padEnd(7)} ${(r.side || "").padEnd(5)} ${(r.ts || "").padEnd(22)} ${String(r.entry_price ?? "").padEnd(10)} ${String(r.stop_loss ?? "").padEnd(10)} ${String(r.take_profit ?? "").padEnd(10)} ${(r.live_decision || "").padEnd(12)} ${(r.simulated_outcome || "").padEnd(10)} ${(r.simulated_r != null ? r.simulated_r.toFixed(2) : "N/A").padEnd(8)} ${r.holdBars != null ? String(r.holdBars) : "N/A"}`);
  }

  // Bottom-line
  const all = Object.values(summary).reduce((a, s) => ({ total: a.total + s.total, wins: a.wins + s.wins, losses: a.losses + s.losses, timeouts: a.timeouts + s.timeouts, noData: a.noData + s.noData, netR: a.netR + s.netR }), { total: 0, wins: 0, losses: 0, timeouts: 0, noData: 0, netR: 0 });
  const meaningful = all.total - all.noData - all.timeouts;
  console.log("\n" + "=".repeat(120));
  console.log(`TOTAL: ${all.total} candidates | ${all.wins}W / ${all.losses}L / ${all.timeouts}TO / ${all.noData}ND | WR: ${meaningful > 0 ? ((all.wins / meaningful) * 100).toFixed(1) : "N/A"}% | Net R: ${all.netR.toFixed(2)}`);
  console.log("=".repeat(120));
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
