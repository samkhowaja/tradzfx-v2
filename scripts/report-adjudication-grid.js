// Adjudication review grid (READ-ONLY, in-memory). Fetch canonical 1m candles per
// symbol over the quarantine date range once; compute jump + ATR1m in JS.
// Output: reports/adjudication-grid-v4-2026-08-13.json/.md  (zero DB writes)
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.TM_DB_HOST, port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });

function pipSize(s){ if(s==='XAUUSD')return 0.1; if(s==='DXY')return 0.01; if(s==='USDSEK')return 0.0001; if(s.includes('JPY'))return 0.01; return 0.0001; }
function sessionOf(iso){ const h=new Date(iso).getUTCHours(); return h<7?'asia':h<13?'london':h<21?'ny':'offhours'; }

(async () => {
  const { rows: qrows } = await pool.query(
    `SELECT id, symbol, broker, event_time, flags, severity, detector_version,
            raw.effective_broker_identity(broker) AS identity
     FROM candle_quarantine
     WHERE superseded_at IS NULL AND decision='UNKNOWN' AND broker <> 'smoke-test'
     ORDER BY symbol, event_time`);

  // group quarantine rows by (symbol, identity); find global date range
  const groups = new Map();
  let minTs = null, maxTs = null;
  for (const r of qrows) {
    const k = r.symbol + '|' + r.identity;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
    const t = +new Date(r.event_time);
    if (minTs == null || t < minTs) minTs = t;
    if (maxTs == null || t > maxTs) maxTs = t;
  }
  // pad window by 40 min before earliest for ATR warm-up
  const lo = new Date(minTs - 40 * 60000), hi = new Date(maxTs + 60000);

  const grid = [];
  for (const [k, rows] of groups) {
    const [symbol, identity] = k.split('|');
    const { rows: candles } = await pool.query(
      `SELECT ts, o, h, l, c FROM market.candles_1m_canonical
       WHERE symbol=$1 AND raw.effective_broker_identity(broker)=$2
         AND ts >= $3 AND ts <= $4 ORDER BY ts`,
      [symbol, identity, lo, hi]);
    const cs = candles.map(c => ({ ts: +new Date(c.ts), o:+c.o, h:+c.h, l:+c.l, c:+c.c }));
    const byTs = new Map(cs.map(c => [c.ts, c]));
    const ps = pipSize(symbol);

    for (const r of rows) {
      const t = +new Date(r.event_time);
      const cur = byTs.get(t);
      // prev candle before t
      let prev = null; for (let i = cs.length - 1; i >= 0; i--) if (cs[i].ts < t) { prev = cs[i]; break; }
      // ATR1m(14) over trailing up-to-31 bars ending <= t
      const upto = cs.filter(c => c.ts <= t).slice(-31);
      let atr1m = null;
      if (upto.length >= 2) {
        let sum = 0, n = 0;
        for (let i = 1; i < upto.length; i++) {
          const p = upto[i - 1], x = upto[i];
          sum += Math.max(x.h - x.l, Math.abs(x.h - p.c), Math.abs(x.l - p.c)); n++;
        }
        atr1m = n ? sum / n : null;
      }
      let jumpAbs=null, jumpPct=null, jumpPips=null, jumpAtr=null, rangePips=null;
      if (cur && prev) {
        jumpAbs = +(cur.c - prev.c);
        jumpPct = prev.c !== 0 ? +((cur.c - prev.c) / prev.c * 100) : null;
        jumpPips = +(jumpAbs / ps);
        if (atr1m) jumpAtr = +(Math.abs(cur.c - prev.c) / atr1m);
      }
      if (cur) rangePips = +((cur.h - cur.l) / ps);
      grid.push({
        quarantineId: r.id, symbol, broker: r.broker, identity,
        eventTime: new Date(r.event_time).toISOString(), flags: r.flags, severity: r.severity,
        detector: r.detector_version, session: sessionOf(new Date(r.event_time).toISOString()),
        close: cur ? cur.c : null, prevClose: prev ? prev.c : null,
        jumpAbs, jumpPct, jumpPips, jumpAtr, rangePips, atr1mPips: atr1m ? +(atr1m / ps) : null,
      });
    }
  }

  const bySymbol = {};
  for (const g of grid) { if (g.jumpAtr == null) continue; (bySymbol[g.symbol] = bySymbol[g.symbol] || []).push(g.jumpAtr); }
  const dist = {};
  for (const [s, arr] of Object.entries(bySymbol)) {
    arr.sort((a, b) => a - b);
    const q = p => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    dist[s] = { n: arr.length, min: +arr[0].toFixed(1), p50: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), max: +arr[arr.length - 1].toFixed(1) };
  }
  const noMetric = grid.filter(g => g.jumpAtr == null).length;

  fs.writeFileSync('reports/adjudication-grid-v4-2026-08-13.json', JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, total: grid.length, noMetric, dist, grid }, null, 2));
  const md = ['# Adjudication Review Grid (v4) — 2026-08-13', '', `Read-only. ${grid.length} active-UNKNOWN rows; ${noMetric} lacking jump metric.`, '', '## |Δclose| / ATR₁ₘ distribution', '', '| Symbol | n | min | p50 | p90 | max |', '|---|---|---|---|---|---|'];
  for (const [s, d] of Object.entries(dist).sort()) md.push(`| ${s} | ${d.n} | ${d.min} | ${d.p50} | ${d.p90} | ${d.max} |`);
  fs.writeFileSync('reports/adjudication-grid-v4-2026-08-13.md', md.join('\n'));
  console.log(JSON.stringify({ total: grid.length, noMetric, dist }, null, 2));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
