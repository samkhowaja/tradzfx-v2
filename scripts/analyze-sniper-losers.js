/**
 * Analyze sniper 10R losing trades:
 * - MAE/MFE distribution
 * - Re-simulate losses with wider SLs (fixed original TP distance)
 * - Time/session breakdown
 *
 * Usage:
 *   node scripts/analyze-sniper-losers.js <path/to/sniper10r_trades.json>
 */
const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 5,
});

const PIP = 0.01; // XAUUSD
const TP_PIPS = 100; // original sniper TP distance
const TIMEOUT_BARS = 480;

function isFill(side, entryType, entry, high, low) {
  if (entryType === "market") return true;
  if (entryType === "limit") {
    return side === "buy" ? low <= entry : high >= entry;
  }
  if (entryType === "stop") {
    return side === "buy" ? high >= entry : low <= entry;
  }
  return false;
}

async function resimulate(t, slPips, tpPips = TP_PIPS) {
  const entry = t.entry;
  const side = t.side;
  const entryType = t.entryType ?? "market";
  const sl = side === "buy" ? entry - slPips * PIP : entry + slPips * PIP;
  const tp = side === "buy" ? entry + tpPips * PIP : entry - tpPips * PIP;
  const ts = new Date(t.ts).toISOString();
  const { rows: candles } = await pool.query(
    `SELECT ts, h, l, c FROM market.candles_1m_canonical
     WHERE symbol = $1 AND ts > $2
     ORDER BY ts LIMIT $3`,
    [t.symbol, ts, TIMEOUT_BARS]
  );

  let fillIndex = 0;
  if (entryType !== "market") {
    fillIndex = -1;
    for (let i = 0; i < candles.length; i++) {
      if (isFill(side, entryType, entry, parseFloat(candles[i].h), parseFloat(candles[i].l))) {
        fillIndex = i;
        break;
      }
    }
    if (fillIndex === -1) return { outcome: "no_fill", holdBars: candles.length };
  }

  for (let i = fillIndex; i < candles.length; i++) {
    const high = parseFloat(candles[i].h);
    const low = parseFloat(candles[i].l);
    if (side === "buy") {
      if (low <= sl) return { outcome: "loss", holdBars: i + 1 };
      if (high >= tp) return { outcome: "win", holdBars: i + 1 };
    } else {
      if (high >= sl) return { outcome: "loss", holdBars: i + 1 };
      if (low <= tp) return { outcome: "win", holdBars: i + 1 };
    }
  }
  return { outcome: "timeout", holdBars: candles.length };
}

async function resimulateConstantRR(t, slPips, tpPips) {
  return resimulate(t, slPips, tpPips);
}

async function attachFeatures(t) {
  const ts = new Date(t.ts).toISOString();
  const feat = {};
  const pit = async (table, tf, cols) => {
    const { rows } = await pool.query(
      `SELECT ${cols.join(", ")} FROM ${table} WHERE symbol = $1 AND tf = $2 AND ts <= $3 ORDER BY ts DESC LIMIT 1`,
      [t.symbol, tf, ts]
    );
    return rows[0] ?? null;
  };
  feat.bias = await pit("features_bias", "15m", ["direction", "confidence"]);
  feat.zone = await pit("features_zone", "15m", ["zone_kind", "fill_pct", "age_bars", "strength_score", "quality_score", "is_fresh"]);
  feat.ob = await pit("features_order_block", "15m", ["ob_kind", "fill_pct", "age_bars", "strength_score"]);
  feat.ifvg = await pit("features_ifvg", "5m", ["direction", "fill_pct", "age_bars", "strength_score", "is_fresh"]);
  feat.structure = await pit("features_structure", "5m", ["event_type"]);
  return feat;
}

function bucketReport(name, trades, accessor, buckets, fmt = (x) => x.toFixed(2)) {
  console.log(`\n${name}:`);
  for (const [lo, hi] of buckets) {
    const kept = trades.filter((t) => {
      const v = accessor(t);
      if (v == null) return false;
      return v >= lo && (hi === Infinity ? true : v < hi);
    });
    const wins = kept.filter((t) => t.outcome === "win").length;
    const losses = kept.filter((t) => t.outcome === "loss").length;
    const net = wins * 10 - losses;
    const label = hi === Infinity ? `${fmt(lo)}+` : `${fmt(lo)}-${fmt(hi)}`;
    console.log(
      `  ${label}: kept=${kept.length} wins=${wins} losses=${losses} WR=${losses + wins > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "N/A"}% netR=${net.toFixed(0)}`
    );
  }
}

