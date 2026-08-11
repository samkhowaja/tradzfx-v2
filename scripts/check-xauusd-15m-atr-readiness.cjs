#!/usr/bin/env node
/** Read-only, fail-closed XAUUSD 15m ATR readiness check. */
require("dotenv").config({ path: ".env.local", override: true });
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

function args(argv) {
  const out = {};
  for (const a of argv) {
    const i = a.indexOf("=");
    if (!a.startsWith("--") || i < 0) throw new Error(`Expected --name=value, got ${a}`);
    out[a.slice(2, i).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a.slice(i + 1);
  }
  if (!out.from || !out.to) throw new Error("Usage: node scripts/check-xauusd-15m-atr-readiness.cjs --from=ISO --to=ISO [--period=14]");
  if (Date.parse(out.from) >= Date.parse(out.to)) throw new Error("--to must be after --from");
  out.period = Number(out.period || 14);
  return out;
}

function tradableXau(ts) {
  const d = new Date(ts); const dow = d.getUTCDay(); const h = d.getUTCHours(); const m = d.getUTCMinutes();
  if (dow === 6 || (dow === 0 && h < 21) || (dow === 5 && h >= 21)) return false;
  if (h === 21 || (h === 20 && m >= 50) || (h === 22 && m < 5)) return false;
  return true;
}

(async () => {
  const p = args(process.argv.slice(2)); const pool = new Pool(getDbConfig());
  try {
    const [bars, atr] = await Promise.all([
      pool.query(`SELECT ts FROM market.candles_15m_canonical WHERE symbol='XAUUSD' AND ts >= $1 AND ts < $2 ORDER BY ts`, [p.from, p.to]),
      pool.query(`SELECT ts,value,effective_value,is_valid,engine_ver FROM features_atr WHERE symbol='XAUUSD' AND tf='15m' AND period=$3 AND ts >= $1 AND ts < $2 ORDER BY ts`, [p.from, p.to, p.period]),
    ]);
    const child = await pool.query(`
      SELECT c.ts,c.broker,
             (l.ingestion_run_id IS NOT NULL) AS has_run_evidence,
             l.ingestion_run_id,
             COALESCE(l.bindings,0)::int AS bindings,
             COALESCE(e.state,'UNKNOWN') AS eligibility_state
        FROM candles_1m c
        LEFT JOIN LATERAL (
          SELECT ingestion_run_id,count(*) OVER () AS bindings
            FROM market.candle_producer_lineage
           WHERE symbol='XAUUSD' AND broker=c.broker AND candle_ts=c.ts
             AND voided_at IS NULL AND ingestion_run_id IS NOT NULL
           ORDER BY lineage_id DESC LIMIT 1
        ) l ON true
        LEFT JOIN LATERAL (
          SELECT state FROM market.candle_eligibility
           WHERE symbol='XAUUSD' AND broker=c.broker AND timeframe='1m' AND ts=c.ts
           ORDER BY updated_at DESC NULLS LAST LIMIT 1
        ) e ON true
       WHERE c.symbol='XAUUSD' AND c.ts >= $1 AND c.ts < $2 ORDER BY c.ts`, [p.from, p.to]);
    const byTs = new Map(child.rows.map((r) => [new Date(r.ts).toISOString(), r]));
    const issues = [];
    for (const b of bars.rows) {
      const start = new Date(b.ts); const missing = [];
      for (let i = 0; i < 15; i++) { const ts = new Date(start.getTime() + i * 60000); if (tradableXau(ts) && !byTs.has(ts.toISOString())) missing.push(ts.toISOString()); }
      const rows = Array.from({ length: 15 }, (_, i) => byTs.get(new Date(start.getTime() + i * 60000).toISOString())).filter(Boolean);
      const bad = rows.filter((r) => !r.has_run_evidence || r.bindings !== 1 || !['CLEAN', 'PERSISTED'].includes(r.eligibility_state));
      if (missing.length || bad.length) issues.push({ ts: new Date(b.ts).toISOString(), missing_children: missing, invalid_children: bad.map((r) => ({ ts: r.ts, has_run_evidence: r.has_run_evidence, ingestion_run_id: r.ingestion_run_id == null ? null : String(r.ingestion_run_id), bindings: r.bindings, eligibility_state: r.eligibility_state })) });
    }
    const result = { report_version: 'xauusd-15m-atr-readiness-v1-readonly', generated_at: new Date().toISOString(), filters: { symbol: 'XAUUSD', timeframe: '15m', from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString(), period: p.period }, decision: issues.length === 0 && bars.rowCount > 0 && atr.rowCount > 0 ? 'READY' : 'BLOCKED', fail_closed: true, counts: { canonical_15m_bars: bars.rowCount, atr_rows: atr.rowCount, child_1m_rows: child.rowCount, blocked_15m_bars: issues.length }, blockers: { lineage_or_eligibility: issues.filter((x) => x.invalid_children.length).length, missing_children_or_calendar: issues.filter((x) => x.missing_children.length).length, quarantine: 'UNKNOWN (no quarantine evidence table)', canonical: '15m source table presence only; certification requires child proof' }, issues };
    console.log(JSON.stringify(result, null, 2));
  } finally { await pool.end(); }
})().catch((e) => { console.error(`READINESS_FAILED: ${e.message}`); process.exit(1); });
