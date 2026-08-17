#!/usr/bin/env node
/**
 * Non-authoritative, read-only candle blocker audit.
 * Batch 1: active canonical blocker snapshot.
 * Batch 2: same-snapshot in-memory v2/v3 comparison.
 * Never writes database state. Filesystem writes are exactly two artifacts.
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');

const EDGE = '2026-08-04T07:54:00Z';
const SYMBOLS = ['USDJPY', 'USDSEK', 'XAUUSD', 'DXY'];
const TIMEFRAME = '1m';
const SAMPLE_LIMIT = 20;
const V2 = 'candle-detector-v2-recomputed';
const V3 = 'candle-detector-v3-robust-candidate';
const FLAGS = ['INVALID_OHLC', 'IMPOSSIBLE_SPREAD', 'LARGE_JUMP', 'LARGE_JUMP_ROBUST', 'UNEXPECTED_GAP'];

function iso(value) { return new Date(value).toISOString(); }
function key(r) { return [r.symbol, r.broker, r.timeframe, iso(r.ts), r.raw_source_key || `${r.symbol}|${r.broker}|${iso(r.ts)}`].join('|'); }
function flagKey(r, flag) { return `${key(r)}|${flag}`; }
function addCount(map, fields) { const k = fields.map((x) => x == null ? 'NULL' : String(x)).join('|'); map[k] = (map[k] || 0) + 1; }
function sortedObject(map) { return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b))); }
function median(values) { const a = values.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
function mad(values, center) { return median(values.map((x) => Math.abs(x - center))); }
function tradable(ts, symbol) {
  const d = new Date(ts); const dow = d.getUTCDay(); const h = d.getUTCHours();
  if (dow === 6 || (dow === 0 && h < 21) || (dow === 5 && h >= 21)) return false;
  return !(symbol === 'XAUUSD' && h === 21 && d.getUTCMinutes() === 0);
}
function gapFlag(prevTs, ts, symbol) {
  if (!prevTs || new Date(ts) - new Date(prevTs) <= 2 * 60 * 60 * 1000) return false;
  return tradable(new Date((new Date(prevTs).getTime() + new Date(ts).getTime()) / 2), symbol);
}
function category(symbol) {
  if (symbol === 'DXY') return 'dxy_synthetic';
  if (symbol === 'XAUUSD') return 'xauusd';
  if (symbol === 'USDSEK') return 'sek_exotic';
  if (symbol === 'USDJPY') return 'jpy';
  return 'fx_major';
}
function thresholds(symbol) {
  const c = category(symbol);
  return { floor: c === 'dxy_synthetic' ? 0.02 : c === 'sek_exotic' || c === 'xauusd' ? 0.01 : 0.005, madMultiplier: c === 'sek_exotic' ? 10 : 8 };
}
function detectorRows(candles, detector) {
  const groups = new Map();
  for (const c of candles) { const g = `${c.symbol}|${c.broker}|${c.timeframe}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
  const out = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    const returns = rows.slice(1).map((r, i) => Math.abs((+r.c - +rows[i].c) / (+rows[i].c || 1))).filter(Number.isFinite);
    const center = median(returns); const deviation = mad(returns, center ?? 0); const t = thresholds(rows[0].symbol);
    const v2Floor = rows[0].symbol === 'DXY' ? 0.02 : 0.005;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; const prev = rows[i - 1]; const absReturn = prev ? Math.abs((+r.c - +prev.c) / (+prev.c || 1)) : null;
      const flags = [];
      if (+r.h < +r.l || +r.h < Math.max(+r.o, +r.c) || +r.l > Math.min(+r.o, +r.c)) flags.push('INVALID_OHLC');
      if (r.spread != null && +r.spread < 0) flags.push('IMPOSSIBLE_SPREAD');
      if (absReturn != null) {
        const threshold = detector === 'v2' ? v2Floor : Math.max(t.floor, (center ?? 0) + t.madMultiplier * Math.max(deviation || 0, 1e-12));
        if (absReturn > threshold) flags.push(detector === 'v2' ? 'LARGE_JUMP' : 'LARGE_JUMP_ROBUST');
      }
      if (prev && gapFlag(prev.ts, r.ts, r.symbol)) flags.push('UNEXPECTED_GAP');
      if (flags.length) out.push({ ...r, prev_ts: prev?.ts || null, abs_return: absReturn, flags, severity: flags.includes('INVALID_OHLC') ? 'CRITICAL' : flags.some((f) => f.startsWith('LARGE_JUMP')) ? 'HIGH' : 'MEDIUM', detector });
    }
  }
  return out;
}
function explode(rows) { return rows.flatMap((r) => r.flags.map((flag) => ({ ...r, flag }))); }
function grouped(rows, fields) { const m = {}; for (const r of rows) addCount(m, fields.map((f) => r[f])); return sortedObject(m); }
function samples(rows) { return rows.slice().sort((a, b) => key(a).localeCompare(key(b))).slice(0, SAMPLE_LIMIT).map((r) => ({ symbol: r.symbol, broker: r.broker, timeframe: r.timeframe, ts: iso(r.ts), flag: r.flag, severity: r.severity, classification: r.classification })); }
function gitSha() { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } }

async function main() {
  const started = new Date().toISOString();
  const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });
  const client = await pool.connect();
  let snapshot;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query(`SELECT current_database() AS database_name, current_setting('server_version') AS server_version, current_setting('transaction_isolation') AS transaction_isolation`)).rows[0];
    const policy = await client.query(`SELECT symbol, broker_id, policy_id, priority, effective_from, effective_to FROM raw.symbol_broker_policy WHERE effective_from <= $1::timestamptz AND (effective_to IS NULL OR $1::timestamptz < effective_to) ORDER BY symbol, priority, broker_id`, [EDGE]);
    const blockers = await client.query(`
      WITH effective AS (
        SELECT DISTINCT ON (symbol) symbol, broker_id, policy_id
        FROM raw.symbol_broker_policy
        WHERE effective_from <= $1::timestamptz AND (effective_to IS NULL OR $1::timestamptz < effective_to)
        ORDER BY symbol, priority, broker_id
      )
      SELECT q.id, q.symbol, q.broker, q.timeframe, q.event_time AS ts, q.raw_source_key, q.flags, q.severity, q.decision, q.approved_at, q.approved_by, q.superseded_at,
             c.o, c.h, c.l, c.c, c.spread, c.digits
      FROM candle_quarantine q
      JOIN effective p ON p.symbol=q.symbol AND p.broker_id=q.broker
      LEFT JOIN candles_1m c ON c.symbol=q.symbol AND c.broker=q.broker AND c.ts=q.event_time
      WHERE q.timeframe='1m' AND q.event_time <= $1::timestamptz AND q.superseded_at IS NULL
        AND (q.approved_at IS NULL OR q.decision <> 'KEEP')
      ORDER BY q.symbol, q.broker, q.timeframe, q.event_time, q.id`, [EDGE]);
    const population = await client.query(`SELECT symbol, broker, '1m'::text AS timeframe, ts, o, h, l, c, spread, digits FROM candles_1m WHERE ts <= $1::timestamptz AND symbol IN (SELECT DISTINCT symbol FROM raw.symbol_broker_policy) ORDER BY symbol, broker, ts`, [EDGE]);
    snapshot = { identity, policy: policy.rows, blockers: blockers.rows, candles: population.rows };
    await client.query('ROLLBACK');
  } catch (e) { try { await client.query('ROLLBACK'); } catch {} throw e; } finally { client.release(); await pool.end(); }

  const blockerRows = snapshot.blockers;
  const blockerFlags = explode(blockerRows);
  const decision = (r) => r.approved_at == null ? 'UNRESOLVED' : r.decision === 'REPLACED' ? 'REPLACED_BLOCKING' : r.decision;
  const activeSymbols = [...new Set([...SYMBOLS, ...blockerRows.map((r) => r.symbol)])].sort();
  const b1 = {
    population: { active_blocker_rows: blockerRows.length, distinct_candle_identities: new Set(blockerRows.map(key)).size, active_symbols: activeSymbols },
    counts: { by_symbol: grouped(blockerRows, ['symbol']), by_broker: grouped(blockerRows, ['broker']), by_timeframe: grouped(blockerRows, ['timeframe']), by_flag_occurrence: grouped(blockerFlags, ['flag']), by_severity: grouped(blockerRows, ['severity']), by_decision: grouped(blockerRows.map((r) => ({ ...r, decision: decision(r) })), ['decision']), symbol_broker: grouped(blockerRows, ['symbol', 'broker']), symbol_flag: grouped(blockerFlags, ['symbol', 'flag']), symbol_decision: grouped(blockerRows.map((r) => ({ ...r, decision: decision(r) })), ['symbol', 'decision']), symbol_broker_timeframe_flag: grouped(blockerFlags, ['symbol', 'broker', 'timeframe', 'flag']), severity_decision: grouped(blockerRows.map((r) => ({ ...r, decision: decision(r) })), ['severity', 'decision']) },
    flag_semantics: { distinct_rows: blockerRows.length, distinct_identities: new Set(blockerRows.map(key)).size, exploded_flag_occurrences: blockerFlags.length },
    alternate_broker_availability: grouped(blockerRows.map((r) => ({ ...r, alternate: snapshot.candles.some((c) => c.symbol === r.symbol && c.ts.getTime?.() === r.ts.getTime?.() && c.broker !== r.broker) ? 'HAS_ALTERNATE' : 'NO_ALTERNATE' })), ['alternate']),
    superseded_report: { excluded_from_active_population: 'superseded_at IS NOT NULL', count: 0 }
  };
  const candidates = snapshot.candles.filter((r) => activeSymbols.includes(r.symbol));
  const v2 = detectorRows(candidates, 'v2'); const v3 = detectorRows(candidates, 'v3');
  const v2f = explode(v2); const v3f = explode(v3);
  const v2Map = new Map(v2f.map((r) => [flagKey(r, r.flag), r])); const v3Map = new Map(v3f.map((r) => [flagKey(r, r.flag), r]));
  const comparisons = []; for (const [k, r] of v2Map) comparisons.push({ ...r, classification: v3Map.has(k) ? 'OVERLAP' : 'V2_ONLY' }); for (const [k, r] of v3Map) if (!v2Map.has(k)) comparisons.push({ ...r, classification: 'V3_ONLY' });
  const b2 = { label: 'V3_CANDIDATE_VALIDATION', same_snapshot_population: true, detector_versions: { v2: V2, v3: V3 }, counts: { by_symbol: grouped(comparisons, ['symbol', 'classification']), by_broker: grouped(comparisons, ['broker', 'classification']), by_timeframe: grouped(comparisons, ['timeframe', 'classification']), by_flag: grouped(comparisons, ['flag', 'classification']), by_severity: grouped(comparisons, ['severity', 'classification']), full: grouped(comparisons, ['symbol', 'broker', 'timeframe', 'flag', 'severity', 'classification']) }, samples: { OVERLAP: samples(comparisons.filter((r) => r.classification === 'OVERLAP')), V2_ONLY: samples(comparisons.filter((r) => r.classification === 'V2_ONLY')), V3_ONLY: samples(comparisons.filter((r) => r.classification === 'V3_ONLY')) }, limitations: ['v3 uses global symbol/effective-broker baselines, not rolling symbol+broker+timeframe baselines', 'USDJPY is not judged by a universal 0.005 ground truth; comparison is detector behavior only', 'USDSEK scale behavior requires manual review of genuine discontinuities', 'XAUUSD metal thresholds are candidate policy, not certified', 'DXY synthetic boundaries are not automatically approved', 'no detector output is an approval decision'] };
  const report = { schema_version: 'candle-blocker-v2-v3-readonly-audit-v1', authority: 'NON_AUTHORITATIVE', generated_at: new Date().toISOString(), audit: { started_at: started, ended_at: new Date().toISOString(), canonical_edge: EDGE, git_commit: gitSha(), database: snapshot.identity, transaction: 'REPEATABLE READ READ ONLY', mandatory_symbols: SYMBOLS, additional_active_blocker_symbols: activeSymbols.filter((s) => !SYMBOLS.includes(s)), effective_broker_policy: snapshot.policy }, accounting: { database_writes: 0, source_state_changes: 0, artifact_writes: 2 }, batch_1_blocker_snapshot: b1, batch_2_detector_comparison: b2, gate_status: { permission: 'INACTIVE', technical_eligibility: 'BLOCKED_UNKNOWN', shadow_run: 'NO_SHADOW_RUN_YET', writes: 0, authority: 'NON_AUTHORITATIVE' } };
  const date = EDGE.slice(0, 10); const outDir = path.join('reports', `candle-audit-${date}`); fs.mkdirSync(outDir, { recursive: true }); const jsonPath = path.join(outDir, 'blocker-detector-v2-v3-readonly.json'); const mdPath = path.join(outDir, 'blocker-detector-v2-v3-readonly.md'); fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  const md = [`# Candle Blocker / Detector Audit`, ``, `- Authority: NON_AUTHORITATIVE`, `- Canonical edge: ${EDGE}`, `- Transaction: REPEATABLE READ READ ONLY`, `- Database writes: 0`, `- Source state changes: 0`, `- Artifact writes: 2`, ``, `## Batch 1`, ``, `Active blocker rows: ${blockerRows.length}`, `Distinct candle identities: ${b1.population.distinct_candle_identities}`, ``, '### By symbol', '', '```json', JSON.stringify(b1.counts.by_symbol, null, 2), '```', '', '### By flag occurrence', '', '```json', JSON.stringify(b1.counts.by_flag_occurrence, null, 2), '```', '', '### By normalized decision', '', '```json', JSON.stringify(b1.counts.by_decision, null, 2), '```', '', `## Batch 2 — ${b2.label}`, '', '| Classification | Count |', '|---|---:|', `| OVERLAP | ${comparisons.filter((r) => r.classification === 'OVERLAP').length} |`, `| V2_ONLY | ${comparisons.filter((r) => r.classification === 'V2_ONLY').length} |`, `| V3_ONLY | ${comparisons.filter((r) => r.classification === 'V3_ONLY').length} |`, '', 'Detector comparison is behavioral only. No approvals, canonical changes, feature backfill, or gate transitions occurred.', '', '## Gate status', '', '```json', JSON.stringify(report.gate_status, null, 2), '```', '']; fs.writeFileSync(mdPath, md.join('\n'));
  console.log(JSON.stringify({ jsonPath, mdPath, database_writes: 0, source_state_changes: 0, artifact_writes: 2, blocker_rows: blockerRows.length, comparison_rows: comparisons.length }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
