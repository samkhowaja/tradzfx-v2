#!/usr/bin/env node
"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", ".env.local"),
  quiet: true,
});
const { getPool } = require("../packages/shared/dist/index.js");

const LOOKBACK = Object.freeze({ "1m": 3, "5m": 5, "15m": 8, "1h": 10, "4h": 15, "1d": 20 });
const TF_INTERVAL = Object.freeze({ "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "1h": "1 hour", "4h": "4 hours", "1d": "1 day" });
const CANDLE_RELATION = Object.freeze({
  "1m": "market.candles_1m_canonical",
  "5m": "market.candles_5m_canonical",
  "15m": "market.candles_15m_canonical",
  "1h": "market.candles_1h_canonical",
  "4h": "market.candles_4h_canonical",
  "1d": "market.candles_1d_utc_canonical",
});

function usage() {
  console.error("Usage: node scripts/audit-pivot-provenance.js <symbol> <tf> <from-iso> <to-iso>");
}

function findPivots(candles, lookback) {
  const pivots = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let high = true;
    let low = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].h >= c.h || candles[i + j].h >= c.h) high = false;
      if (candles[i - j].l <= c.l || candles[i + j].l <= c.l) low = false;
      if (!high && !low) break;
    }
    if (high) pivots.push({ ts: c.ts.toISOString(), kind: "high", price: c.h });
    if (low) pivots.push({ ts: c.ts.toISOString(), kind: "low", price: c.l });
  }
  return pivots;
}

function key(row) {
  return `${new Date(row.ts).toISOString()}|${row.kind}|${Number(row.price)}`;
}

async function main() {
  const [symbolRaw, tf = "15m", fromRaw, toRaw] = process.argv.slice(2);
  if (!symbolRaw || !fromRaw || !toRaw || !LOOKBACK[tf]) {
    usage();
    process.exitCode = 2;
    return;
  }
  const symbol = symbolRaw.toUpperCase();
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error("Invalid audit window");
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10min'");
    const lookback = LOOKBACK[tf];
    const relation = CANDLE_RELATION[tf];
    const interval = TF_INTERVAL[tf];
    const candleResult = await client.query(
      `SELECT ts, o, h, l, c
       FROM ${relation}
       WHERE symbol = $1
         AND ts >= $2::timestamptz - ($4::int * $5::interval)
         AND ts <= $3::timestamptz + ($4::int * $5::interval)
       ORDER BY ts`,
      [symbol, from.toISOString(), to.toISOString(), lookback, interval]
    );
    const candles = candleResult.rows.map((r) => ({
      ts: new Date(r.ts), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c),
    }));
    const expected = findPivots(candles, lookback).filter((p) => {
      const ts = new Date(p.ts);
      return ts >= from && ts <= to;
    });
    const actualResult = await client.query(
      `SELECT ts, kind, price, engine_ver, input_hash
       FROM features_pivot
       WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4
       ORDER BY ts, kind, price`,
      [symbol, tf, from.toISOString(), to.toISOString()]
    );
    const expectedKeys = new Set(expected.map(key));
    const actualKeys = new Set(actualResult.rows.map(key));
    const versions = new Map();
    for (const row of actualResult.rows) {
      const version = row.engine_ver ?? "<null>";
      const bucket = versions.get(version) ?? { rows: 0, matched: 0, excess: 0 };
      bucket.rows++;
      if (expectedKeys.has(key(row))) bucket.matched++;
      else bucket.excess++;
      versions.set(version, bucket);
    }
    const missing = expected.filter((row) => !actualKeys.has(key(row)));
    const excess = actualResult.rows.filter((row) => !expectedKeys.has(key(row)));
    console.log(JSON.stringify({
      mode: "read-only",
      symbol,
      tf,
      window: { from: from.toISOString(), to: to.toISOString() },
      lookback,
      candle_relation: relation,
      candles_loaded: candles.length,
      expected_rows: expected.length,
      actual_rows: actualResult.rows.length,
      matched_rows: actualResult.rows.length - excess.length,
      excess_rows: excess.length,
      missing_rows: missing.length,
      by_engine_ver: Object.fromEntries(versions),
      excess_sample: excess.slice(0, 25),
      missing_sample: missing.slice(0, 25),
    }, null, 2));
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
