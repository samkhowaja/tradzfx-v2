#!/usr/bin/env node
/** Attribute shadow disagreement to rolling normalization versus ATR winsorization. */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const WINDOW = 1000;
function pct(n, d) { return d ? `${(100 * n / d).toFixed(2)}%` : "0.00%"; }
function rank(window, value) { return window.filter(v => v <= value).length / window.length; }
function decisionMatrix(rows, left, right) {
  const out = { pp: 0, pb: 0, bp: 0, bb: 0 };
  for (const row of rows) out[(row[left] ? "p" : "b") + (row[right] ? "p" : "b")]++;
  return out;
}

async function main() {
  const symbol = (process.argv[2] || "XAUUSD").toUpperCase();
  const tf = process.argv[3] || "5m";
  const period = Number(process.argv[4] || 5);
  const outputPath = process.argv[5] || path.resolve("reports", `VOLATILITY_SHADOW_ATTRIBUTION_${symbol}_${tf}_2026-07-19.md`);
  const pool = new Pool({ host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres", password: process.env.TM_DB_PASSWORD, max: 2 });
  const { rows } = await pool.query(
    `WITH profile AS (
       SELECT DISTINCT ON (session) session, p95
       FROM market_volatility_profile WHERE symbol=$1 AND tf=$2 AND period=$3
       ORDER BY session, lookback_days DESC
     )
     SELECT v.ts, v.session, v.atr_raw / v.pip_size AS raw_pips,
            v.atr_pips AS effective_pips, v.percentile_rank AS effective_rank,
            v.is_valid, p.p95, EXISTS (
              SELECT 1 FROM backtest_results b
              WHERE b.symbol=v.symbol AND b.tf=v.tf AND b.ts=v.ts
            ) AS trade_anchor
       FROM features_volatility_normalized v LEFT JOIN profile p USING(session)
      WHERE v.symbol=$1 AND v.tf=$2 AND v.period=$3
      ORDER BY v.ts`, [symbol, tf, period]);

  const windows = new Map();
  const valid = [];
  for (const row of rows) {
    const values = windows.get(row.session) || [];
    values.push(Number(row.raw_pips));
    if (values.length > WINDOW) values.shift();
    windows.set(row.session, values);
    if (!row.is_valid || row.p95 == null || row.effective_rank == null || values.length < 100) continue;
    row.staticEffective = Number(row.effective_pips) <= Number(row.p95);
    row.causalEffective = Number(row.effective_rank) <= 0.95;
    row.causalRaw = rank(values, Number(row.raw_pips)) <= 0.95;
    valid.push(row);
  }
  const normalization = decisionMatrix(valid, "staticEffective", "causalEffective");
  const winsorization = decisionMatrix(valid, "causalRaw", "causalEffective");
  const tradeRows = valid.filter(r => r.trade_anchor);
  const tradeNormalization = decisionMatrix(tradeRows, "staticEffective", "causalEffective");
  const disagreements = m => m.pb + m.bp;
  const lines = [
    `# Volatility Shadow Attribution — ${symbol} ${tf}`, "",
    `**Generated:** ${new Date().toISOString()}`, `**ATR period:** ${period}`, `**Causal window:** ${WINDOW} same-session observations`, "",
    "## Attribution contract", "",
    "- Static effective: current latest profile `p95` compared with `atr_effective` in pips.",
    "- Causal effective: persisted same-session rolling `percentile_rank <= 0.95`.",
    "- Causal raw: reconstructed same-session rolling rank from `atr_raw` using identical 1,000-row window.",
    "- Static versus causal effective isolates profile policy/window/timing effects. Causal raw versus causal effective isolates ATR winsorization effects.", "",
    "## Decision attribution", "",
    "| Comparison | Anchors | Both pass | Left pass/right block | Left block/right pass | Both block | Disagreement |",
    "|---|---:|---:|---:|---:|---:|---:|",
    `| Static effective vs causal effective | ${valid.length} | ${normalization.pp} | ${normalization.pb} | ${normalization.bp} | ${normalization.bb} | ${disagreements(normalization)} (${pct(disagreements(normalization),valid.length)}) |`,
    `| Causal raw vs causal effective | ${valid.length} | ${winsorization.pp} | ${winsorization.pb} | ${winsorization.bp} | ${winsorization.bb} | ${disagreements(winsorization)} (${pct(disagreements(winsorization),valid.length)}) |`, "",
    "## Persisted backtest trade anchors", "",
    `Matched ${tradeRows.length} feature anchors to at least one persisted backtest result row by exact symbol, timeframe, and timestamp. Duplicate strategy trades count once here.`, "",
    "| Anchors | Both pass | Static pass/causal block | Static block/causal pass | Both block | Disagreement |",
    "|---:|---:|---:|---:|---:|---:|",
    `| ${tradeRows.length} | ${tradeNormalization.pp} | ${tradeNormalization.pb} | ${tradeNormalization.bp} | ${tradeNormalization.bb} | ${disagreements(tradeNormalization)} (${pct(disagreements(tradeNormalization),tradeRows.length)}) |`, "",
    "## Interpretation", "",
    "This report attributes decision mechanics only. Persisted trades were generated under existing strategy/gate behavior; blocked counterfactual trades are absent. No causal economic uplift claim follows from matched-trade outcomes.", "",
    "## Promotion status", "", "**NOT READY.** Require frozen walk-forward policy, counterfactual signal capture, OOS economics, and multi-symbol evidence. Live gate remains unchanged.", "",
  ];
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n"));
  console.log(JSON.stringify({ outputPath, rows: rows.length, valid: valid.length, tradeAnchors: tradeRows.length, normalization, winsorization }, null, 2));
  await pool.end();
}
if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
module.exports = { rank, decisionMatrix };
