require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const { pivotFeature } = require("../apps/engine/dist/features/pivot.js");
const { detectCausalStructure } = require("../apps/engine/dist/features/structure.js");

const symbol = process.env.TRACE_SYMBOL || "EURUSD";
const tf = process.env.TRACE_TF || "5m";
const from = new Date(process.env.TRACE_FROM || "2026-07-26T20:00:00Z");
const to = new Date(process.env.TRACE_TO || "2026-07-26T21:30:00Z");
const tables = { "5m": "market.candles_5m_canonical", "15m": "market.candles_15m_canonical", "1h": "market.candles_1h_canonical" };
const tfMs = { "5m": 300000, "15m": 900000, "1h": 3600000 };
if (!tables[tf]) throw new Error(`Unsupported TRACE_TF: ${tf}`);
const pool = new Pool({ host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres", password: process.env.TM_DB_PASSWORD, max: 1 });
const compact = (p) => ({ id: p.levelId, price: p.price, kind: p.kind, scale: p.scale, centerTs: p.centerTs?.toISOString() ?? p.ts?.toISOString(), confirmationTs: p.confirmationTs?.toISOString(), availableAt: p.availableAt?.toISOString() });

(async () => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ ONLY");
    const q = await db.query(`SELECT ts,o,h,l,c,COALESCE(v,0) v FROM ${tables[tf]} WHERE symbol=$1 AND ts >= $2::timestamptz - interval '2 days' AND ts <= $3::timestamptz + interval '2 days' ORDER BY ts`, [symbol, from, to]);
    const candles = q.rows.map((r) => ({ symbol, ts: new Date(r.ts), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v }));
    const pivot = pivotFeature.compute({ candles }, { tf });
    const trace = [];
    const out = detectCausalStructure({ candles, features_pivot: pivot, features_atr: { values: [{ period: 14, value: 0 }] }, features_htf_bias: { direction: "neutral", confidence: 0, state: "BLOCK", score: 0, reason: "trace" } }, { symbol, tf, endTs: new Date(to.getTime() + tfMs[tf]), trace: (s) => {
      if (s.candleTs >= from && s.candleTs <= to) trace.push({ ts: s.candleTs.toISOString(), activeLevels: s.activeLevels.map(compact), brokenLevels: s.brokenLevels, trend: s.trend, establishedTrend: s.establishedTrend, events: s.events });
    } });
    console.log(JSON.stringify({ symbol, tf, from, to, targetPivots: pivot.pivots.filter((p) => Math.abs(p.price - 1.13701) < 1e-8).map(compact), trace, finalEvents: out.events }, null, 2));
    await db.query("ROLLBACK");
  } finally { db.release(); await pool.end(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
