require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { structureFeature, detectCausalStructure } = require("../apps/engine/dist/features/structure.js");
const { pivotFeature } = require("../apps/engine/dist/features/pivot.js");

const symbols = (process.env.PARITY_SYMBOLS || "EURUSD,GBPJPY,XAUUSD").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const days = Number(process.env.PARITY_DAYS || 30);
const tf = process.env.PARITY_TF || "1h";
const tableByTf = { "5m": "market.candles_5m_canonical", "15m": "market.candles_15m_canonical", "1h": "market.candles_1h_canonical" };
if (!Object.hasOwn(tableByTf, tf)) throw new Error(`Unsupported PARITY_TF: ${tf}`);
const candleTable = tableByTf[tf];
const reportStamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.resolve(process.cwd(), process.env.PARITY_OUTPUT || `reports/structure-event-comparison-${tf}-${reportStamp}.json`);
const pool = new Pool({ host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres", password: process.env.TM_DB_PASSWORD, max: 1 });
const htf = { direction: "neutral", confidence: 0, state: "BLOCK", score: 0, reason: "parity_read_only" };
const iso = (x) => x instanceof Date ? x.toISOString() : x;

(async () => {
  const results = [];
  for (const symbol of symbols) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN READ ONLY");
      const q = await db.query(`SELECT ts,o,h,l,c,COALESCE(v,0) v FROM ${candleTable} WHERE symbol=$1 AND ts>=now()-($2::int*interval '1 day')-interval '20 hours' ORDER BY ts`, [symbol, days]);
      const candles = q.rows.map((r) => ({ symbol, ts: new Date(r.ts), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v }));
      if (!candles.length) { results.push({ symbol, status: "NO_CANDLES" }); await db.query("ROLLBACK"); continue; }
      const pivot = pivotFeature.compute({ candles }, { tf });
      const input = { candles, features_pivot: pivot, features_atr: { values: [{ period: 14, value: 0 }] }, features_htf_bias: htf };
      const endTs = candles.at(-1).ts;
      const legacy = structureFeature.compute(input, { tf, endTs }).events;
      const traceByCandle = new Map();
      const causal = detectCausalStructure(input, {
        symbol,
        tf,
        endTs,
        trace: (snapshot) => traceByCandle.set(snapshot.candleTs.getTime(), snapshot),
      }).events;
      const legacyRows = legacy.map((e) => ({ ...e, ts: iso(e.ts) }));
      const causalRows = causal.map((e) => {
        const source = pivot.pivots.find((_, i) => `${pivot.pivots[i].ts.getTime()}|${pivot.pivots[i].kind}|${pivot.pivots[i].price}|${i}` === e.levelId);
        const trace = traceByCandle.get(e.eventTs.getTime());
        return {
          ...e,
          eventTs: iso(e.eventTs),
          availableAt: iso(e.availableAt),
          sourceScale: e.sourceScale ?? source?.scale,
          sourceConfirmationTs: iso(e.sourceConfirmationTs ?? source?.confirmationTs),
          sourceCenterTs: iso(e.sourceCenterTs ?? source?.ts),
          sourceKind: e.sourceKind ?? source?.kind,
          trendDirectionAtBreak: trace?.trend,
          establishedTrendAtBreak: trace?.establishedTrend,
          laterPivotExists: pivot.pivots.some((p) => p.ts.getTime() > e.eventTs.getTime()),
        };
      });
      const classified = causalRows.map((e) => {
        const match = legacyRows.find((l) => l.eventType === e.eventType && l.direction === e.direction && Math.abs(new Date(l.ts).getTime() - new Date(e.eventTs).getTime()) <= 3600000 && Math.abs(Number(l.level) - Number(e.level)) < 1e-8);
        return { ...e, classification: match ? "MATCHES_LEGACY" : "CAUSAL_ONLY" };
      });
      const counts = classified.reduce((a, e) => ((a[e.classification] = (a[e.classification] || 0) + 1), a), {});
      results.push({ symbol, status: "OK", candles: candles.length, pivots: pivot.pivots.length, legacy: legacyRows, causal: classified, classificationCounts: counts });
      await db.query("ROLLBACK");
    } finally { db.release(); }
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ mode: "read_only", tf, days, results }, null, 2));
  console.log(JSON.stringify({ output, summary: results.map((r) => ({ symbol: r.symbol, status: r.status, legacy: r.legacy?.length, causal: r.causal?.length, classificationCounts: r.classificationCounts })) }, null, 2));
  await pool.end();
})().catch((e) => { console.error(e); process.exitCode = 1; });
