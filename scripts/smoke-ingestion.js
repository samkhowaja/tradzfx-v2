#!/usr/bin/env node
/**
 * Smoke-test the bulletproof ingestion path.
 *
 * Posts a current 1m bar for every configured symbol through nginx,
 * verifies it lands in candles_1m, and verifies the internal trigger
 * forwards to tz-web-v2.
 *
 * Usage:
 *   node scripts/smoke-ingestion.js
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { Pool } = require("pg");

function loadEnvFile(name) {
  const file = path.join(__dirname, "..", name);
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined && value.length > 0) {
      process.env[key] = value;
    }
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env.production.local");

const API_KEY = process.env.TM_MT5_API_KEY || "";
const INTERNAL_KEY = process.env.INTERNAL_TRIGGER_API_KEY || "";
const BASE_URL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:80";
const SYMBOLS = (process.env.MT5_SYMBOLS || "EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,USDSEK,AUDUSD,NZDUSD,XAUUSD").split(",");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
});

function get(urlPath, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const req = http.get(
      url,
      {
        headers: {
          ...extraHeaders,
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(chunks);
          } catch {
            json = { raw: chunks };
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on("error", reject);
  });
}

function post(urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const data = JSON.stringify(body);
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...extraHeaders,
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(chunks);
          } catch {
            json = { raw: chunks };
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function buildBar(symbol) {
  const now = new Date();
  now.setSeconds(0, 0);
  const tsSec = Math.floor(now.getTime() / 1000);
  const price = 1.0 + Math.random() * 0.5;
  const range = 0.0005;
  return {
    schemaVersion: "mt5-bars-v1",
    symbol,
    source: { platform: "mt5", broker: "smoke-test", digits: symbol === "XAUUSD" ? 2 : 5 },
    bars: [
      {
        time: tsSec,
        open: price,
        high: price + range,
        low: price - range,
        close: price + range * 0.1,
        tick_volume: 1,
        spread: 1,
      },
    ],
  };
}

async function main() {
  if (!API_KEY) throw new Error("TM_MT5_API_KEY not set");
  if (!INTERNAL_KEY) throw new Error("INTERNAL_TRIGGER_API_KEY not set");

  console.log(`Smoke-testing ingestion via ${BASE_URL} for ${SYMBOLS.length} symbols...`);
  let inserted = 0;
  let triggered = 0;

  for (const symbol of SYMBOLS) {
    const payload = buildBar(symbol);
    const ingestRes = await post("/api/ingest/mt5/bars", payload, { "X-API-Key": API_KEY });
    if (ingestRes.status !== 200) {
      console.error(`  ${symbol}: ingest failed`, ingestRes.status, ingestRes.body);
      continue;
    }
    inserted++;

    const triggerRes = await get(
      `/api/internal/trigger?symbol=${encodeURIComponent(symbol)}`,
      { "x-internal-api-key": INTERNAL_KEY }
    );
    if (triggerRes.status === 200) {
      triggered++;
    } else {
      console.error(`  ${symbol}: trigger failed`, triggerRes.status, triggerRes.body);
    }
  }

  // Verify at least one row landed in the DB.
  const { rows } = await pool.query(
    "SELECT COUNT(*) AS cnt FROM candles_1m WHERE broker = 'smoke-test' AND ts >= NOW() - INTERVAL '5 minutes'"
  );
  const dbRows = parseInt(rows[0].cnt, 10);

  await pool.end();

  console.log("\nResults:");
  console.log(`  Bars accepted by tz-ingestion: ${inserted}/${SYMBOLS.length}`);
  console.log(`  Internal triggers accepted:    ${triggered}/${SYMBOLS.length}`);
  console.log(`  DB rows with broker=smoke-test in last 5m: ${dbRows}`);

  if (inserted === SYMBOLS.length && triggered === SYMBOLS.length && dbRows >= SYMBOLS.length) {
    console.log("\n✅ Smoke test passed.");
    process.exit(0);
  } else {
    console.log("\n❌ Smoke test failed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
