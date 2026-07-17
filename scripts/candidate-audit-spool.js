/**
 * Candidate audit spool writer.
 *
 * Appends signal candidates to a daily JSONL spool file. A batch inserter
 * drains the spool into `strategy_signal_candidates` on a tick. Failures
 * quarantine instead of blocking the trade decision — audit writes must
 * never be able to fail the decision they record.
 *
 * Pattern proven by the ingest-resilience work (scripts/ingest-spool.js).
 * (RC-7 / Bugs #12, #15)
 */

const fs = require("fs");
const path = require("path");

const SPOOL_DIR = path.join(__dirname, "..", "logs", "candidate-spool");

// Ensure the spool directory exists.
try {
  fs.mkdirSync(SPOOL_DIR, { recursive: true });
} catch {
  // Directory may already exist or be on a read-only filesystem — fail silently.
}

function spoolFilePath(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return path.join(SPOOL_DIR, `candidates-${day}.jsonl`);
}

/**
 * Append a candidate record to the daily JSONL spool. This is synchronous
 * (fs.appendFileSync) so the write completes before the trade decision
 * proceeds — but it's a single file append, not a DB round-trip, so it's
 * fast (~0.1ms). If the write fails, the error is logged but NOT thrown —
 * the trade decision proceeds regardless.
 */
function appendCandidate(candidate) {
  const record = {
    ...candidate,
    created_at: new Date().toISOString(),
  };
  try {
    fs.appendFileSync(spoolFilePath(), JSON.stringify(record) + "\n");
  } catch (err) {
    // Audit write failure must never block a trade decision.
    console.warn(`[candidate-audit] Failed to spool candidate: ${err.message}`);
  }
}

/**
 * Batch-insert all spooled candidates for a given date (or today) into the
 * `strategy_signal_candidates` table. Called on a tick by the live runner
 * or the backtest runner after the run completes.
 *
 * Returns { inserted, errors }.
 */
async function drainSpool(pool, date = new Date()) {
  const filePath = spoolFilePath(date);
  if (!fs.existsSync(filePath)) {
    return { inserted: 0, errors: 0 };
  }

  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) {
    return { inserted: 0, errors: 0 };
  }

  const records = [];
  let errors = 0;
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      errors++;
    }
  }

  if (records.length === 0) {
    // Clean up the spool file even if all lines were corrupt.
    try { fs.unlinkSync(filePath); } catch {}
    return { inserted: 0, errors };
  }

  const columns = [
    "strategy_id", "symbol", "tf", "ts", "side", "entry_price", "stop_loss",
    "take_profit", "bias_direction", "setup_family", "setup_grade",
    "setup_block_reasons", "gate_results", "decision_stage", "decision_reason",
    "feature_snapshot", "fingerprint", "dedup_check_result", "engine_version",
    "spec_hash", "source",
  ];

  const placeholders = [];
  const values = [];
  let idx = 1;
  for (const r of records) {
    placeholders.push(
      `(${columns.map(() => `$${idx++}`).join(", ")})`
    );
    values.push(
      r.strategy_id ?? null,
      r.symbol ?? null,
      r.tf ?? null,
      r.ts ?? null,
      r.side ?? null,
      r.entry_price ?? null,
      r.stop_loss ?? null,
      r.take_profit ?? null,
      r.bias_direction ?? null,
      r.setup_family ?? null,
      r.setup_grade ?? null,
      r.setup_block_reasons ? JSON.stringify(r.setup_block_reasons) : null,
      r.gate_results ? JSON.stringify(r.gate_results) : null,
      r.decision_stage ?? "unknown",
      r.decision_reason ?? null,
      r.feature_snapshot ? JSON.stringify(r.feature_snapshot) : null,
      r.fingerprint ?? null,
      r.dedup_check_result ?? null,
      r.engine_version ?? null,
      r.spec_hash ?? null,
      r.source ?? "backtest",
    );
  }

  try {
    const res = await pool.query(
      `INSERT INTO strategy_signal_candidates (${columns.join(", ")})
       VALUES ${placeholders.join(", ")}
       ON CONFLICT DO NOTHING`,
      values
    );
    // Clean up the spool file after successful insert.
    try { fs.unlinkSync(filePath); } catch {}
    return { inserted: res.rowCount ?? 0, errors };
  } catch (err) {
    console.error(`[candidate-audit] Batch insert failed: ${err.message}`);
    // Keep the spool file for retry on the next drain.
    return { inserted: 0, errors: errors + records.length };
  }
}

module.exports = { appendCandidate, drainSpool, spoolFilePath };
