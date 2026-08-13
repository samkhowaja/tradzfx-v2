// Cluster-review view generator (READ-ONLY). Groups the scaffold's suggested-KEEP rows
// into event clusters (same-minute, multi-symbol co-moves) so a human reviews ONE unit
// per coherent event instead of per candle. Emits a cluster decision template that, once
// clusterReviewed:true is set, a flips script fans out to per-row humanReviewed:true.
// Output: reports/adjudication-clusters-v4-2026-08-13.json/.md  (zero DB writes)
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');

const scaffold = JSON.parse(fs.readFileSync('reports/adjudication-decisions-v4-2026-08-13.scaffold.json', 'utf8'));
const keep = scaffold.proposals.filter(p => p.proposedDecision === 'KEEP');

// cluster by event minute
const byTs = new Map();
for (const p of keep) { const k = p.eventTime; if (!byTs.has(k)) byTs.set(k, []); byTs.get(k).push(p); }

const clusters = [...byTs.entries()].map(([ts, rows]) => {
  const syms = [...new Set(rows.map(r => r.symbol))];
  const dxyConfirms = rows.filter(r => r.dxySign === 'confirm').length;
  const maxAtr = Math.max(...rows.map(r => r.jumpAtr || 0));
  return {
    clusterId: ts, eventTime: ts, size: rows.length, symbols: syms,
    dxyConfirms, maxJumpAtr: +maxAtr.toFixed(1),
    multiSymbol: syms.length >= 2,
    quarantineIds: rows.map(r => r.quarantineId),
    signature: syms.length >= 2 && dxyConfirms >= 1 ? 'usd-complex-event' : (syms.length >= 2 ? 'cross-symbol' : 'single-symbol'),
    clusterReviewed: false, // human flips true to approve ALL rows in cluster
    clusterDecision: 'KEEP', // human may override to UNKNOWN_EVENT per cluster
  };
}).sort((a, b) => b.size - a.size);

const multi = clusters.filter(c => c.multiSymbol);
const single = clusters.filter(c => !c.multiSymbol);
const usdComplex = clusters.filter(c => c.signature === 'usd-complex-event');

const out = {
  generatedAt: new Date().toISOString(), readOnly: true,
  note: 'Review unit = cluster. Set clusterReviewed:true (+ optional clusterDecision override) per cluster, then run the flip step to fan out to per-row humanReviewed:true in the decision file. Multi-symbol USD-complex clusters are the highest-confidence KEEP units.',
  summary: {
    keepRows: keep.length, totalClusters: clusters.length,
    multiSymbolClusters: multi.length, singleSymbolClusters: single.length,
    usdComplexClusters: usdComplex.length,
    rowsInMultiSymbol: multi.reduce((s, c) => s + c.size, 0),
    rowsInSingle: single.reduce((s, c) => s + c.size, 0),
  },
  clusters,
};
fs.writeFileSync('reports/adjudication-clusters-v4-2026-08-13.json', JSON.stringify(out, null, 2));

const md = ['# Adjudication Clusters (v4) — 2026-08-13', '', `Read-only review units. ${keep.length} KEEP rows grouped into ${clusters.length} event clusters.`, '',
  '## Summary', '', `- KEEP rows: ${keep.length}`,
  `- Event clusters: ${clusters.length} (${multi.length} multi-symbol, ${single.length} single-symbol)`,
  `- USD-complex signature clusters: ${usdComplex.length}`,
  `- Rows in multi-symbol clusters: ${out.summary.rowsInMultiSymbol} | single-symbol: ${out.summary.rowsInSingle}`, '',
  '## Top clusters by size', '', '| Cluster (UTC) | size | symbols | DXY confirms | max jumpAtr | signature |', '|---|---|---|---|---|---|'];
for (const c of clusters.slice(0, 40)) md.push(`| ${c.eventTime} | ${c.size} | ${c.symbols.join(',')} | ${c.dxyConfirms} | ${c.maxJumpAtr} | ${c.signature} |`);
fs.writeFileSync('reports/adjudication-clusters-v4-2026-08-13.md', md.join('\n'));
console.log(JSON.stringify(out.summary, null, 2));