async function main() {
  const file = process.argv[2] || "sniper10r_trades.json";
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  let result;
  for (const l of lines) {
    try { result = JSON.parse(l); } catch (e) {}
  }
  if (!result) {
    console.error("No JSON result found in", file);
    await pool.end();
    process.exit(1);
  }

  const trades = result.trades || [];
  const losses = trades.filter((t) => t.outcome === "loss");

  const mae = (t) =>
    t.side === "buy"
      ? (t.entry - t.maxAdverse) / PIP
      : (t.maxAdverse - t.entry) / PIP;
  const mfe = (t) =>
    t.side === "buy"
      ? (t.maxFavorable - t.entry) / PIP
      : (t.entry - t.maxFavorable) / PIP;

  console.log("=== Sniper 10R loser analysis ===");
  console.log(`Total executed: ${trades.length}, losses: ${losses.length}`);
  console.log(
    `avgHoldBars is in 1m bars (~${(result.avgHoldBars / 60).toFixed(1)}h avg hold)`
  );

  const sortedMae = losses.map(mae).sort((a, b) => a - b);
  console.log(
    `Loss MAE (pips): min=${sortedMae[0].toFixed(1)} median=${sortedMae[
      Math.floor(sortedMae.length / 2)
    ].toFixed(1)} p95=${sortedMae[
      Math.floor(sortedMae.length * 0.95)
    ].toFixed(1)} max=${sortedMae[sortedMae.length - 1].toFixed(1)}`
  );

  const sortedMfe = losses.map(mfe).sort((a, b) => a - b);
  console.log(
    `Loss MFE (pips): min=${sortedMfe[0].toFixed(1)} median=${sortedMfe[
      Math.floor(sortedMfe.length / 2)
    ].toFixed(1)} p95=${sortedMfe[
      Math.floor(sortedMfe.length * 0.95)
    ].toFixed(1)} max=${sortedMfe[sortedMfe.length - 1].toFixed(1)}`
  );

  const sameBarTp = losses.filter((t) => mfe(t) >= TP_PIPS);
  console.log(
    `Losses where 1m candle also hit TP (SL-first ambiguity): ${sameBarTp.length}/${losses.length}`
  );

  // MAE buckets
  const buckets = [
    [0, 20],
    [20, 30],
    [30, 50],
    [50, 100],
    [100, 200],
    [200, 500],
    [500, 1000],
    [1000, Infinity],
  ];
  console.log("\nMAE buckets (pips):");
  for (const [lo, hi] of buckets) {
    const c = losses.filter((t) => {
      const x = mae(t);
      return x > lo && x <= hi;
    }).length;
    console.log(`  ${lo}-${hi === Infinity ? "+" : hi}: ${c}`);
  }

  // Re-simulate losses with wider SLs (fixed 100-pip TP)
  const slWidths = [15, 20, 30, 40, 100];
  console.log("\nWhat-if SL widening (fixed 100-pip TP, no gates):");
  for (const sl of slWidths) {
    let wins = 0;
    let stillLosses = 0;
    let timeouts = 0;
    for (const t of losses) {
      const out = await resimulate(t, sl);
      if (out.outcome === "win") wins++;
      else if (out.outcome === "loss") stillLosses++;
      else timeouts++;
    }
    // Original net R contribution from these 105 losses: -105R.
    // Converted wins contribute +10R each, remaining losses contribute -sl/10 R each.
    const netFromLosers = wins * 10 + stillLosses * (-sl / 10);
    const netChangeVsOriginal = netFromLosers - (-losses.length);
    console.log(
      `  SL=${sl}pips -> wins=${wins} stillLoss=${stillLosses} timeouts=${timeouts} | netR from losers=${netFromLosers.toFixed(1)} (Δ${netChangeVsOriginal >= 0 ? "+" : ""}${netChangeVsOriginal.toFixed(1)})`
    );
  }

  // What-if with constant 10R (TP scales with SL)
  console.log("\nWhat-if SL widening while keeping 10R (TP = SL*10, no gates):");
  for (const sl of slWidths) {
    const tpPips = sl * 10;
    let wins = 0;
    let stillLosses = 0;
    let timeouts = 0;
    for (const t of losses) {
      const out = await resimulateConstantRR(t, sl, tpPips);
      if (out.outcome === "win") wins++;
      else if (out.outcome === "loss") stillLosses++;
      else timeouts++;
    }
    const netFromLosers = wins * 10 + stillLosses * -1;
    const netChangeVsOriginal = netFromLosers - (-losses.length);
    console.log(
      `  SL=${sl}pips TP=${tpPips}pips -> wins=${wins} stillLoss=${stillLosses} timeouts=${timeouts} | netR from losers=${netFromLosers.toFixed(1)} (Δ${netChangeVsOriginal >= 0 ? "+" : ""}${netChangeVsOriginal.toFixed(1)})`
    );
  }

  // Pre-entry 1m candle range analysis
  console.log("\nPre-entry 1m candle range (signal candle, pips):");
  const ranges = { win: [], loss: [] };
  const rangeMap = new Map();
  for (const t of trades) {
    const ts = new Date(t.ts).toISOString();
    const { rows } = await pool.query(
      `SELECT h, l FROM market.candles_1m_canonical WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
      [t.symbol, ts]
    );
    const range = rows.length ? (parseFloat(rows[0].h) - parseFloat(rows[0].l)) / PIP : Infinity;
    rangeMap.set(t.ts + t.side + t.entry, range);
    if (t.outcome === "win") ranges.win.push(range);
    if (t.outcome === "loss") ranges.loss.push(range);
  }
  function sumStats(arr) {
    const s = arr.sort((a, b) => a - b);
    return {
      median: s[Math.floor(s.length / 2)],
      p95: s[Math.floor(s.length * 0.95)],
      avg: s.reduce((a, b) => a + b, 0) / s.length,
    };
  }
  const winStats = sumStats(ranges.win);
  const lossStats = sumStats(ranges.loss);
  console.log(`  wins:   n=${ranges.win.length} avg=${winStats.avg.toFixed(1)} median=${winStats.median.toFixed(1)} p95=${winStats.p95.toFixed(1)}`);
  console.log(`  losses: n=${ranges.loss.length} avg=${lossStats.avg.toFixed(1)} median=${lossStats.median.toFixed(1)} p95=${lossStats.p95.toFixed(1)}`);

  const thresholds = [10, 20, 30, 50, 100];
  console.log("\nHypothetical pre-entry 1m range filter (skip if prev-candle range > threshold):");
  for (const th of thresholds) {
    const kept = trades.filter((t) => (rangeMap.get(t.ts + t.side + t.entry) ?? Infinity) <= th);
    const wins = kept.filter((t) => t.outcome === "win").length;
    const losses = kept.filter((t) => t.outcome === "loss").length;
    const net = wins * 10 - losses;
    console.log(
      `  maxRange<=${th}pips: kept=${kept.length} wins=${wins} losses=${losses} WR=${((wins / (wins + losses)) * 100).toFixed(1)}% netR=${net.toFixed(0)}`
    );
  }

  // Pre-entry 15m candle range analysis
  console.log("\nPre-entry 15m candle range (pips):");
  const ranges15 = { win: [], loss: [] };
  const range15Map = new Map();
  for (const t of trades) {
    const ts = new Date(t.ts).toISOString();
    const { rows } = await pool.query(
      `SELECT h, l FROM market.candles_15m_canonical WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
      [t.symbol, ts]
    );
    const range = rows.length ? (parseFloat(rows[0].h) - parseFloat(rows[0].l)) / PIP : Infinity;
    range15Map.set(t.ts + t.side + t.entry, range);
    if (t.outcome === "win") ranges15.win.push(range);
    if (t.outcome === "loss") ranges15.loss.push(range);
  }
  const winStats15 = sumStats(ranges15.win);
  const lossStats15 = sumStats(ranges15.loss);
  console.log(`  wins:   n=${ranges15.win.length} avg=${winStats15.avg.toFixed(1)} median=${winStats15.median.toFixed(1)} p95=${winStats15.p95.toFixed(1)}`);
  console.log(`  losses: n=${ranges15.loss.length} avg=${lossStats15.avg.toFixed(1)} median=${lossStats15.median.toFixed(1)} p95=${lossStats15.p95.toFixed(1)}`);

  const thresholds15 = [50, 100, 150, 200, 300, 500];
  console.log("\nHypothetical pre-entry 15m range filter (skip if prev-candle range > threshold):");
  for (const th of thresholds15) {
    const kept = trades.filter((t) => (range15Map.get(t.ts + t.side + t.entry) ?? Infinity) <= th);
    const wins = kept.filter((t) => t.outcome === "win").length;
    const losses = kept.filter((t) => t.outcome === "loss").length;
    const net = wins * 10 - losses;
    console.log(
      `  maxRange15<=${th}pips: kept=${kept.length} wins=${wins} losses=${losses} WR=${((wins / (wins + losses)) * 100).toFixed(1)}% netR=${net.toFixed(0)}`
    );
  }

  // Feature-strength / freshness analysis
  console.log("\nAttaching signal-time features...");
  for (const t of trades) {
    t.features = await attachFeatures(t);
  }

  function featureStats(name, accessor) {
    const vals = trades.map(accessor).filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
    if (!vals.length) return;
    console.log(`${name}: n=${vals.length} min=${vals[0].toFixed(3)} max=${vals[vals.length - 1].toFixed(3)} median=${vals[Math.floor(vals.length / 2)].toFixed(3)} p95=${vals[Math.floor(vals.length * 0.95)].toFixed(3)}`);
  }
  console.log("\nFeature value scales:");
  featureStats("zone.fill_pct", (t) => t.features.zone?.fill_pct);
  featureStats("zone.age_bars", (t) => t.features.zone?.age_bars);
  featureStats("zone.strength_score", (t) => t.features.zone?.strength_score);
  featureStats("zone.quality_score", (t) => t.features.zone?.quality_score);
  featureStats("ob.strength_score", (t) => t.features.ob?.strength_score);
  featureStats("ob.fill_pct", (t) => t.features.ob?.fill_pct);
  featureStats("ob.age_bars", (t) => t.features.ob?.age_bars);
  featureStats("ifvg.fill_pct", (t) => t.features.ifvg?.fill_pct);
  featureStats("ifvg.age_bars", (t) => t.features.ifvg?.age_bars);
  featureStats("ifvg.strength_score", (t) => t.features.ifvg?.strength_score);
  featureStats("bias.confidence", (t) => t.features.bias?.confidence);

  bucketReport("HTF zone strength_score buckets", trades, (t) => t.features.zone?.strength_score, [[0, 0.5], [0.5, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.75], [0.75, 1.0]]);
  bucketReport("HTF zone quality_score buckets", trades, (t) => t.features.zone?.quality_score, [[0, 0.78], [0.78, 0.79], [0.79, 0.795], [0.795, 0.8], [0.8, 1.0]]);
  bucketReport("HTF OB strength_score buckets", trades, (t) => t.features.ob?.strength_score, [[0, 0.2], [0.2, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.0]]);
  bucketReport("HTF OB age_bars buckets", trades, (t) => t.features.ob?.age_bars, [[0, 100], [100, 200], [200, 300], [300, 400], [400, Infinity]]);
  bucketReport("LTF iFVG strength_score buckets", trades, (t) => t.features.ifvg?.strength_score, [[0, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.0]]);
  bucketReport("LTF iFVG age_bars buckets", trades, (t) => t.features.ifvg?.age_bars, [[0, 10], [10, 20], [20, 30], [30, 40], [40, 50]]);
  bucketReport("Bias confidence buckets", trades, (t) => t.features.bias?.confidence, [[0, 60], [60, 70], [70, 80], [80, 100]]);

  // Filters combining multiple weak signals
  const freshnessFilters = [
    { name: "zone fresh AND ifvg fresh", fn: (t) => t.features.zone?.is_fresh === true && t.features.ifvg?.is_fresh === true },
    { name: "zone strength >= 0.65 AND ifvg strength >= 0.8", fn: (t) => (t.features.zone?.strength_score ?? 0) >= 0.65 && (t.features.ifvg?.strength_score ?? 0) >= 0.8 },
    { name: "zone strength >= 0.7 AND ifvg strength >= 0.9", fn: (t) => (t.features.zone?.strength_score ?? 0) >= 0.7 && (t.features.ifvg?.strength_score ?? 0) >= 0.9 },
    { name: "ifvg age <= 10 bars", fn: (t) => (t.features.ifvg?.age_bars ?? Infinity) <= 10 },
    { name: "ifvg age <= 20 bars", fn: (t) => (t.features.ifvg?.age_bars ?? Infinity) <= 20 },
    { name: "ifvg age <= 30 bars", fn: (t) => (t.features.ifvg?.age_bars ?? Infinity) <= 30 },
    { name: "bias confidence >= 80", fn: (t) => (t.features.bias?.confidence ?? 0) >= 80 },
    { name: "ob strength >= 0.5 AND ifvg strength >= 0.8", fn: (t) => (t.features.ob?.strength_score ?? 0) >= 0.5 && (t.features.ifvg?.strength_score ?? 0) >= 0.8 },
    { name: "ob age <= 200 bars", fn: (t) => (t.features.ob?.age_bars ?? Infinity) <= 200 },
    { name: "zone quality >= 0.79", fn: (t) => (t.features.zone?.quality_score ?? 0) >= 0.79 },
    { name: "zone quality >= 0.79 AND zone strength >= 0.6", fn: (t) => (t.features.zone?.quality_score ?? 0) >= 0.79 && (t.features.zone?.strength_score ?? 0) >= 0.6 },
    { name: "zone quality >= 0.79 AND iFVG age 20-40 bars", fn: (t) => (t.features.zone?.quality_score ?? 0) >= 0.79 && (t.features.ifvg?.age_bars ?? 0) >= 20 && (t.features.ifvg?.age_bars ?? 0) < 40 },
    { name: "zone quality >= 0.79 AND iFVG strength 0.6-0.8", fn: (t) => (t.features.zone?.quality_score ?? 0) >= 0.79 && (t.features.ifvg?.strength_score ?? 0) >= 0.6 && (t.features.ifvg?.strength_score ?? 0) < 0.8 },
    { name: "zone quality >= 0.79 AND exclude 10:00/16:00 UTC", fn: (t) => (t.features.zone?.quality_score ?? 0) >= 0.79 && ![10, 16].includes(new Date(t.ts).getUTCHours()) },
    { name: "HTF zone kind = demand/supply", fn: (t) => ["demand", "supply"].includes(t.features.zone?.zone_kind) },
    { name: "HTF zone kind = demand/supply AND iFVG strength 0.6-0.8", fn: (t) => ["demand", "supply"].includes(t.features.zone?.zone_kind) && (t.features.ifvg?.strength_score ?? 0) >= 0.6 && (t.features.ifvg?.strength_score ?? 0) < 0.8 },
    { name: "HTF zone kind = demand/supply AND exclude 10:00/16:00 UTC", fn: (t) => ["demand", "supply"].includes(t.features.zone?.zone_kind) && ![10, 16].includes(new Date(t.ts).getUTCHours()) },
    { name: "HTF zone kind = demand/supply AND iFVG age 20-40 bars", fn: (t) => ["demand", "supply"].includes(t.features.zone?.zone_kind) && (t.features.ifvg?.age_bars ?? 0) >= 20 && (t.features.ifvg?.age_bars ?? 0) < 40 },
  ];
  console.log("\nComposite feature filters:");
  for (const f of freshnessFilters) {
    const kept = trades.filter(f.fn);
    const wins = kept.filter((t) => t.outcome === "win").length;
    const losses = kept.filter((t) => t.outcome === "loss").length;
    const net = wins * 10 - losses;
    console.log(
      `  ${f.name}: kept=${kept.length} wins=${wins} losses=${losses} WR=${losses + wins > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "N/A"}% netR=${net.toFixed(0)}`
    );
  }

  // Session / hour breakdown
  const sess = (h) => (h < 8 ? "asian" : h < 17 ? "london" : "ny");
  const byHour = {};
  for (const t of trades) {
    const h = new Date(t.ts).getUTCHours();
    byHour[h] = byHour[h] || { t: 0, w: 0, l: 0 };
    byHour[h].t++;
    if (t.outcome === "win") byHour[h].w++;
    if (t.outcome === "loss") byHour[h].l++;
  }
  console.log("\nPerformance by UTC hour:");
  for (let h = 0; h < 24; h++) {
    if (!byHour[h]) continue;
    const b = byHour[h];
    console.log(
      `  ${h.toString().padStart(2, "0")}:00  trades=${b.t} wins=${b.w} losses=${b.l} WR=${(
        (b.w / (b.w + b.l)) * 100
      ).toFixed(1)}%`
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  pool.end();
  process.exit(1);
});
