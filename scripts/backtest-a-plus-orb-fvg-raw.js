#!/usr/bin/env node

require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const { getPairCharacteristics } = require("../packages/shared/dist/index.js");

const SYMBOLS = ["AUDUSD", "EURUSD", "GBPUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY", "USDSEK", "XAUUSD"];
const DAYS = Number(process.argv[2] || 90);
const MAX_FILL_MINUTES = 60;
const TIMEOUT_MINUTES = 180;

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

function bucketDate(ts, minutes) {
  const d = new Date(ts);
  const ms = minutes * 60_000;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function timeHHMM(ts) {
  return new Date(ts).toISOString().slice(11, 16);
}

function aggregate(candles, minutes) {
  const out = [];
  let cur = null;
  for (const c of candles) {
    const ts = bucketDate(c.ts, minutes);
    const key = ts.getTime();
    if (!cur || cur.key !== key) {
      if (cur) out.push(cur);
      cur = { key, ts, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0 };
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function findFirstSetup(dayBars5, orBar) {
  for (let i = 2; i < dayBars5.length; i++) {
    const c1 = dayBars5[i - 2];
    const c3 = dayBars5[i];
    const hhmm = timeHHMM(c3.ts);
    if (hhmm < "13:45" || hhmm > "16:00") continue;

    if (c1.h < c3.l && c1.h > orBar.h) {
      return {
        symbol: c3.symbol,
        ts: c3.ts,
        side: "buy",
        entry: (c1.h + c3.l) / 2,
        sl: c1.l,
        fvgTop: c3.l,
        fvgBottom: c1.h,
      };
    }

    if (c1.l > c3.h && c1.l < orBar.l) {
      return {
        symbol: c3.symbol,
        ts: c3.ts,
        side: "sell",
        entry: (c1.l + c3.h) / 2,
        sl: c1.h,
        fvgTop: c1.l,
        fvgBottom: c3.h,
      };
    }
  }
  return null;
}

function simulate(setup, candles1m) {
  const risk = setup.side === "buy" ? setup.entry - setup.sl : setup.sl - setup.entry;
  if (!(risk > 0)) return { outcome: "invalid", r: 0 };
  const tp = setup.side === "buy" ? setup.entry + risk * 2 : setup.entry - risk * 2;
  const start = setup.ts.getTime();
  const fillUntil = start + MAX_FILL_MINUTES * 60_000;
  const end = start + (MAX_FILL_MINUTES + TIMEOUT_MINUTES) * 60_000;
  let filled = false;
  let fillTs = null;
  let afterFillEnd = end;

  for (const c of candles1m) {
    const t = c.ts.getTime();
    if (t <= start) continue;
    if (!filled) {
      if (t > fillUntil) return { outcome: "timeout", r: 0, entry: setup.entry, sl: setup.sl, tp };
      const touched = setup.side === "buy" ? c.l <= setup.entry : c.h >= setup.entry;
      if (!touched) continue;
      filled = true;
      fillTs = c.ts;
      afterFillEnd = t + TIMEOUT_MINUTES * 60_000;
    }

    if (t > afterFillEnd) return { outcome: "timeout", r: 0, entry: setup.entry, sl: setup.sl, tp, fillTs };

    if (setup.side === "buy") {
      const hitSl = c.l <= setup.sl;
      const hitTp = c.h >= tp;
      if (hitSl && hitTp) return { outcome: "loss", r: -1, entry: setup.entry, sl: setup.sl, tp, fillTs };
      if (hitSl) return { outcome: "loss", r: -1, entry: setup.entry, sl: setup.sl, tp, fillTs };
      if (hitTp) return { outcome: "win", r: 2, entry: setup.entry, sl: setup.sl, tp, fillTs };
    } else {
      const hitSl = c.h >= setup.sl;
      const hitTp = c.l <= tp;
      if (hitSl && hitTp) return { outcome: "loss", r: -1, entry: setup.entry, sl: setup.sl, tp, fillTs };
      if (hitSl) return { outcome: "loss", r: -1, entry: setup.entry, sl: setup.sl, tp, fillTs };
      if (hitTp) return { outcome: "win", r: 2, entry: setup.entry, sl: setup.sl, tp, fillTs };
    }
  }
  return { outcome: "timeout", r: 0, entry: setup.entry, sl: setup.sl, tp, fillTs };
}

async function load1m(symbol, from, to) {
  const { rows } = await pool.query(
    `SELECT symbol, ts, o, h, l, c, COALESCE(v, 0) v
     FROM candles_1m
     WHERE symbol = $1 AND ts >= $2 AND ts <= $3
     ORDER BY ts`,
    [symbol, from, to],
  );
  return rows.map((r) => ({
    symbol: r.symbol,
    ts: new Date(r.ts),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: Number(r.v),
  }));
}

async function main() {
  const to = new Date();
  const from = new Date(to.getTime() - DAYS * 24 * 60 * 60_000);
  const allTrades = [];
  const coverage = [];

  for (const symbol of SYMBOLS) {
    const candles1m = await load1m(symbol, from, to);
    const bars5 = aggregate(candles1m, 5).map((b) => ({ ...b, symbol }));
    const bars15 = aggregate(candles1m, 15).map((b) => ({ ...b, symbol }));
    const days = [...new Set(candles1m.map((c) => dayKey(c.ts)))];
    let daysWithOr = 0;
    let daysWithSetup = 0;

    for (const d of days) {
      const orBar = bars15.find((b) => dayKey(b.ts) === d && timeHHMM(b.ts) === "13:30");
      if (!orBar) continue;
      daysWithOr++;
      const dayBars5 = bars5.filter((b) => dayKey(b.ts) === d);
      const setup = findFirstSetup(dayBars5, orBar);
      if (!setup) continue;
      daysWithSetup++;
      const result = simulate(setup, candles1m.filter((c) => dayKey(c.ts) === d || c.ts > setup.ts));
      allTrades.push({ symbol, ...setup, ...result });
    }

    coverage.push({ symbol, candles1m: candles1m.length, bars5: bars5.length, days: days.length, daysWithOr, daysWithSetup });
  }

  const wins = allTrades.filter((t) => t.outcome === "win").length;
  const losses = allTrades.filter((t) => t.outcome === "loss").length;
  const timeouts = allTrades.filter((t) => t.outcome === "timeout").length;
  const decided = wins + losses;
  const netR = allTrades.reduce((s, t) => s + t.r, 0);
  console.log(JSON.stringify({
    days: DAYS,
    coverage,
    trades: allTrades.length,
    wins,
    losses,
    timeouts,
    winRate: decided ? wins / decided : 0,
    netR,
    bySymbol: SYMBOLS.map((symbol) => {
      const ts = allTrades.filter((t) => t.symbol === symbol);
      const w = ts.filter((t) => t.outcome === "win").length;
      const l = ts.filter((t) => t.outcome === "loss").length;
      return { symbol, trades: ts.length, wins: w, losses: l, timeouts: ts.filter((t) => t.outcome === "timeout").length, winRate: w + l ? w / (w + l) : 0 };
    }),
    sampleTrades: allTrades.slice(0, 20).map((t) => ({
      symbol: t.symbol,
      ts: t.ts.toISOString(),
      side: t.side,
      outcome: t.outcome,
      r: t.r,
      entry: t.entry,
      sl: t.sl,
      tp: t.tp,
      fillTs: t.fillTs?.toISOString?.() ?? null,
    })),
  }, null, 2));

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
