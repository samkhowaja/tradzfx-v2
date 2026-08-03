#!/usr/bin/env node
/** Read-only PIT outcome analysis for progressive DAG-v2 shadow setups. */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local"), quiet: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { simulateTrade } = require("./backtest-pit-v2.js");

const ROOT = path.join(__dirname, "..");
const PLAN_ID = "xauusd_liquidity_confirmed_bos_shadow_v2";
const CONTRACT = Object.freeze({
  version: "progressive-outcome-v3",
  availability: "confirmed BOS becomes actionable after confirmation_ts 15m candle completes",
  entry: "first canonical 1m open after confirmation_ts + 14 minutes",
  atr: "latest valid features_atr@15m period 14 with ts <= confirmation_ts",
  stop: "1.0 ATR from entry",
  target: "2.0R from entry",
  timeout: "120 canonical 1m candles (8 x 15m)",
  intrabar: "sl_first",
  costs: "zero",
});

function parseDays(argv = process.argv.slice(2)) {
  const raw = (argv.find((value) => value.startsWith("--days=")) || "--days=90").slice(7);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 3650) throw new Error("--days must be an integer from 1 to 3650");
  return Number(raw);
}

function buildGeometry(setup, atr, firstCandle) {
  const side = setup.side;
  const entry = Number(firstCandle?.o);
  const distance = Number(atr?.effective_value ?? atr?.value);
  if (side !== "buy" && side !== "sell") return { blocker: "invalid_side" };
  if (!firstCandle || !Number.isFinite(entry) || entry <= 0) return { blocker: "missing_entry_candle" };
  if (!atr || atr.is_valid === false || !Number.isFinite(distance) || distance <= 0) return { blocker: "missing_valid_atr" };
  const stopLoss = side === "buy" ? entry - distance : entry + distance;
  const takeProfit = side === "buy" ? entry + distance * 2 : entry - distance * 2;
  return { entry, stopLoss, takeProfit, risk: distance };
}

function summarize(trades) {
  const resolved = trades.filter((trade) => trade.outcome === "win" || trade.outcome === "loss");
  const wins = resolved.filter((trade) => trade.outcome === "win").length;
  const losses = resolved.length - wins;
  const timeouts = trades.filter((trade) => trade.outcome === "timeout").length;
  const invalid = trades.filter((trade) => trade.outcome === "invalid").length;
  const netR = resolved.reduce((sum, trade) => sum + Number(trade.r || 0), 0);
  const grossWinR = resolved.filter((trade) => Number(trade.r) > 0).reduce((sum, trade) => sum + Number(trade.r), 0);
  const grossLossR = Math.abs(resolved.filter((trade) => Number(trade.r) < 0).reduce((sum, trade) => sum + Number(trade.r), 0));
  let equity = 0, peak = 0, maxDrawdownR = 0;
  for (const trade of resolved) { equity += Number(trade.r || 0); peak = Math.max(peak, equity); maxDrawdownR = Math.max(maxDrawdownR, peak - equity); }
  return {
    trades: trades.length, resolved: resolved.length, wins, losses, timeouts, invalid,
    winRate: resolved.length ? wins / resolved.length : null,
    netR, expectancyR: resolved.length ? netR / resolved.length : null,
    profitFactor: grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? null : 0,
    maxDrawdownR,
  };
}

function monthlySummary(trades) {
  const buckets = new Map();
  for (const trade of trades) {
    const key = new Date(trade.signalTs).toISOString().slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(trade);
  }
  return Object.fromEntries([...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => [key, summarize(rows)]));
}

async function loadInputs(pool, days) {
  const edgeResult = await pool.query("SELECT MAX(ts) AS ts FROM market.candles_1m_canonical WHERE symbol='XAUUSD'");
  if (!edgeResult.rows[0]?.ts) throw new Error("XAUUSD canonical 1m data clock unavailable");
  const to = new Date(edgeResult.rows[0].ts);
  const from = new Date(to.getTime() - days * 86_400_000);
  const setupResult = await pool.query(
    `WITH selected_plan AS (
       SELECT plan_hash FROM progressive_plan_registry
       WHERE strategy_id=$1 ORDER BY registered_at DESC LIMIT 1
     )
     SELECT i.setup_instance_id,i.plan_hash,i.side,n.source_ts,n.source_key,n.evidence_json,s.confirmation_ts
     FROM progressive_setup_instance i
     JOIN selected_plan p USING(plan_hash)
     JOIN progressive_setup_node n USING(setup_instance_id)
     JOIN LATERAL (
       SELECT confirmation_ts FROM features_structure s
       WHERE s.symbol=n.source_symbol AND s.tf=n.source_tf AND s.ts=n.source_ts
         AND s.event_type='bos' AND s.confirmed=true
         AND s.direction=CASE i.side WHEN 'buy' THEN 'bullish' ELSE 'bearish' END
       ORDER BY ABS(s.level-(n.evidence_json->'values'->>'level')::double precision),s.confirmation_ts
       LIMIT 1
     ) s ON true
     WHERE i.strategy_id=$1 AND i.status='entry_ready' AND n.node_id='structure_confirm'
       AND n.status='satisfied' AND n.source_ts >= $2 AND n.source_ts < $3
       AND s.confirmation_ts IS NOT NULL
     ORDER BY n.source_ts,i.setup_instance_id`,
    [PLAN_ID, from, to],
  );
  const [atrResult, candleResult] = await Promise.all([
    pool.query(
      `SELECT ts,period,value,effective_value,is_valid,input_hash,engine_ver
       FROM features_atr WHERE symbol='XAUUSD' AND tf='15m' AND period=14
         AND ts >= $1::timestamptz - interval '24 hours' AND ts <= $2::timestamptz ORDER BY ts`,
      [from, to],
    ),
    pool.query(
      `SELECT ts,o,h,l,c FROM market.candles_1m_canonical
       WHERE symbol='XAUUSD' AND ts > $1::timestamptz AND ts <= $2::timestamptz ORDER BY ts`,
      [from, to],
    ),
  ]);
  return { from, to, setups: setupResult.rows, atr: atrResult.rows, candles: candleResult.rows };
}

