#!/usr/bin/env node
/**
 * Research-only staged setup-to-entry scalp.
 *
 * Sequence:
 *   aligned 5m direction -> valid 5m zone and BOS/MSS setup -> first zone touch
 *   -> later aligned 1m BOS/MSS trigger -> market entry.
 *
 * Zone overlap is diagnostic only, never an entry requirement. Raw feature rows
 * use PIT lifecycle predicates; current-state market_zone_objects are unsuitable
 * for historical replay.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local"), quiet: true });
const { Pool } = require("pg");
const { simulateTrade } = require("./backtest-pit-v2.js");
const { getPairCharacteristics } = require("../packages/shared/dist/index.js");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 4,
  statement_timeout: 0,
});

const arg = (name, fallback) => {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : fallback;
};
const symbols = arg("symbols", "XAUUSD").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const from = new Date(arg("start", "2026-07-11"));
const to = new Date(arg("end", "2026-07-17"));
const touchToTriggerMinutes = Number(arg("touch-trigger-minutes", "15"));
const zoneMaxAgeMinutes = Number(arg("zone-age-minutes", "120"));
const setupStructureMinutes = Number(arg("setup-structure-minutes", "30"));
const biasMaxAgeMinutes = Number(arg("bias-age-minutes", "60"));
const triggerEvent = arg("trigger-event", "both").toLowerCase();
const json = process.argv.includes("--json");

if (!(from < to)) throw new Error("--start must be before --end");
if (!["both", "bos", "mss"].includes(triggerEvent)) throw new Error("--trigger-event must be both, bos, or mss");

const SQL = `
WITH triggers AS (
  SELECT s.symbol, s.ts AS trigger_ts, s.direction AS trigger_direction,
         s.event_type AS trigger_event, s.level AS trigger_level
  FROM features_structure s
  WHERE s.symbol = $1 AND s.tf = '1m'
    AND s.ts >= $2 AND s.ts < $3
    AND s.event_type IN ('bos','mss')
    AND ($8 = 'both' OR s.event_type = $8)
), staged AS (
  SELECT t.*,
         d.ts AS bias_ts, d.direction AS bias_direction,
         st.ts AS setup_structure_ts, st.event_type AS setup_structure_event,
         z5.ts AS zone5_ts, z5.zone_kind AS zone5_kind,
         z5.top AS zone5_top, z5.bottom AS zone5_bottom,
         z5.first_touch_at AS touch_ts, z5.fill_pct AS zone5_fill_pct,
         a.value AS atr5,
         c.c AS entry_price
  FROM triggers t
  JOIN LATERAL (
    SELECT ts, direction
    FROM features_direction_state
    WHERE symbol=t.symbol AND tf='5m' AND ts <= t.trigger_ts
      AND ts >= t.trigger_ts - ($7::text || ' minutes')::interval
      AND direction IN ('buy','sell')
    ORDER BY ts DESC LIMIT 1
  ) d ON d.direction = CASE WHEN t.trigger_direction='bullish' THEN 'buy' WHEN t.trigger_direction='bearish' THEN 'sell' END
  JOIN LATERAL (
    SELECT ts, event_type, direction
    FROM features_structure
    WHERE symbol=t.symbol AND tf='5m' AND ts <= t.trigger_ts
      AND ts >= t.trigger_ts - ($6::text || ' minutes')::interval
      AND event_type IN ('bos','mss')
      AND direction=t.trigger_direction
    ORDER BY ts DESC LIMIT 1
  ) st ON TRUE
  JOIN LATERAL (
    SELECT ts, zone_kind, direction, top, bottom, first_touch_at, fill_pct
    FROM features_zone
    WHERE symbol=t.symbol AND tf='5m' AND ts <= t.trigger_ts
      AND ts >= t.trigger_ts - ($4::text || ' minutes')::interval
      AND direction=t.trigger_direction
      AND top > bottom
      AND first_touch_at IS NOT NULL
      AND first_touch_at > ts
      AND first_touch_at <= t.trigger_ts
      AND first_touch_at >= t.trigger_ts - ($5::text || ' minutes')::interval
      AND (invalidated_at IS NULL OR invalidated_at > t.trigger_ts)
    ORDER BY first_touch_at DESC, rank_score DESC NULLS LAST, ts DESC
    LIMIT 1
  ) z5 ON t.trigger_ts > z5.first_touch_at AND st.ts <= z5.first_touch_at
  JOIN LATERAL (
    SELECT value FROM features_atr
    WHERE symbol=t.symbol AND tf='5m' AND period=14 AND ts <= t.trigger_ts
    ORDER BY ts DESC LIMIT 1
  ) a ON TRUE
  JOIN LATERAL (
    SELECT c FROM market.candles_1m_canonical
    WHERE symbol=t.symbol AND ts <= t.trigger_ts
    ORDER BY ts DESC LIMIT 1
  ) c ON TRUE
)
SELECT * FROM staged ORDER BY trigger_ts`;

async function candles(symbol) {
  const result = await pool.query(
    `SELECT ts,o,h,l,c FROM market.candles_1m_canonical
     WHERE symbol=$1 AND ts >= $2 AND ts <= $3 ORDER BY ts`,
    [symbol, from, to]
  );
  return result.rows.map((r) => ({ ts: r.ts, o:+r.o, h:+r.h, l:+r.l, c:+r.c }));
}

function toSignal(row) {
  const side = row.bias_direction;
  const entry = Number(row.entry_price);
  const atr = Number(row.atr5);
  const zoneBoundary = side === "buy" ? Number(row.zone5_bottom) : Number(row.zone5_top);
  const atrStop = side === "buy" ? entry - atr * 1.5 : entry + atr * 1.5;
  const structuralStop = side === "buy" ? zoneBoundary - atr * 0.1 : zoneBoundary + atr * 0.1;
  const sl = side === "buy" ? Math.min(atrStop, structuralStop) : Math.max(atrStop, structuralStop);
  const risk = Math.abs(entry - sl);
  const tp = side === "buy" ? entry + risk * 2 : entry - risk * 2;
  return { symbol: row.symbol, ts: row.trigger_ts, side, entry_price: entry, stop_loss: sl, take_profit: tp, entry_type: "market" };
}

async function main() {
  const results = [];
  for (const symbol of symbols) {
    const [candidateResult, future] = await Promise.all([
      pool.query(SQL, [symbol, from, to, zoneMaxAgeMinutes, touchToTriggerMinutes, setupStructureMinutes, biasMaxAgeMinutes, triggerEvent]),
      candles(symbol),
    ]);
    const pc = getPairCharacteristics(symbol);
    const seenZones = new Set();
    const trades = [];
    for (const row of candidateResult.rows) {
      const zoneKey = `${row.zone5_ts.toISOString()}|${row.zone5_kind}|${row.zone5_top}|${row.zone5_bottom}`;
      if (seenZones.has(zoneKey)) continue;
      seenZones.add(zoneKey);
      const signal = toSignal(row);
      const simulated = simulateTrade(signal, future, {
        timeoutBars: 100000,
        intrabarMode: "sl_first",
        pipSize: pc.pipSize,
        spreadPips: pc.baseSpreadPips,
        commissionPips: pc.commissionPipsPerLot || 0,
      });
      trades.push({ ...signal, ...simulated, stage: {
        biasTs: row.bias_ts,
        structureTs: row.setup_structure_ts,
        zone5Ts: row.zone5_ts,
        touchTs: row.touch_ts,
        triggerTs: row.trigger_ts,
        setupToTouchMinutes: (new Date(row.touch_ts)-new Date(row.setup_structure_ts))/60000,
        touchToTriggerMinutes: (new Date(row.trigger_ts)-new Date(row.touch_ts))/60000,
      }});
    }
    const resolved = trades.filter((t) => t.outcome === "win" || t.outcome === "loss");
    const wins = resolved.filter((t) => t.outcome === "win").length;
    const netR = resolved.reduce((sum, t) => sum + Number(t.r || 0), 0);
    results.push({ symbol, candidates: candidateResult.rowCount, uniqueZones: trades.length,
      resolved: resolved.length, wins, losses: resolved.length-wins,
      openAtEnd: trades.length-resolved.length, winRate: resolved.length ? wins/resolved.length*100 : 0,
      netR, trades });
  }
  const aggregate = results.reduce((a,r) => ({ resolved:a.resolved+r.resolved, wins:a.wins+r.wins,
    losses:a.losses+r.losses, openAtEnd:a.openAtEnd+r.openAtEnd, netR:a.netR+r.netR }),
    {resolved:0,wins:0,losses:0,openAtEnd:0,netR:0});
  const output = { config:{symbols,from,to,touchToTriggerMinutes,zoneMaxAgeMinutes,setupStructureMinutes,biasMaxAgeMinutes,triggerEvent}, results, aggregate };
  if (json) process.stdout.write(JSON.stringify(output, null, 2));
  else {
    console.table(results.map(({trades,...r}) => ({...r, winRate:+r.winRate.toFixed(1), netR:+r.netR.toFixed(2)})));
    console.log("Aggregate:", {...aggregate, winRate:aggregate.resolved ? +(aggregate.wins/aggregate.resolved*100).toFixed(1):0});
  }
}

main().catch((error) => { console.error("[staged-zone-research]", error); process.exitCode=1; })
  .finally(() => pool.end());
