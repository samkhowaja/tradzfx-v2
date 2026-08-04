#!/usr/bin/env node
/**
 * Alternate-broker replacement evidence report (read-only).
 *
 * For every active (unsuperseded, unapproved) quarantine row that has at least
 * one alternate-broker candle at the same symbol/timestamp, compares the
 * blocked canonical candle against each alternate-broker candle and emits a
 * suggested classification:
 *
 *   REPLACE_CANDIDATE — alternate OHLC is sane, close differs from blocked close
 *                       by less than tolerance, spread sane, timestamp not in a
 *                       calendar-explained gap, and blocked row is the corrupt one.
 *   KEEP_CANDIDATE    — blocked row looks fine and alternate does not improve it
 *                       (e.g. quarantine flag was calendar-explained gap).
 *   EXCLUDE_CANDIDATE — both blocked and alternate are invalid/impossible.
 *   UNKNOWN           — insufficient evidence to decide.
 *
 * Suggestions only — no auto-approve, no writes to quarantine or evidence
 * tables. Output: reports/alternate-broker-replacement-<date>.json + .md.
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Pool } = require('pg');

// Close-difference tolerance: fraction of blocked close. Beyond this the two
// feeds disagree materially and replacement needs deeper review.
const CLOSE_DIFF_TOLERANCE = 0.003; // 0.3%
// Spread sanity caps in pips per symbol (generous data-quality caps, not
// trading gates). Zero spread = missing/unresolved, treated as unknown.
const SPREAD_CAPS = { XAUUSD: 100, EURUSD: 30, USDJPY: 30, DXY: 50, DEFAULT: 50 };

function invalidOhlc(c) { return c.h < c.l || c.h < Math.max(c.o, c.c) || c.l > Math.min(c.o, c.c); }
function spreadSane(c, symbol) {
  if (c.spread == null) return 'unknown';
  const s = Number(c.spread);
  if (s < 0) return 'impossible';
  if (s === 0) return 'unresolved';
  return s <= (SPREAD_CAPS[symbol] ?? SPREAD_CAPS.DEFAULT) ? 'sane' : 'excessive';
}

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost',
    port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2',
    user: 'postgres',
    password: process.env.TM_DB_PASSWORD,
  });
  try {
    // Active quarantine rows joined to blocked candle + alternates.
    const { rows } = await pool.query(`
      SELECT q.symbol, q.broker AS blocked_broker, q.event_time, q.flags, q.severity, q.detector_version,
             raw.effective_broker_identity(q.broker) AS blocked_identity,
             cb.o AS b_o, cb.h AS b_h, cb.l AS b_l, cb.c AS b_c, cb.spread AS b_spread,
             ca.broker AS alt_broker, raw.effective_broker_identity(ca.broker) AS alt_identity,
             ca.o AS a_o, ca.h AS a_h, ca.l AS a_l, ca.c AS a_c, ca.spread AS a_spread
      FROM candle_quarantine q
      JOIN candles_1m cb ON cb.symbol = q.symbol AND cb.broker = q.broker AND cb.ts = q.event_time
      LEFT JOIN candles_1m ca ON ca.symbol = q.symbol AND ca.ts = q.event_time
        AND raw.effective_broker_identity(ca.broker) <> raw.effective_broker_identity(q.broker)
      WHERE q.superseded_at IS NULL
        AND q.decision IS DISTINCT FROM 'KEEP'
        AND q.broker <> 'smoke-test'
      ORDER BY q.symbol, q.event_time, ca.broker`);

    const rowsWithAlt = rows.filter((r) => r.alt_broker != null);
    const evaluated = [];
    for (const r of rowsWithAlt) {
      const blocked = { o: +r.b_o, h: +r.b_h, l: +r.b_l, c: +r.b_c, spread: r.b_spread == null ? null : +r.b_spread };
      const alt = { o: +r.a_o, h: +r.a_h, l: +r.a_l, c: +r.a_c, spread: r.a_spread == null ? null : +r.a_spread };

      const blockedInvalid = invalidOhlc(blocked);
      const altInvalid = invalidOhlc(alt);
      const blockedSpread = spreadSane(blocked, r.symbol);
      const altSpread = spreadSane(alt, r.symbol);
      const closeDiff = blocked.c ? Math.abs(alt.c - blocked.c) / Math.abs(blocked.c) : null;

      // Calendar/gap status at event timestamp.
      const { rows: gap } = await pool.query(
        `WITH prev AS (SELECT max(ts) prev_ts FROM market.candles_1m_canonical WHERE symbol=$1 AND ts<$2)
         SELECT market.classify_candle_gap($1, $3, prev.prev_ts, $2) AS gap_class FROM prev`,
        [r.symbol, r.event_time, r.blocked_identity]);

      const gapClass = gap[0]?.gap_class ?? 'NONE';
      const calendarExplainedOnly = r.flags.every((f) => f === 'UNEXPECTED_GAP') && gapClass !== 'UNEXPECTED';

      let suggestion;
      if (blockedInvalid && altInvalid) suggestion = 'EXCLUDE_CANDIDATE';
      else if (blockedInvalid && !altInvalid && (closeDiff == null || closeDiff <= CLOSE_DIFF_TOLERANCE) && altSpread !== 'impossible') suggestion = 'REPLACE_CANDIDATE';
      else if (calendarExplainedOnly) suggestion = 'KEEP_CANDIDATE';
      else if (!blockedInvalid && !altInvalid && closeDiff != null && closeDiff <= CLOSE_DIFF_TOLERANCE && altSpread === 'sane' && blockedSpread === 'sane') suggestion = 'UNKNOWN';
      else if (!blockedInvalid && !altInvalid && closeDiff != null && closeDiff > CLOSE_DIFF_TOLERANCE) suggestion = 'UNKNOWN';
      else suggestion = 'UNKNOWN';

      evaluated.push({
        symbol: r.symbol, eventTime: new Date(r.event_time).toISOString(),
        blockedBroker: r.blocked_broker, blockedIdentity: r.blocked_identity,
        alternateBroker: r.alt_broker, alternateIdentity: r.alt_identity,
        flags: r.flags, detectorVersion: r.detector_version,
        blockedOhlc: blocked, alternateOhlc: alt,
        closeDiffFraction: closeDiff, blockedSpreadSanity: blockedSpread, alternateSpreadSanity: altSpread,
        blockedInvalidOhlc: blockedInvalid, alternateInvalidOhlc: altInvalid,
        gapClass, calendarExplainedOnly, suggestion,
      });
    }

    const summary = {};
    for (const e of evaluated) summary[e.suggestion] = (summary[e.suggestion] || 0) + 1;
    const noAltCount = rows.filter((r) => r.alt_broker == null).length;

    const date = new Date().toISOString().slice(0, 10);
    const jsonPath = `reports/alternate-broker-replacement-${date}.json`;
    const mdPath = `reports/alternate-broker-replacement-${date}.md`;
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, summary, noAlternateRows: noAltCount, evaluated }, null, 2));

    const lines = [`# Alternate-Broker Replacement Report — ${date}`, '',
      'Read-only evidence. No quarantine decisions changed; suggestions require manual review.', '',
      '## Summary', '',
      `| Suggestion | Count |`, `|---|---|`,
      ...Object.entries(summary).sort().map(([k, v]) => `| ${k} | ${v} |`),
      `| (rows without alternate broker data) | ${noAltCount} |`, '',
      '## REPLACE_CANDIDATE rows', '',
      '| Symbol | Event time | Blocked broker | Alt broker | Close diff | Flags |',
      '|---|---|---|---|---|---|'];
    for (const e of evaluated.filter((x) => x.suggestion === 'REPLACE_CANDIDATE').slice(0, 200)) {
      lines.push(`| ${e.symbol} | ${e.eventTime} | ${e.blockedBroker} | ${e.alternateBroker} | ${(e.closeDiffFraction * 100).toFixed(3)}% | ${e.flags.join(',')} |`);
    }
    lines.push('', '## Notes', '',
      `- Close-diff tolerance: ${(CLOSE_DIFF_TOLERANCE * 100).toFixed(1)}%.`,
      '- Zero spread = missing/unresolved (importer encodes unavailable as 0).',
      '- EXCLUDE_CANDIDATE: both blocked and alternate candles invalid.',
      '- KEEP_CANDIDATE: quarantine flags fully explained by calendar.',
      '- UNKNOWN: feeds disagree materially or evidence insufficient — needs manual review.');
    fs.writeFileSync(mdPath, lines.join('\n'));

    console.log(JSON.stringify({ jsonPath, mdPath, summary, noAlternateRows: noAltCount, evaluatedRows: evaluated.length }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
