// Corroboration analyzer (READ-ONLY). For each active-UNKNOWN LARGE_JUMP row, compute
// cheap corroboration evidence WITHOUT external lookups:
//   (a) cross-symbol co-movement: how many OTHER symbols quarantined at same minute
//       (same-ts cluster => systemic macro event, corroborates KEEP)
//   (b) cross-asset sign check: does DXY move opposite to a USD-pair jump at same ts
//   (c) event-window clustering: rows sharing a timestamp across symbols = one event
// Output: reports/corroboration-v4-2026-08-13.json/.md  (zero DB writes)
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.TM_DB_HOST, port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });

(async () => {
  const grid = JSON.parse(fs.readFileSync('reports/adjudication-grid-v4-2026-08-13.json', 'utf8')).grid;

  // cluster by event minute (symbol-agnostic)
  const byTs = new Map();
  for (const g of grid) { const k = g.eventTime; if (!byTs.has(k)) byTs.set(k, []); byTs.get(k).push(g); }

  // DXY move at each event minute (for sign corroboration of USD pairs)
  const dxyTs = [...new Set(grid.map(g => g.eventTime))];
  const dxyMoves = new Map();
  if (dxyTs.length) {
    const { rows } = await pool.query(
      `SELECT ts, c, lag(c) OVER (ORDER BY ts) pc FROM market.candles_1m_canonical
       WHERE symbol='DXY' AND ts = ANY($1::timestamptz[]) ORDER BY ts`, [dxyTs]);
    for (const r of rows) if (r.pc != null) dxyMoves.set(new Date(r.ts).toISOString(), +r.c - +r.pc);
  }

  const enriched = grid.map(g => {
    const cluster = byTs.get(g.eventTime);
    const coSymbols = cluster.filter(x => x.symbol !== g.symbol).map(x => x.symbol);
    const coCount = coSymbols.length;
    let dxySign = null; // 'confirm' | 'contradict' | null
    const dm = dxyMoves.get(g.eventTime);
    if (dm != null && g.symbol !== 'DXY' && g.jumpAbs != null) {
      // USD-quoted pair (EURUSD): price up => USD down => DXY should fall (opposite sign)
      // USD-base pair (USDJPY): price up => USD up => DXY should rise (same sign)
      const usdBase = g.symbol.startsWith('USD');
      const sameDir = Math.sign(dm) === Math.sign(g.jumpAbs);
      dxySign = (usdBase ? sameDir : !sameDir) ? 'confirm' : 'contradict';
    }
    return { ...g, coMoveCount: coCount, coSymbols, dxySign };
  });

  const corroborated = enriched.filter(e => e.coMoveCount >= 1 || e.dxySign === 'confirm');
  const isolated = enriched.filter(e => e.coMoveCount === 0 && e.dxySign !== 'confirm');
  const byClass = {};
  for (const e of enriched) {
    byClass[e.symbol] = byClass[e.symbol] || { n: 0, corroborated: 0, isolated: 0, dxyConfirm: 0, dxyContradict: 0 };
    const b = byClass[e.symbol]; b.n++;
    if (e.coMoveCount >= 1 || e.dxySign === 'confirm') b.corroborated++; else b.isolated++;
    if (e.dxySign === 'confirm') b.dxyConfirm++;
    if (e.dxySign === 'contradict') b.dxyContradict++;
  }

  // event-minute clusters (>=2 symbols same ts) = candidate macro events
  const events = [...byTs.entries()].filter(([, v]) => v.length >= 2)
    .map(([ts, v]) => ({ ts, symbols: v.map(x => x.symbol), count: v.length }))
    .sort((a, b) => b.count - a.count);

  const out = { generatedAt: new Date().toISOString(), readOnly: true, total: enriched.length, corroborated: corroborated.length, isolated: isolated.length, eventClusters: events.length, byClass, topEvents: events.slice(0, 25), grid: enriched };
  fs.writeFileSync('reports/corroboration-v4-2026-08-13.json', JSON.stringify(out, null, 2));

  const md = ['# Corroboration Analysis (v4) — 2026-08-13', '', `Read-only. ${enriched.length} rows; ${corroborated.length} corroborated (co-move/DXY), ${isolated.length} isolated.`, '', '## Per-symbol', '', '| Symbol | n | corroborated | isolated | DXY confirm | DXY contradict |', '|---|---|---|---|---|---|'];
  for (const [s, b] of Object.entries(byClass).sort()) md.push(`| ${s} | ${b.n} | ${b.corroborated} | ${b.isolated} | ${b.dxyConfirm} | ${b.dxyContradict} |`);
  md.push('', '## Top event-minute clusters (>=2 symbols same minute)', '', '| Timestamp (UTC) | count | symbols |', '|---|---|---|');
  for (const e of events.slice(0, 25)) md.push(`| ${e.ts} | ${e.count} | ${e.symbols.join(',')} |`);
  fs.writeFileSync('reports/corroboration-v4-2026-08-13.md', md.join('\n'));
  console.log(JSON.stringify({ total: enriched.length, corroborated: corroborated.length, isolated: isolated.length, eventClusters: events.length, byClass }, null, 2));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
