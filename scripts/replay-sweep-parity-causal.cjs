#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { buildCausalLevels, detectCausalSweeps } = require('../apps/engine/dist/features/causalSweepPrototype.js');

const SYMBOL = process.env.PARITY_SYMBOL || 'EURUSD';
const TF = process.env.PARITY_TF || '1h';
const DAYS = Number.parseInt(process.env.PARITY_DAYS || '2', 10);
const WARMUP_DAYS = Number.parseInt(process.env.PARITY_WARMUP_DAYS || '30', 10);
const TF_MS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };
const PIVOT_LOOKBACK = { '1m': 3, '5m': 5, '15m': 8, '1h': 10, '4h': 15, '1d': 20 };
if (!TF_MS[TF]) throw new Error(`Unsupported PARITY_TF: ${TF}`);

const pool = new Pool({
  host: process.env.TM_DB_HOST || 'localhost',
  port: +(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: process.env.TM_DB_USER || 'postgres',
  password: process.env.TM_DB_PASSWORD,
  max: 2,
});

function closeBackMatch(legacy, causal) {
  return Math.abs(causal.level - legacy.level) < 1e-9 &&
    causal.direction === legacy.direction &&
    Math.abs(causal.closeBackTs.getTime() - legacy.ts.getTime()) <= TF_MS[TF];
}

function compareSweepSets(legacy, causal) {
  const matches = [];
  const used = new Set();
  const legacyOnly = [];
  for (const event of legacy) {
    const index = causal.findIndex((candidate, i) => !used.has(i) && closeBackMatch(event, candidate));
    if (index < 0) legacyOnly.push(event);
    else { used.add(index); matches.push({ legacy: event, causal: causal[index] }); }
  }
  const causalOnly = causal.filter((_, i) => !used.has(i));
  return { matches, legacyOnly, causalOnly };
}

function atrAt(candles, ts, persisted) {
  const value = persisted.get(ts.toISOString());
  if (Number.isFinite(value)) return { value, source: 'features_atr' };
  const index = candles.findIndex(c => c.ts.getTime() === ts.getTime());
  const sample = candles.slice(Math.max(0, index - 14), index);
  return { value: sample.length ? sample.reduce((sum, c) => sum + c.h - c.l, 0) / sample.length : 0, source: 'reconstructed' };
}

function causalDiagnostic(event, levels, candles, atrRows, comparison) {
  const level = levels.find(l => l.levelId === event.levelId);
  const extension = candles.find(c => c.ts.getTime() === event.sweepTs.getTime());
  const closeBack = candles.find(c => c.ts.getTime() === event.closeBackTs.getTime());
  const atr = atrAt(candles, event.sweepTs, atrRows);
  const penetration = level.kind === 'high' ? extension.h - level.price : level.price - extension.l;
  const match = comparison.matches.find(m => m.causal === event);
  return {
    levelPrice: level.price, levelSource: level.targetType,
    pivotTs: level.formedTs.toISOString(), pivotConfirmationTs: level.confirmationTs.toISOString(),
    extensionCandleTs: event.sweepTs.toISOString(), extensionHigh: extension.h, extensionLow: extension.l,
    penetration, atr14: atr.value, atrSource: atr.source, threshold: atr.value * 0.1,
    penetrationRatio: atr.value ? penetration / atr.value : 0,
    closeBackCandleTs: event.closeBackTs.toISOString(), closeBackClose: closeBack.c,
    availableAtTs: event.availableAtTs.toISOString(), matchedLegacy: !!match,
    legacyTs: match ? match.legacy.ts.toISOString() : null,
  };
}

function legacyDiagnostic(event, levels, candles, atrRows) {
  const candidates = levels.filter(l => l.kind === (event.direction === 'bullish' ? 'low' : 'high'));
  const nearest = candidates.reduce((best, l) => !best || Math.abs(l.price - event.level) < Math.abs(best.price - event.level) ? l : best, null);
  const causalLevelExists = nearest && Math.abs(nearest.price - event.level) < 1e-9;
  if (!causalLevelExists) return { legacyTs: event.ts.toISOString(), legacyLevel: event.level, legacySweepType: event.targetType, causalLevelExists: false, reason: 'no_causal_level_at_price' };
  const eventIndex = candles.findIndex(c => c.ts.getTime() === event.ts.getTime());
  const window = eventIndex < 0 ? [] : candles.slice(Math.max(0, eventIndex - 2), eventIndex + 1);
  const extension = window.find(c => nearest.kind === 'high' ? c.h > nearest.price : c.l < nearest.price);
  if (!extension || nearest.confirmationTs > extension.ts) return { legacyTs: event.ts.toISOString(), legacyLevel: event.level, legacySweepType: event.targetType, causalLevelExists: true, reason: 'level_not_confirmed' };
  const atr = atrAt(candles, extension.ts, atrRows);
  const penetration = nearest.kind === 'high' ? extension.h - nearest.price : nearest.price - extension.l;
  if (penetration < atr.value * 0.1) return { legacyTs: event.ts.toISOString(), legacyLevel: event.level, legacySweepType: event.targetType, causalLevelExists: true, reason: 'extension_below_threshold', atr14: atr.value, penetration };
  return { legacyTs: event.ts.toISOString(), legacyLevel: event.level, legacySweepType: event.targetType, causalLevelExists: true, reason: 'no_close_back' };
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const candleRes = await client.query(`
      SELECT ts, o, h, l, c, v
      FROM market.candles_${TF}_canonical
      WHERE symbol = $1 AND ts >= now() - make_interval(days => $2)
      ORDER BY ts`, [SYMBOL, DAYS + WARMUP_DAYS]);
    const candles = candleRes.rows.map(r => ({ symbol: SYMBOL, ts: new Date(r.ts), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: r.v == null ? undefined : +r.v }));

    // Use persisted pivot prices, matching legacy and structure parity.
    // features_pivot lacks confirmation_ts; pivot producer semantics are
    // candle[i + lookback].ts + tf duration, equivalent to this offset.
    const pivotRes = await client.query(`
      SELECT ts, kind, price, confidence
      FROM features_pivot
      WHERE symbol = $1 AND tf = $2 AND ts >= now() - make_interval(days => $3)
      ORDER BY ts`, [SYMBOL, TF, DAYS + WARMUP_DAYS]);
    const pivots = pivotRes.rows.map(r => ({
      ts: new Date(r.ts), kind: r.kind, price: +r.price, confidence: +r.confidence,
      confirmationTs: new Date(new Date(r.ts).getTime() + (PIVOT_LOOKBACK[TF] + 1) * TF_MS[TF]),
    }));

    const atrRes = await client.query(`SELECT ts, value FROM features_atr WHERE symbol = $1 AND tf = $2 AND period = 14 AND ts >= now() - make_interval(days => $3) ORDER BY ts`, [SYMBOL, TF, DAYS + WARMUP_DAYS]);
    const atrRows = new Map(atrRes.rows.map(r => [new Date(r.ts).toISOString(), +r.value]));

    const legacyRes = await client.query(`
      SELECT ts, direction, level, extreme, close, sweep_type, target_type, mitigated_at
      FROM features_sweep
      WHERE symbol = $1 AND tf = $2 AND ts >= now() - make_interval(days => $3)
      ORDER BY ts`, [SYMBOL, TF, DAYS]);
    const legacy = legacyRes.rows.map(r => ({ ts: new Date(r.ts), direction: r.direction, level: +r.level, extreme: +r.extreme, close: +r.close, sweepType: r.sweep_type, targetType: r.target_type, mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at) : null }));
    await client.query('ROLLBACK');

    // Phase-isolated baseline: swing levels only. Equal/PDH/PDL construction
    // remains available in the prototype but is excluded until independently
    // calibrated against legacy inputs.
    const levels = buildCausalLevels(pivots, { tf: TF });
    const causal = detectCausalSweeps(candles, levels, { tf: TF })
      .filter(e => e.closeBackTs >= new Date(Date.now() - DAYS * 86_400_000));
    const comparison = compareSweepSets(legacy, causal);
    const report = {
      symbol: SYMBOL, tf: TF, days: DAYS,
      candleCount: candles.length, pivotCount: pivots.length, levelCount: levels.length,
      legacyCount: legacy.length, causalCount: causal.length,
      matches: comparison.matches.length,
      legacyOnly: comparison.legacyOnly.length,
      causalOnly: comparison.causalOnly.length,
      legacyOnlyEvents: comparison.legacyOnly,
      causalOnlyEvents: comparison.causalOnly,
      causalDiagnostics: causal.map(e => causalDiagnostic(e, levels, candles, atrRows, comparison)),
      legacyOnlyDiagnostics: comparison.legacyOnly.map(e => legacyDiagnostic(e, levels, candles, atrRows)),
      notes: ['Swing levels only for baseline parity', 'Equal levels and PDH/PDL intentionally excluded pending isolated calibration'],
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
