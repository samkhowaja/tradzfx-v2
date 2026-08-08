#!/usr/bin/env node
/**
 * Disk spool for the MT5 ingestion server.
 *
 * When PostgreSQL is unavailable, bar batches are appended as JSONL to
 *   logs/ingest-spool/ingest-YYYY-MM-DD.jsonl
 * and replayed FIFO (oldest file first, then top-to-bottom) once the DB is
 * reachable again. Replays are safe: candles_1m has PRIMARY KEY
 * (symbol, broker, ts) with ON CONFLICT DO UPDATE, so draining the same batch
 * twice is idempotent.
 *
 * Failure semantics:
 *  - A batch that fails validation (statusCode 400) is never spooled — it is a
 *    client bug, not an outage. (The caller enforces this; spooled payloads
 *    have already passed validation, so drain-time 400s are quarantined.)
 *  - A batch that fails with a transient error (DB down, timeout, admin-kill)
 *    during a drain stays in the spool: the file is rewritten with the
 *    not-yet-sent lines and the drain stops until the next tick.
 *  - Unparseable / permanently-invalid lines are quarantined to
 *    corrupt.jsonl so one poison line can never wedge the queue.
 *  - Total spool size is capped (default 250 MB ≈ months of bars for all
 *    symbols); the cap drops the OLDEST files first and logs loudly.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_SPOOL_DIR = path.join(__dirname, "..", "logs", "ingest-spool");
const DEFAULT_MAX_BYTES = 250 * 1024 * 1024;

function spoolDir(opts = {}) {
  return opts.dir || process.env.INGEST_SPOOL_DIR || DEFAULT_SPOOL_DIR;
}

function spoolFileName(date = new Date()) {
  return `ingest-${date.toISOString().slice(0, 10)}.jsonl`; // UTC day
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Append one batch payload as a JSONL record. Returns the file path. */
function appendToSpool(payload, opts = {}) {
  const dir = spoolDir(opts);
  ensureDir(dir);
  const file = path.join(dir, spoolFileName());
  const line = JSON.stringify({ spooledAt: new Date().toISOString(), payload }) + "\n";
  fs.appendFileSync(file, line);
  return file;
}

/** All spool files, chronological (date-based names sort lexically). */
function listSpoolFiles(opts = {}) {
  const dir = spoolDir(opts);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^ingest-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .map((f) => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { name: f, path: p, size: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function spoolStats(opts = {}) {
  const files = listSpoolFiles(opts);
  return { files: files.length, bytes: files.reduce((s, f) => s + f.size, 0) };
}

/** Drop oldest files until total size <= maxBytes. Returns deleted names. */
function enforceSpoolCap(maxBytes = DEFAULT_MAX_BYTES, opts = {}) {
  const files = listSpoolFiles(opts);
  let total = files.reduce((s, f) => s + f.size, 0);
  const deleted = [];
  for (const f of files) {
    if (total <= maxBytes) break;
    fs.unlinkSync(f.path);
    total -= f.size;
    deleted.push(f.name);
  }
  return deleted;
}

function quarantineLine(dir, line) {
  ensureDir(dir);
  fs.appendFileSync(path.join(dir, "corrupt.jsonl"), line + "\n");
}

/**
 * Replay spool files oldest-first through `upsert(payload)`.
 *
 * @param {(payload: object) => Promise<any>} upsert
 * @returns {Promise<{filesSeen, filesDrained, batchesSent, quarantined, stoppedEarly, error}>}
 */
async function drainSpool(upsert, opts = {}) {
  const dir = spoolDir(opts);
  const files = listSpoolFiles(opts);
  const summary = {
    filesSeen: files.length,
    filesDrained: 0,
    batchesSent: 0,
    quarantined: 0,
    stoppedEarly: false,
    error: null,
  };

  for (const f of files) {
    const lines = fs
      .readFileSync(f.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);

    let i = 0;
    for (; i < lines.length; i++) {
      let rec;
      try {
        rec = JSON.parse(lines[i]);
      } catch {
        quarantineLine(dir, lines[i]);
        summary.quarantined++;
        continue;
      }
      try {
        await upsert(rec.payload, { fileName: path.basename(f.path) });
        summary.batchesSent++;
      } catch (err) {
        if (err && err.statusCode === 400) {
          // Permanent: should be near-impossible (spooled payloads already
          // passed validation). Quarantine so it can't wedge the queue.
          quarantineLine(dir, lines[i]);
          summary.quarantined++;
          continue;
        }
        // Transient: keep this line and everything after it, stop draining.
        fs.writeFileSync(f.path, lines.slice(i).join("\n") + "\n");
        summary.stoppedEarly = true;
        summary.error = err.message;
        return summary;
      }
    }
    fs.unlinkSync(f.path);
    summary.filesDrained++;
  }
  return summary;
}

module.exports = {
  DEFAULT_SPOOL_DIR,
  DEFAULT_MAX_BYTES,
  spoolDir,
  spoolFileName,
  appendToSpool,
  listSpoolFiles,
  spoolStats,
  enforceSpoolCap,
  drainSpool,
};
