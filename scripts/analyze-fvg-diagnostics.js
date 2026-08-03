/**
 * Causal FVG diagnostics. Research only; does not change engine or DB.
 * Usage: node scripts/analyze-fvg-diagnostics.js --symbols=XAUUSD,EURUSD --tfs=5m,15m,1h --days=90 --output=reports/fvg-diagnostics
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { detectRawFvgs, getCandles, getPairCharacteristics } = require("../packages/shared/dist/index.js");

function arg(name, fallback) {
  const hit = process.argv.find((v) => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const symbols = arg("symbols", "XAUUSD,EURUSD,GBPUSD").split(",").map((s) => s.trim()).filter(Boolean);
const tfs = arg("tfs", "5m,15m,1h").split(",").map((s) => s.trim()).filter(Boolean);
const days = Number(arg("days", "90"));
const outputDir = path.resolve(process.cwd(), arg("output", "reports/fvg-diagnostics"));
const pool = new Pool({ host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || "tradzfx_v2", user: "postgres", password: process.env.TM_DB_PASSWORD });
const tfMinutes = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };

function atrAt(candles, index, period = 14) {
  if (index < period) return null;
  const trs = [];
  for (let i = index - period + 1; i <= index; i++) {
    const prevClose = candles[i - 1]?.c ?? candles[i].o;
    trs.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - prevClose), Math.abs(candles[i].l - prevClose)));
  }
  return trs.reduce((sum, value) => sum + value, 0) / trs.length;
}
function percentile(value, values) {
  if (values.length < 10) return null;
  const sorted = [...values].sort((a, b) => a - b);
  let rank = 0;
  for (const item of sorted) if (item <= value) rank++;
  return rank / sorted.length;
}
function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
function bucket(value, edges) {
  if (!Number.isFinite(value)) return "unknown";
  for (let i = 0; i < edges.length; i++) if (value < edges[i]) return `<${edges[i]}`;
  return `${edges[edges.length - 1]}+`;
}
function groupedOutcomes(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
    const terminal = group.filter((row) => row.outcome === "mitigated" || row.outcome === "invalidated");
    const mitigated = group.filter((row) => row.outcome === "mitigated").length;
    const invalidated = group.filter((row) => row.outcome === "invalidated").length;
    const touched = group.filter((row) => row.firstTouchAt).length;
    return [key, {
      count: group.length,
      touched,
      touchRate: touched / group.length,
      mitigated,
      invalidated,
      terminalCount: terminal.length,
      mitigationRate: terminal.length ? mitigated / terminal.length : null,
      invalidationRate: terminal.length ? invalidated / terminal.length : null,
    }];
  }));
}
function session(ts) {
  const hour = new Date(ts).getUTCHours();
  if (hour <= 6) return "ASIA";
  if (hour <= 11) return "LONDON";
  if (hour <= 15) return "OVERLAP";
  if (hour <= 20) return "NY";
  return "OFF_HOURS";
}
function outcome(fvg, candles) {
  const height = fvg.top - fvg.bottom;
  let firstTouchAt = null;
  let fullFillAt = null;
  let invalidatedAt = null;
  for (let i = fvg.formationIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    const touched = c.l <= fvg.top && c.h >= fvg.bottom;
    if (!firstTouchAt && touched) firstTouchAt = c.ts;
    const penetration = fvg.direction === "bullish" ? Math.max(0, fvg.top - c.l) : Math.max(0, c.h - fvg.bottom);
    if (!fullFillAt && height > 0 && penetration >= height) fullFillAt = c.ts;
    const invalid = fvg.direction === "bullish" ? c.c < fvg.bottom : c.c > fvg.top;
    if (!invalidatedAt && invalid) invalidatedAt = c.ts;
    if (fullFillAt || invalidatedAt) break;
  }
  return { firstTouchAt, fullFillAt, invalidatedAt, outcome: invalidatedAt ? "invalidated" : fullFillAt ? "mitigated" : firstTouchAt ? "touched" : "untouched" };
}
async function run(symbol, tf) {
  const end = new Date();
  const from = new Date(end.getTime() - days * 86400000);
  const warmup = Math.max(100, 14 + 20);
  const candles = await getCandles(pool, symbol, tf, new Date(from.getTime() - warmup * tfMinutes[tf] * 60000), end, { allowRealtimeFallback: true });
  const fvgs = detectRawFvgs(candles);
  const priorGaps = [];
  const rows = [];
  for (const fvg of fvgs) {
    const ts = fvg.formationTs;
    if (ts < from) { priorGaps.push(fvg.top - fvg.bottom); continue; }
    const i = fvg.formationIndex;
    const atr = atrAt(candles, i);
    const c2 = candles[i - 1];
    const range = c2.h - c2.l;
    const body = Math.abs(c2.c - c2.o);
    const avgBody = candles.slice(Math.max(0, i - 20), i).reduce((s, c) => s + Math.abs(c.c - c.o), 0) / Math.max(1, Math.min(20, i));
    const gapSize = fvg.top - fvg.bottom;
    const result = outcome(fvg, candles);
    const lastAvailableTs = candles[candles.length - 1]?.ts;
    const rightCensored = !result.fullFillAt && !result.invalidatedAt && lastAvailableTs && new Date(lastAvailableTs).getTime() - new Date(ts).getTime() < 20 * tfMinutes[tf] * 60000;
    rows.push({ symbol, tf, ts, direction: fvg.direction, top: fvg.top, bottom: fvg.bottom, gapSize, formationAtr14: atr, gapAtrRatio: atr ? gapSize / atr : null, middleBodyRatio: range > 0 ? body / range : 0, middleBodyAtr: atr ? body / atr : null, middleBodyVsAverage: avgBody > 0 ? body / avgBody : null, directionAligned: fvg.direction === "bullish" ? c2.c > c2.o : c2.c < c2.o, gapPercentile: percentile(gapSize, priorGaps.slice(-100)), session: session(ts), rightCensored, ...result });
    priorGaps.push(gapSize);
  }
  const measurable = rows.filter((r) => !r.rightCensored);
  const ratios = measurable.map((r) => r.gapAtrRatio);
  const bodyRatios = measurable.map((r) => r.middleBodyRatio);
  return {
    symbol,
    tf,
    candleCount: candles.length,
    fvgCount: rows.length,
    measurableCount: measurable.length,
    summary: {
      gapAtrRatio: { p25: quantile(ratios, 0.25), p50: quantile(ratios, 0.5), p75: quantile(ratios, 0.75), p90: quantile(ratios, 0.9) },
      middleBodyRatio: { p25: quantile(bodyRatios, 0.25), p50: quantile(bodyRatios, 0.5), p75: quantile(bodyRatios, 0.75), p90: quantile(bodyRatios, 0.9) },
      outcomes: Object.fromEntries(["touched", "mitigated", "invalidated", "untouched"].map((name) => [name, measurable.filter((r) => r.outcome === name).length])),
      rightCensoredCount: rows.length - measurable.length,
      byGapAtr: groupedOutcomes(measurable, (r) => bucket(r.gapAtrRatio, [0.1, 0.2, 0.3, 0.5, 0.75])),
      byBodyRatio: groupedOutcomes(measurable, (r) => bucket(r.middleBodyRatio, [0.4, 0.6, 0.8])),
      bySession: groupedOutcomes(measurable, (r) => r.session),
      byDirection: groupedOutcomes(measurable, (r) => r.direction),
    },
    rows,
  };
}
(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  for (const symbol of symbols) for (const tf of tfs) {
    const result = await run(symbol, tf);
    results.push(result);
    console.log(`[fvg-diagnostics] ${symbol} ${tf}: ${result.fvgCount} FVGs from ${result.candleCount} candles`);
  }
  const manifest = { generatedAt: new Date().toISOString(), symbols, tfs, days, atrPeriod: 14, percentileLookback: 100, outcomeHorizon: "available candles through run end", source: "canonical getCandles", results };
  fs.writeFileSync(path.join(outputDir, "fvg-diagnostics.json"), JSON.stringify(manifest, null, 2));
  await pool.end();
})().catch(async (error) => { console.error(error.stack || error); await pool.end(); process.exitCode = 1; });
