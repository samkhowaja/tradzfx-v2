#!/usr/bin/env node
/**
 * promote-trusted-windows.js — promote certified candidate windows to status='trusted'.
 *
 * Governance:
 *   - Candidates are written by certify-trusted-windows.js (detector v5.2).
 *   - Promotion is a MANUAL decision: requires --apply + --reviewer=<name>.
 *   - Default mode is a dry-run listing of what WOULD be promoted.
 *   - Promotion sets status='trusted', promoted_at, promoted_by, and stamps
 *     canonical_version on the row for lineage.
 *   - Demotion (--demote) moves trusted -> candidate (superseded audit kept
 *     via promoted_* fields remaining as evidence of the prior promotion).
 *
 * Usage:
 *   node scripts/promote-trusted-windows.js                       # dry-run, list candidates
 *   node scripts/promote-trusted-windows.js --ids=46,48,51,54,55 --reviewer=salman --apply
 *   node scripts/promote-trusted-windows.js --symbol=XAUUSD --reviewer=salman --apply
 *   node scripts/promote-trusted-windows.js --all --reviewer=salman --apply
 *   node scripts/promote-trusted-windows.js --demote --ids=46 --reviewer=salman --apply
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const CANONICAL_VERSION = `canonical-m186-exclude-skip@${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: process.env.TM_DB_PORT || 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

function parseArgs() {
  const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return {
    apply: process.argv.includes("--apply"),
    demote: process.argv.includes("--demote"),
    all: process.argv.includes("--all"),
    ids: arg("ids") ? arg("ids").split(",").map((s) => parseInt(s.trim(), 10)) : null,
    symbol: arg("symbol") || null,
    reviewer: arg("reviewer") || null,
  };
}

async function main() {
  const { apply, demote, all, ids, symbol, reviewer } = parseArgs();

  // Filter params occupy $2.. (reserve $1 for reviewer in the UPDATE).
  const clauses = [];
  const params = [];
  if (ids) {
    clauses.push(`window_id = ANY($${params.length + 2})`);
    params.push(ids);
  }
  if (symbol) {
    clauses.push(`symbol = $${params.length + 2}`);
    params.push(symbol);
  }
  const targetStatus = demote ? "trusted" : "candidate";
  clauses.push(`status = '${targetStatus}'`);
  const where = `WHERE ${clauses.join(" AND ")}`;
  const selectWhere = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) - 1}`);

  const { rows } = await pool.query(
    `SELECT window_id, symbol, timeframe, window_start, window_end, detector_version, status,
            gate_summary->>'volatilityRegime' AS regime,
            gate_summary->>'rows' AS rows
     FROM market.trusted_windows ${selectWhere} ORDER BY symbol, window_start`,
    params
  );

  if (rows.length === 0) {
    console.log(`No ${targetStatus} windows matched the filter.`);
    await pool.end();
    return;
  }

  console.log(`${demote ? "DEMOTE" : "PROMOTE"} ${apply ? "(APPLY)" : "(DRY-RUN)"} — ${rows.length} window(s):\n`);
  for (const r of rows) {
    console.log(
      `  #${r.window_id} ${r.symbol} ${r.window_start.toISOString().slice(0, 10)}→${r.window_end.toISOString().slice(0, 10)}` +
      ` [${r.detector_version}] regime=${r.regime ?? "?"} rows=${r.rows ?? "?"}`
    );
  }

  if (!apply) {
    console.log(`\nDry-run. Re-run with --apply --reviewer=<name> to persist.`);
    await pool.end();
    return;
  }
  if (!reviewer) {
    console.error("FATAL: --apply requires --reviewer=<name> (audit trail).");
    process.exit(1);
  }
  if (!all && !ids && !symbol) {
    console.error("FATAL: --apply requires a target: --ids=..., --symbol=..., or --all.");
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let res;
    if (demote) {
      res = await client.query(
        `UPDATE market.trusted_windows
         SET status = 'candidate', superseded_at = now(), superseded_by = $1
         ${where}`,
        [reviewer, ...params]
      );
    } else {
      res = await client.query(
        `UPDATE market.trusted_windows
         SET status = 'trusted', promoted_at = now(), promoted_by = $1, canonical_version = $2
         ${where}`,
        [reviewer, CANONICAL_VERSION, ...params]
      );
    }
    await client.query("COMMIT");
    console.log(`\n${demote ? "Demoted" : "Promoted"}: ${res.rowCount} window(s) by ${reviewer}.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
