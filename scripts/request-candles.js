#!/usr/bin/env node
/**
 * LINEAGE-06 on-demand candle request client.
 *
 * Creates a market.candle_requests row, drops the request file into the MT5
 * terminal Common folder (tradzfx\requests\pending\<uuid>.json), waits for the
 * responder EA to fulfill it, then diffs the response artifact against
 * market.candles_1m_canonical and writes a report.
 *
 * Usage:
 *   node scripts/request-candles.js XAUUSD 2026-07-29T11:30:00Z 2026-07-29T12:30:00Z \
 *     --purpose=gap_fill [--timeout-sec=120] [--no-wait]
 *
 * Read/write scope: candle_requests row (pending), request file, report JSON.
 * The ingestion server owns artifact/bar/lineage writes on response.
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

function arg(name, fallback = null) {
  const inline = process.argv.find(x => x.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function findCommonFilesDir() {
  const override = process.env.MT5_COMMON_FILES_DIR;
  if (override && fs.existsSync(override)) return override;
  const base = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "MetaQuotes", "Terminal", "Common", "Files");
  if (!fs.existsSync(base)) throw new Error(`MT5 Common Files dir not found: ${base} (set MT5_COMMON_FILES_DIR)`);
  return base;
}

async function main() {
  // Positional args: <SYMBOL> <from_utc> <to_utc>. Inline --x=v args are filtered,
  // space-separated --x v args are consumed along with their value.
  const FLAGS_WITH_VALUE = new Set(["purpose", "timeout-sec"]);
  const raw = process.argv.slice(2);
  const positional = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const name = a.slice(2).split("=")[0];
      if (!a.includes("=") && FLAGS_WITH_VALUE.has(name)) i++; // skip value
      continue;
    }
    positional.push(a);
  }
  const [symbolArg, fromArg, toArg] = positional;
  if (!symbolArg || !fromArg || !toArg) {
    console.error("usage: node scripts/request-candles.js <SYMBOL> <from_utc> <to_utc> [--purpose=gap_fill|verification|forensic] [--timeout-sec=120] [--no-wait]");
    process.exit(2);
  }
  const symbol = symbolArg.toUpperCase();
  const from = new Date(fromArg), to = new Date(toArg);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new Error("invalid time range");
  const purpose = arg("purpose", "verification");
  if (!["gap_fill", "verification", "forensic"].includes(purpose)) throw new Error("bad purpose");
  const timeoutSec = Number(arg("timeout-sec", "120"));
  const wait = !process.argv.includes("--no-wait");

  const requestId = crypto.randomUUID();
  const p = new Pool(getDbConfig());
  try {
    await p.query(
      `INSERT INTO market.candle_requests (request_id, symbol, timeframe, from_utc, to_utc, purpose, requested_by)
       VALUES ($1,$2,'1m',$3,$4,$5,$6)`,
      [requestId, symbol, from, to, purpose, "request-candles.js"]);

    const pendingDir = path.join(findCommonFilesDir(), "tradzfx", "requests", "pending");
    fs.mkdirSync(pendingDir, { recursive: true });
    const reqFile = path.join(pendingDir, `${requestId}.json`);
    fs.writeFileSync(reqFile, JSON.stringify({
      request_id: requestId, symbol, timeframe: "1m",
      from_utc: from.toISOString(), to_utc: to.toISOString(),
    }));
    console.log(JSON.stringify({ requestId, reqFile, status: "pending" }));

    if (!wait) { console.log("no-wait: request queued"); return; }

    const deadline = Date.now() + timeoutSec * 1000;
    let row = null;
    while (Date.now() < deadline) {
      const r = await p.query(
        `SELECT status, response_count, terminal_login, terminal_server, responded_at, error
         FROM market.candle_requests WHERE request_id=$1`, [requestId]);
      row = r.rows[0];
      if (row.status !== "pending") break;
      await new Promise(res => setTimeout(res, 2000));
    }
    if (!row || row.status === "pending") {
      console.error(JSON.stringify({ requestId, status: "timeout", note: "request still pending; EA may be offline" }));
      process.exit(1);
    }
    if (row.status !== "fulfilled") {
      console.error(JSON.stringify({ requestId, status: row.status, error: row.error }));
      process.exit(1);
    }

    // Diff artifact payload vs canonical.
    const art = await p.query(
      `SELECT artifact_id, bar_count, payload_sha256, payload, retrieved_at
       FROM market.candle_source_artifacts WHERE request_id=$1`, [requestId]);
    const artifact = art.rows[0];
    const artifactBars = (artifact.payload || []).map(b => ({
      ts: (b.ts > 1e12 ? Math.floor(b.ts / 1000) : b.ts) * 1000,
      o: Number(b.o ?? b.open), h: Number(b.h ?? b.high), l: Number(b.l ?? b.low), c: Number(b.c ?? b.close),
    }));
    const canon = await p.query(
      `SELECT ts, o, h, l, c FROM market.candles_1m_canonical WHERE symbol=$1 AND ts >= $2 AND ts < $3 ORDER BY ts`,
      [symbol, from, to]);
    const canonMap = new Map(canon.rows.map(r => [new Date(r.ts).getTime(), r]));
    const artMap = new Map(artifactBars.map(b => [b.ts, b]));
    const missingInCanonical = artifactBars.filter(b => !canonMap.has(b.ts)).map(b => new Date(b.ts).toISOString());
    const missingInArtifact = [...canonMap.keys()].filter(t => !artMap.has(t)).map(t => new Date(t).toISOString());
    const mismatches = [];
    for (const [t, b] of artMap) {
      const c = canonMap.get(t);
      if (!c) continue;
      if (Number(c.o) !== b.o || Number(c.h) !== b.h || Number(c.l) !== b.l || Number(c.c) !== b.c) {
        mismatches.push({ ts: new Date(t).toISOString(), artifact: b, canonical: { o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c) } });
      }
    }
    const lineage = await p.query(
      `SELECT count(*)::int n FROM market.candle_bar_lineage WHERE artifact_id=$1`, [artifact.artifact_id]);
    const report = {
      requestId, artifactId: artifact.artifact_id, symbol, purpose,
      from: from.toISOString(), to: to.toISOString(),
      terminal: { login: row.terminal_login, server: row.terminal_server },
      retrievedAt: artifact.retrieved_at, payloadSha256: artifact.payload_sha256,
      artifactBars: artifactBars.length,
      canonicalBars: canon.rowCount,
      lineageRows: lineage.rows[0].n,
      missingInCanonical, missingInArtifact, mismatches,
      verdict: mismatches.length === 0 ? "MATCH" : "CONFLICT",
    };
    fs.mkdirSync("reports", { recursive: true });
    const out = `reports/candle-request-${requestId}.json`;
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ out, verdict: report.verdict, artifactBars: report.artifactBars, canonicalBars: report.canonicalBars, missingInCanonical: missingInCanonical.length, missingInArtifact: missingInArtifact.length, mismatches: mismatches.length, lineageRows: report.lineageRows }, null, 2));
    if (mismatches.length) process.exit(1);
  } finally {
    await p.end();
  }
}

main().catch(e => { console.error(`BLOCKED: ${e.message}`); process.exit(1); });
