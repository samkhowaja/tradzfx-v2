#!/usr/bin/env node
/**
 * Standalone MT5 ingestion server.
 *
 * Survives Next.js restarts by running as a separate PM2 process.
 * Handles raw 1m bar ingestion and EA heartbeat directly against PostgreSQL.
 * Live pipeline triggering is forwarded to the Next.js app as a best-effort
 * call so that bar persistence is never blocked by the web app restarting.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { Pool } = require("pg");
const spool = require("./ingest-spool");

// Load .env.local so this script works whether it is started directly, via PM2,
// or from a directory that does not inherit the shell environment.
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

const PORT = parseInt(process.env.INGESTION_PORT || "3004", 10);
const NEXT_APP_URL = process.env.NEXT_APP_URL || "http://127.0.0.1:3003";
const FALLBACK_API_KEY = process.env.TM_MT5_API_KEY || process.env.MT5_API_KEY || "";
const FORWARD_TRIGGER = process.env.INGESTION_FORWARD_TRIGGER !== "false";
const TRIGGER_TIMEOUT_MS = parseInt(process.env.INGESTION_TRIGGER_TIMEOUT_MS || "5000", 10);
const SPOOL_MAX_BYTES = parseInt(
  process.env.INGEST_SPOOL_MAX_BYTES || String(spool.DEFAULT_MAX_BYTES),
  10
);
const DRAIN_INTERVAL_MS = parseInt(process.env.INGEST_DRAIN_INTERVAL_MS || "15000", 10);

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD || process.env.PGPASSWORD,
  application_name: process.env.TM_DB_APPLICATION_NAME || "tradzfx-ingestion",
  max: parseInt(process.env.TM_DB_POOL_MAX || "10", 10),
  statement_timeout: parseInt(process.env.TM_DB_STATEMENT_TIMEOUT || "30000", 10),
  // Fail fast instead of hanging when the DB is unreachable, and recycle idle
  // sockets so connections severed by an admin-kill are replaced instead of
  // wedging the pool (the Jul 6-7 outage failure mode).
  connectionTimeoutMillis: parseInt(process.env.TM_DB_CONNECTION_TIMEOUT || "5000", 10),
  idleTimeoutMillis: parseInt(process.env.TM_DB_IDLE_TIMEOUT || "30000", 10),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on("error", (err) => {
  // Idle-client errors (e.g. "terminating connection due to administrator
  // command") land here. The client is evicted automatically; just log.
  log("warn", "pool idle client error", { error: err.message });
});

// ── Pool health check ─────────────────────────────────────────────────────
// Periodically verify the DB connection is alive. If SELECT 1 fails 3x
// consecutively, the pool is wedged on dead sockets (idle-in-transaction
// death spiral). Force PM2 to restart us so a fresh pool is created.
let consecutiveHealthFailures = 0;
const HEALTH_CHECK_INTERVAL_MS = parseInt(
  process.env.INGESTION_HEALTH_INTERVAL_MS || "30000",
  10
);
const HEALTH_CHECK_TIMEOUT_MS = parseInt(
  process.env.INGESTION_HEALTH_TIMEOUT_MS || "5000",
  10
);

setInterval(async () => {
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), HEALTH_CHECK_TIMEOUT_MS)
      ),
    ]);
    consecutiveHealthFailures = 0;
  } catch (err) {
    consecutiveHealthFailures++;
    log("warn", "ingestion health check failed", {
      count: consecutiveHealthFailures,
      error: err ? (err.message || String(err)) : "unknown",
    });
    if (consecutiveHealthFailures >= 3) {
      log("error", "ingestion pool wedged — exiting for PM2 autorestart", {
        failures: consecutiveHealthFailures,
      });
      process.exit(1);
    }
  }
}, HEALTH_CHECK_INTERVAL_MS).unref();

function log(level, msg, extra = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  console.log(line);
}

function roundToMinute(ms) {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  return d;
}

function pointsToPips(points, digits) {
  if (!Number.isFinite(points)) return null;
  if (digits === 4) return points;
  return points / 10;
}

function normalizeSymbol(symbol) {
  return String(symbol).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

// FX Weekend Calendar Guard: Check if a symbol is FX and timestamp is within tradable hours
// FX tradable window: Sunday 21:00 UTC → Friday 21:00 UTC
function isFxSymbol(symbol) {
  const fxSymbols = new Set([
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD',
    'EURGBP', 'EURJPY', 'EURCHF', 'EURCAD', 'EURAUD', 'EURNZD',
    'GBPJPY', 'GBPCHF', 'GBPCAD', 'GBPAUD', 'GBPNZD',
    'AUDJPY', 'AUDCHF', 'AUDCAD', 'AUDNZD',
    'CADJPY', 'CADCHF',
    'CHFJPY',
    'NZDJPY', 'NZDCHF', 'NZDCAD',
    'EURSEK', 'EURNOK', 'EURDKK', 'EURPLN', 'EURHUF', 'EURCZK',
    'USDSEK', 'USDNOK', 'USDDKK', 'USDPLN', 'USDHUF', 'USDCZK',
    'USDTRY', 'USDZAR', 'USDMXN', 'USDSGD', 'USDHKD', 'USDCNH'
  ]);
  return fxSymbols.has(symbol.toUpperCase());
}

function isTradableFxTime(ts) {
  const d = new Date(ts);
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
  const hour = d.getUTCHours();
  
  // Sunday before 21:00 UTC = not tradable
  if (day === 0 && hour < 21) return false;
  // Friday at or after 21:00 UTC = not tradable
  if (day === 5 && hour >= 21) return false;
  // Saturday = not tradable
  if (day === 6) return false;
  return true;
}

function isValidCandle(bar) {
  const time = typeof bar.time === "number" ? bar.time : bar.ts;
  if (!Number.isFinite(time) || time <= 0) {
    return { valid: false, reason: "invalid timestamp" };
  }
  const fields = [bar.open, bar.high, bar.low, bar.close, bar.tick_volume ?? bar.tickVol];
  if (fields.some((v) => !Number.isFinite(v))) {
    return { valid: false, reason: "non-finite OHLCV" };
  }
  if (fields.slice(0, 4).some((v) => v < 0) || (bar.tick_volume ?? bar.tickVol) < 0) {
    return { valid: false, reason: "negative value" };
  }
  if (bar.high < bar.low) return { valid: false, reason: "high < low" };
  if (bar.high < bar.open || bar.high < bar.close) return { valid: false, reason: "high below open/close" };
  if (bar.low > bar.open || bar.low > bar.close) return { valid: false, reason: "low above open/close" };
  return { valid: true };
}

function normalizeBars(payload) {
  const bars = Array.isArray(payload.bars) ? payload.bars : [];
  if (bars.length === 0) return [];
  const first = bars[0];
  if (first.ts !== undefined) {
    return bars.map((b) => ({
      time: b.ts > 1_000_000_000_000 ? Math.floor(b.ts / 1000) : b.ts,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      tick_volume: b.tickVol ?? b.tick_volume ?? 0,
      spread: b.spread,
    }));
  }
  return bars.map((b) => ({
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    tick_volume: b.tick_volume ?? 0,
    spread: b.spread,
  }));
}

async function validateApiKey(key) {
  if (!key) return false;
  if (FALLBACK_API_KEY && key === FALLBACK_API_KEY) return true;
  try {
    const { rows } = await pool.query(
      "SELECT 1 FROM mt5_terminals WHERE api_key = $1 LIMIT 1",
      [key]
    );
    return rows.length > 0;
  } catch (err) {
    log("warn", "api key db check failed", { error: err.message });
    // If the DB is unreachable, fall back to env key so ingestion can still work.
    return FALLBACK_API_KEY ? key === FALLBACK_API_KEY : false;
  }
}

async function upsertBars(payload) {
  const symbol = normalizeSymbol(payload.symbol);
  if (!symbol) {
    const err = new Error("missing symbol");
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(payload?.bars) || payload.bars.length === 0) {
    // Client bug, not an outage: must be a 400 so it is never spooled.
    const err = new Error("missing or empty bars array");
    err.statusCode = 400;
    throw err;
  }

  // FX Weekend Calendar Guard: reject non-tradable FX bars at ingestion gateway
  // This prevents weekend bars from advancing the candle edge and poisoning freshness
  if (isFxSymbol(symbol)) {
    for (const bar of payload.bars) {
      const ts = typeof bar.time === "number" ? bar.time : bar.ts;
      if (!isTradableFxTime(ts)) {
        const err = new Error(`FX weekend guard: non-tradable hours for ${symbol} at ${new Date(ts).toISOString()}`);
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const normalized = normalizeBars(payload);
  for (let i = 0; i < normalized.length; i++) {
    const check = isValidCandle(normalized[i]);
    if (!check.valid) {
      const err = new Error(`invalid candle at ${i}: ${check.reason}`);
      err.statusCode = 400;
      err.details = { index: i, reason: check.reason };
      throw err;
    }
  }

  const broker = String(payload.source?.broker ?? "default").replace(/'/g, "").slice(0, 64);
  const digits =
    typeof payload.source?.digits === "number"
      ? Math.max(0, Math.min(10, Math.round(payload.source.digits)))
      : null;
  const effectiveDigits = digits ?? 5;

  const rows = normalized.map((bar) => {
    const ts = roundToMinute(bar.time * 1000);
    const spread =
      typeof bar.spread === "number" ? pointsToPips(bar.spread, effectiveDigits) : null;
    return [symbol, ts, bar.open, bar.high, bar.low, bar.close, bar.tick_volume, spread, broker, digits];
  });

  const placeholders = [];
  const values = [];
  let idx = 1;
  for (const r of rows) {
    placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    values.push(...r);
  }

  const { rowCount } = await pool.query(
    `INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, spread, broker, digits)
     VALUES ${placeholders.join(", ")}
     ON CONFLICT (symbol, broker, ts) DO UPDATE SET
       o = EXCLUDED.o,
       h = EXCLUDED.h,
       l = EXCLUDED.l,
       c = EXCLUDED.c,
       v = EXCLUDED.v,
       spread = EXCLUDED.spread,
       broker = EXCLUDED.broker,
       digits = EXCLUDED.digits`,
    values
  );

  const firstTs = rows.reduce((min, row) => row[1] < min ? row[1] : min, rows[0][1]);
  const lastTs = rows.reduce((max, row) => row[1] > max ? row[1] : max, rows[0][1]);
  const quarantine = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM candle_quarantine
      WHERE symbol = $1 AND broker = $2 AND timeframe = '1m'
        AND superseded_at IS NULL
        AND event_time >= $3 AND event_time <= $4
        AND (approved_at IS NULL OR decision <> 'KEEP')`,
    [symbol, broker, firstTs, lastTs]
  );

  return {
    accepted: normalized.length,
    rowCount: rowCount ?? 0,
    symbol,
    broker,
    downstreamBlocked: quarantine.rows[0].count > 0,
  };
}

async function upsertHeartbeat(body, apiKey) {
  if (!body || typeof body !== "object") return;
  const platform = String(body.platform ?? "mt5");
  const accountNumber = body.accountNumber != null ? String(body.accountNumber) : null;
  const brokerServer = body.brokerServer != null ? String(body.brokerServer) : null;
  if (!accountNumber) return;

  const broker = body.broker != null ? String(body.broker) : null;
  const accountType = body.accountType != null ? String(body.accountType) : null;
  const currency = body.currency != null ? String(body.currency) : null;
  const leverage = typeof body.leverage === "number" ? Math.round(body.leverage) : null;
  const label = body.label != null ? String(body.label) : null;
  const balance = typeof body.balance === "number" ? body.balance : null;
  const equity = typeof body.equity === "number" ? body.equity : null;

  await pool.query(
    `INSERT INTO mt5_terminals (
       platform, account_number, broker_server, broker, account_type,
       currency, leverage, label, balance, equity, last_seen_at, api_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
     ON CONFLICT (platform, account_number, broker_server)
     DO UPDATE SET
       broker = COALESCE(EXCLUDED.broker, mt5_terminals.broker),
       account_type = COALESCE(EXCLUDED.account_type, mt5_terminals.account_type),
       currency = COALESCE(EXCLUDED.currency, mt5_terminals.currency),
       leverage = COALESCE(EXCLUDED.leverage, mt5_terminals.leverage),
       label = COALESCE(EXCLUDED.label, mt5_terminals.label),
       balance = COALESCE(EXCLUDED.balance, mt5_terminals.balance),
       equity = COALESCE(EXCLUDED.equity, mt5_terminals.equity),
       last_seen_at = NOW()`,
    [
      platform,
      accountNumber,
      brokerServer,
      broker,
      accountType,
      currency,
      leverage,
      label,
      balance,
      equity,
      apiKey,
    ]
  );
}

async function forwardTrigger(symbol) {
  if (!FORWARD_TRIGGER) return { ok: false, reason: "forwarding_disabled" };
  const internalKey = process.env.INTERNAL_TRIGGER_API_KEY || "";
  return new Promise((resolve) => {
    const url = new URL(`/api/internal/trigger?symbol=${encodeURIComponent(symbol)}`, NEXT_APP_URL);
    const req = http.get(url, { timeout: TRIGGER_TIMEOUT_MS, headers: { "x-internal-api-key": internalKey } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        const ok = res.statusCode === 200;
        if (!ok) {
          log("warn", "forward trigger returned non-200", { symbol, status: res.statusCode, body: body.slice(0, 500) });
        } else {
          log("info", "forward trigger ok", { symbol, status: res.statusCode });
        }
        resolve({ ok, status: res.statusCode, body });
      });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(Object.assign(new Error("invalid JSON"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function handleRequest(req, res) {
  const apiKey = req.headers["x-api-key"] || "";

  if (req.method === "GET" && req.url === "/health") {
    let db = false;
    try {
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
      ]);
      db = true;
    } catch {
      db = false;
    }
    const stats = spool.spoolStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "ingestion",
        db,
        spoolFiles: stats.files,
        spoolBytes: stats.bytes,
      })
    );
    return;
  }

  if (!(await validateApiKey(apiKey))) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  try {
    const body = await readBody(req);

    if ((req.method === "POST" && req.url === "/api/ingest") || req.url === "/api/ingest/mt5/bars") {
      let result;
      try {
        result = await upsertBars(body);
      } catch (err) {
        if (err.statusCode === 400) throw err; // validation: client bug, never spool
        // Transient (DB down / timeout / admin-kill): spool durably and ack so
        // the EA advances its cursor. The drain loop replays once the DB is back.
        const barsCount = Array.isArray(body?.bars) ? body.bars.length : 0;
        let spooled = false;
        try {
          spool.appendToSpool(body);
          const dropped = spool.enforceSpoolCap(SPOOL_MAX_BYTES);
          if (dropped.length) log("error", "spool cap enforced, dropped oldest files", { dropped });
          spooled = true;
        } catch (spoolErr) {
          log("error", "spool write failed", { error: spoolErr.message });
        }
        if (!spooled) throw err; // disk unavailable -> 500 so the EA keeps its copy
        log("warn", "db write failed, bars spooled", {
          symbol: body?.symbol,
          bars: barsCount,
          error: err.message,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            spooled: true,
            accepted: barsCount,
            barsAccepted: barsCount,
            symbol: normalizeSymbol(body?.symbol || ""),
          })
        );
        return;
      }
      // Fire-and-forget pipeline trigger. The EA already retries; we must not block.
      if (!result.downstreamBlocked) {
        forwardTrigger(result.symbol).catch((err) =>
          log("warn", "pipeline trigger forward failed", { symbol: result.symbol, error: err.message })
        );
      } else {
        log("warn", "pipeline trigger blocked by candle quarantine", {
          symbol: result.symbol,
          broker: result.broker,
        });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result, barsAccepted: result.accepted }));
      log("info", "ingested bars", { symbol: result.symbol, accepted: result.accepted, rows: result.rowCount });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ingest/heartbeat") {
      await upsertHeartbeat(body, apiKey).catch((err) =>
        log("warn", "heartbeat db write failed", { error: err.message })
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    const status = err.statusCode || 500;
    log("error", "request failed", { url: req.url, status, error: err.message });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message, details: err.details ?? undefined }));
  }
}

let draining = false;
async function drainTick() {
  if (draining) return;
  if (spool.spoolStats().files === 0) return;
  draining = true;
  try {
    await pool.query("SELECT 1"); // is the DB reachable again?
    const drainedSymbols = new Set();
    const summary = await spool.drainSpool(async (payload) => {
      const r = await upsertBars(payload);
      drainedSymbols.add(r.symbol);
      return r;
    });
    if (summary.batchesSent > 0 || summary.quarantined > 0) {
      log("info", "spool drain pass", summary);
    }
    // Best-effort pipeline kick per drained symbol (once, not per batch).
    for (const sym of drainedSymbols) {
      if (!r.downstreamBlocked) forwardTrigger(sym).catch(() => {});
    }
  } catch (err) {
    log("warn", "spool drain skipped, db unreachable", { error: err.message });
  } finally {
    draining = false;
  }
}

module.exports = {
  isValidCandle,
  normalizeSymbol,
  normalizeBars,
  roundToMinute,
  pointsToPips,
  spool,
};

const server = http.createServer(handleRequest);

server.on("clientError", (err, socket) => {
  log("warn", "client error", { error: err.message });
  if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

function shutdown() {
  log("info", "shutting down");
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
}

if (require.main === module) {
  server.listen(PORT, () => {
    log("info", "ingestion server listening", {
      port: PORT,
      forwardTrigger: FORWARD_TRIGGER,
      spoolDir: spool.spoolDir(),
      drainIntervalMs: DRAIN_INTERVAL_MS,
    });
    // Replay anything left in the spool from a previous outage, then keep
    // draining on an interval. unref() so the timer never blocks shutdown.
    drainTick();
    setInterval(drainTick, DRAIN_INTERVAL_MS).unref();
  });

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
