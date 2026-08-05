#!/usr/bin/env node
/**
 * Seed market.golden_corridor_sets with the five certified 5m cells
 * (parity-harness-v1 proof, 2026-08-05).
 *
 * Idempotent: skips rows already present (active row with same
 * symbol/tf/window/window_id/set_hash). Never updates or deletes.
 *
 * Usage:
 *   node scripts/seed-golden-corridors.js           # insert missing
 *   node scripts/seed-golden-corridors.js --check   # verify only, exit 1 if any missing
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const HARNESS = "parity-harness-v1@20260805";
const CERTIFIED_BY = "salman";
const CERTIFIED_AT = "2026-08-05T00:00:00Z";

// windowId, symbol, window bounds (1m trusted window that gates the 5m cell),
// gate setHash from the certification runs.
const CELLS = [
  { windowId: 48, symbol: "EURUSD", start: "2026-07-18T01:40:00Z", end: "2026-08-04T07:53:00Z", setHash: "ac56b104d1a9", notes: "First cert-lab cell (prior session). 4/4 PARITY_OK." },
  { windowId: 59, symbol: "GBPUSD", start: "2026-07-18T01:43:00Z", end: "2026-08-04T07:54:00Z", setHash: "ca746bfd10cc", notes: "v5.3 spreadzero-keep policy; 11 KEEP rows. 4/4 PARITY_OK." },
  { windowId: 51, symbol: "USDJPY", start: "2026-07-18T01:41:00Z", end: "2026-08-04T07:53:00Z", setHash: "efc48db82879", notes: "Sparse 1x feed; partial-bar keys causally correct. 4/4 PARITY_OK." },
  { windowId: 46, symbol: "XAUUSD", start: "2026-07-19T22:05:00Z", end: "2026-08-04T07:53:00Z", setHash: "621ed164e083", notes: "Daily break 21-22 UTC; Sunday-open start. 4/4 PARITY_OK." },
  { windowId: 55, symbol: "DXY", start: "2026-07-17T23:54:00Z", end: "2026-07-31T13:42:00Z", setHash: "7c328bf70faf", notes: "Synthetic; mid-session Friday end. 4/4 PARITY_OK." },
];

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

(async () => {
  const checkOnly = process.argv.includes("--check");
  let missing = 0;

  for (const cell of CELLS) {
    const tw = await pool.query(
      `SELECT window_id, symbol, detector_version, canonical_version, window_start, window_end
       FROM market.trusted_windows WHERE window_id = $1 AND status = 'trusted'`,
      [cell.windowId]
    );
    if (tw.rows.length === 0) {
      console.error(`[seed] BLOCKER: trusted window ${cell.windowId} (${cell.symbol}) missing or not trusted`);
      missing++;
      continue;
    }
    const w = tw.rows[0];
    if (
      new Date(w.window_start).toISOString() !== new Date(cell.start).toISOString() ||
      new Date(w.window_end).toISOString() !== new Date(cell.end).toISOString() ||
      w.symbol !== cell.symbol
    ) {
      console.error(`[seed] BLOCKER: window ${cell.windowId} bounds/symbol mismatch vs cell definition`);
      missing++;
      continue;
    }

    const existing = await pool.query(
      `SELECT corridor_id FROM market.golden_corridor_sets
       WHERE symbol=$1 AND timeframe='5m' AND window_start=$2 AND window_end=$3 AND active`,
      [cell.symbol, cell.start, cell.end]
    );
    if (existing.rows.length > 0) {
      console.log(`[seed] ${cell.symbol} 5m: already seeded (corridor ${existing.rows[0].corridor_id})`);
      continue;
    }
    if (checkOnly) {
      console.log(`[seed] ${cell.symbol} 5m: MISSING`);
      missing++;
      continue;
    }

    await pool.query(
      `INSERT INTO market.golden_corridor_sets
         (symbol, timeframe, window_start, window_end, window_id, set_hash,
          harness_version, detector_version, canonical_version,
          certified_at, certified_by, notes)
       VALUES ($1,'5m',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        cell.symbol, cell.start, cell.end, cell.windowId,
        cell.setHash,
        HARNESS, w.detector_version, w.canonical_version,
        CERTIFIED_AT, CERTIFIED_BY, cell.notes,
      ]
    );
    console.log(`[seed] ${cell.symbol} 5m: inserted (window ${cell.windowId}, setHash ${cell.setHash ?? "n/a"})`);
  }

  if (missing > 0) {
    console.error(`[seed] ${missing} cell(s) missing/blocked`);
    process.exit(1);
  }
  console.log("[seed] all cells present");
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