function latestAsOf(rows, ts) {
  const target = new Date(ts).getTime();
  let found = null;
  for (const row of rows) { if (new Date(row.ts).getTime() > target) break; found = row; }
  return found;
}

function firstAfter(rows, ts) {
  const target = new Date(ts).getTime();
  return rows.find((row) => new Date(row.ts).getTime() > target) || null;
}

function evaluateInputs(input, options = {}) {
  const atrMultiplier = options.atrMultiplier ?? 1;
  const rewardMultiple = options.rewardMultiple ?? 2;
  const timeoutBars = options.timeoutBars ?? 120;
  const trades = [], blockers = {};
  for (const setup of input.setups) {
    const sourceTs = new Date(setup.source_ts);
    const confirmationTs = new Date(setup.confirmation_ts);
    if (!Number.isFinite(confirmationTs.getTime()) || confirmationTs <= sourceTs) {
      blockers.missing_valid_confirmation = (blockers.missing_valid_confirmation || 0) + 1; continue;
    }
    const decisionTs = new Date(confirmationTs.getTime() + 14 * 60_000);
    const atr = latestAsOf(input.atr, confirmationTs);
    const firstCandle = firstAfter(input.candles, decisionTs);
    const baseGeometry = buildGeometry(setup, atr, firstCandle);
    if (baseGeometry.blocker) { blockers[baseGeometry.blocker] = (blockers[baseGeometry.blocker] || 0) + 1; continue; }
    const risk = baseGeometry.risk * atrMultiplier;
    const stopLoss = setup.side === "buy" ? baseGeometry.entry - risk : baseGeometry.entry + risk;
    const takeProfit = setup.side === "buy" ? baseGeometry.entry + risk * rewardMultiple : baseGeometry.entry - risk * rewardMultiple;
    const result = simulateTrade({
      symbol: "XAUUSD", ts: decisionTs, side: setup.side, entry_type: "market",
      entry_price: baseGeometry.entry, stop_loss: stopLoss, take_profit: takeProfit,
    }, input.candles, { timeoutBars, intrabarMode: "sl_first", executionModel: "next_bar_bid_ask" });
    trades.push({
      setupInstanceId: setup.setup_instance_id, planHash: setup.plan_hash,
      sourceTs: sourceTs.toISOString(), confirmationTs: confirmationTs.toISOString(), signalTs: decisionTs.toISOString(),
      confirmationLagMinutes: (confirmationTs.getTime() - sourceTs.getTime()) / 60_000,
      evidenceHash: setup.evidence_json?.evidenceHash ?? null, sourceKey: setup.source_key,
      side: setup.side, atrTs: new Date(atr.ts).toISOString(), atrInputHash: atr.input_hash,
      atr: baseGeometry.risk, atrMultiplier, rewardMultiple, timeoutBars,
      authoredEntry: baseGeometry.entry, stopLoss, takeProfit,
      ...result,
    });
  }
  return { funnel: { entryReady: input.setups.length, geometryValid: trades.length, blocked: input.setups.length - trades.length }, blockers, trades, summary: summarize(trades), monthly: monthlySummary(trades) };
}

function sensitivityMatrix(input) {
  const rows = [];
  for (const atrMultiplier of [0.75, 1, 1.25, 1.5]) {
    for (const rewardMultiple of [1.5, 2, 2.5, 3]) {
      for (const timeoutBars of [60, 120, 240]) {
        const result = evaluateInputs(input, { atrMultiplier, rewardMultiple, timeoutBars });
        rows.push({ atrMultiplier, rewardMultiple, timeoutBars, ...result.summary });
      }
    }
  }
  return rows;
}

function walkForward(trades) {
  const ordered = [...trades].sort((a, b) => Date.parse(a.signalTs) - Date.parse(b.signalTs));
  const split = Math.floor(ordered.length * 0.6);
  return {
    method: "chronological 60/40 split; descriptive only; no parameter fitting",
    train: { from: ordered[0]?.signalTs ?? null, to: ordered[split - 1]?.signalTs ?? null, ...summarize(ordered.slice(0, split)) },
    test: { from: ordered[split]?.signalTs ?? null, to: ordered.at(-1)?.signalTs ?? null, ...summarize(ordered.slice(split)) },
  };
}

async function main() {
  const days = parseDays();
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD, application_name: "tradzfx-progressive-shadow-backtest", max: 1,
  });
  try {
    const input = await loadInputs(pool, days);
    const evaluated = evaluateInputs(input);
    const payload = {
      generatedAt: new Date().toISOString(), researchOnly: true, executionConnected: false,
      planId: PLAN_ID, window: { days, from: input.from.toISOString(), to: input.to.toISOString() },
      contract: CONTRACT, ...evaluated,
      walkForward: walkForward(evaluated.trades), sensitivity: sensitivityMatrix(input),
    };
    const out = path.join(ROOT, "reports", `progressive-shadow-backtest-${days}d.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(JSON.stringify({ report: out, funnel: payload.funnel, blockers: payload.blockers, summary: payload.summary, monthly: payload.monthly }, null, 2));
  } finally { await pool.end(); }
}

module.exports = { CONTRACT, buildGeometry, evaluateInputs, firstAfter, latestAsOf, monthlySummary, parseDays, sensitivityMatrix, summarize, walkForward };
if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
