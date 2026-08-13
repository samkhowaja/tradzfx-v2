// Decision-file scaffold generator (READ-ONLY). Emits a review-ready decision file in
// EXACTLY the shape apply-quarantine-decisions.js consumes, pre-filled with rubric-based
// SUGGESTED dispositions. NOT for apply until a human reviews and sets humanReviewed=true.
//
// Suggestion logic (from adjudication-policy-v4 section7 rubric):
//   FX majors (EUR/GBP/JPY/CHF/AUD/NZD/CAD): coMoveCount>=1 OR dxySign=confirm -> KEEP
//   USDSEK: dxySign=confirm -> KEEP (thin-tape baseline; isolated allowed on DXY-confirm)
//   XAUUSD: event-cluster (coMoveCount>=1) OR dxySign=confirm -> KEEP; isolated idiosyncratic -> review
//   DXY non-boundary: handled separately (formula check); left for human here
//   everything else -> UNKNOWN_EVENT (stays blocking; never auto-KEEP)
//
// Output: reports/adjudication-decisions-v4-2026-08-13.scaffold.json  (zero DB writes)
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');

const MAJORS = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD']);

const grid = JSON.parse(fs.readFileSync('reports/corroboration-v4-2026-08-13.json', 'utf8')).grid;

function suggest(g) {
  const co = g.coMoveCount >= 1, dxyOk = g.dxySign === 'confirm';
  if (MAJORS.has(g.symbol)) {
    if (co || dxyOk) return { d: 'KEEP', why: co ? `cross-symbol co-move (${g.coMoveCount} peers: ${(g.coSymbols || []).join(',')})` : 'DXY-confirm' };
    return { d: 'UNKNOWN_EVENT', why: 'isolated major jump, no peer/DXY corroboration' };
  }
  if (g.symbol === 'USDSEK') {
    if (dxyOk) return { d: 'KEEP', why: 'DXY-confirm (thin-tape baseline)' };
    return { d: 'UNKNOWN_EVENT', why: 'isolated SEK, no DXY-confirm' };
  }
  if (g.symbol === 'XAUUSD') {
    if (co) return { d: 'KEEP', why: `event-cluster membership (${g.coMoveCount} peers)` };
    if (dxyOk) return { d: 'KEEP', why: 'DXY-confirm' };
    return { d: 'UNKNOWN_EVENT', why: 'idiosyncratic gold move; needs external/event corroboration' };
  }
  if (g.symbol === 'DXY') return { d: 'UNKNOWN_EVENT', why: 'DXY non-boundary; needs component formula check' };
  return { d: 'UNKNOWN_EVENT', why: 'no rubric rule' };
}

const proposals = [];
let keep = 0, unk = 0;
for (const g of grid) {
  const s = suggest(g);
  if (s.d === 'KEEP') keep++; else unk++;
  proposals.push({
    quarantineId: g.quarantineId, symbol: g.symbol, broker: g.broker, eventTime: g.eventTime,
    flags: g.flags, jumpAtr: g.jumpAtr, session: g.session,
    coMoveCount: g.coMoveCount, coSymbols: g.coSymbols, dxySign: g.dxySign,
    currentDecision: 'UNKNOWN', proposedDecision: s.d, basis: `[SUGGESTED-v4-rubric] ${s.why}`,
    humanReviewed: false, // MUST be flipped to true per-row after manual review before any --apply
  });
}

const out = {
  generatedAt: new Date().toISOString(), readOnly: true, scaffoldOnly: true,
  warning: 'SUGGESTED dispositions only. humanReviewed=false on every row. Do NOT pass to apply-quarantine-decisions.js until a human reviews, adjusts, and sets humanReviewed=true. UNKNOWN_EVENT rows are never batch-applied.',
  sourceReports: { grid: 'adjudication-grid-v4-2026-08-13.json', corroboration: 'corroboration-v4-2026-08-13.json' },
  summary: { total: proposals.length, suggestedKEEP: keep, suggestedUNKNOWN_EVENT: unk },
  proposals,
};
fs.writeFileSync('reports/adjudication-decisions-v4-2026-08-13.scaffold.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.summary, null, 2));
