/**
 * Repair stale required feature surfaces in a conservative producer DAG.
 *
 * This is not a new feature producer. It orchestrates the existing, proven
 * tools in the right order and fails closed with a capability matrix at the end.
 *
 * Usage:
 *   node scripts/run-producer-freshness-dag.js XAUUSD 5m --features=features_bias,features_pricing,features_atr,features_moving_average --days=90 --apply
 *
 * Without --apply, prints the plan only.
 */

require("dotenv").config({ path: ".env.local" });
const { spawnSync } = require("child_process");
const { Pool } = require("pg");
const { collectCapabilityMatrix, summarize } = require("./feature-capability.js");

const DEFAULT_FEATURES = [
  "features_atr",
  "features_pivot",
  "features_htf_bias",
  "features_bias",
  "features_pricing",
  "features_moving_average",
  "features_structure",
  "features_zone",
  "features_displacement",
  "features_zone_retest",
];

const LEAF_RECENT_FEATURES = new Set(["features_atr"]);
const BLOCKING_VERDICTS = new Set([
  "MISSING_TABLE",
  "CONTRACT_MISMATCH",
  "EMPTY_DENSE",
  "BLOCKED_LIFECYCLE",
  "STALE_STATE",
  "PRODUCER_STALE",
]);

function parseArgs(argv) {
  const positionals = argv.filter((a) => !a.startsWith("--"));
  const flag = (name, fallback = null) => {
    const found = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!found) return fallback;
    if (found === `--${name}`) return true;
    return found.slice(name.length + 3);
  };
  return {
    symbols: (positionals[0] || "XAUUSD").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    tfs: (positionals[1] || "5m").split(",").map((s) => s.trim()).filter(Boolean),
    features: String(flag("features", DEFAULT_FEATURES.join(","))).split(",").map((s) => s.trim()).filter(Boolean),
    days: Number(flag("days", "90")),
    apply: argv.includes("--apply"),
    skipCaggs: argv.includes("--skip-caggs"),
    skipLifecycle: argv.includes("--skip-lifecycle"),
    skipTouchLedger: argv.includes("--skip-touch-ledger"),
  };
}

function run(cmd, args, opts = {}) {
  console.log(`[freshness-dag] $ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...opts.env },
  });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(" ")}`);
  }
}

function hoursToRepair(row, minimum = 48) {
  const h = Number(row.latestAgeHours ?? row.producerAgeHours ?? minimum);
  return Math.max(minimum, Math.ceil(h + 24));
}

function backfillStart(row, days) {
  if (!row.latestTs) return null;
  const latest = new Date(row.latestTs);
  const contextMs = days * 24 * 60 * 60 * 1000;
  return new Date(latest.getTime() - contextMs).toISOString();
}

function buildPlan(matrix, opts) {
  const wantedFeatures = new Set(opts.features);
  const wantedTfs = new Set(opts.tfs);
  const rows = matrix.rows.filter(
    (r) => wantedFeatures.has(r.table) && (!r.tf || wantedTfs.has(r.tf))
  );
  const unsafe = rows.filter((r) => BLOCKING_VERDICTS.has(r.verdict));
  const tasks = [];

  if (!opts.skipCaggs) {
    tasks.push({ kind: "caggs", cmd: "node", args: ["scripts/refresh-candle-caggs.js"] });
  }

  for (const symbol of opts.symbols) {
    for (const tf of opts.tfs) {
      const tfRows = unsafe.filter((r) => r.symbol === symbol && r.tf === tf);
      const leafRows = tfRows.filter((r) => LEAF_RECENT_FEATURES.has(r.table));
      for (const row of leafRows) {
        tasks.push({
          kind: "leaf-recompute",
          feature: row.table,
          symbol,
          tf,
          verdict: row.verdict,
          cmd: "node",
          args: [
            "scripts/recompute-feature-recent.js",
            symbol,
            row.table,
            String(hoursToRepair(row)),
            tf,
            "500",
            "--htf-safe",
          ],
        });
      }

      const derived = tfRows.filter((r) => !LEAF_RECENT_FEATURES.has(r.table));
      if (derived.length > 0) {
        const features = [...new Set(derived.map((r) => r.table))];
        const starts = derived.map((r) => backfillStart(r, 3)).filter(Boolean).sort();
        const start = starts[0];
        const end = derived.find((r) => r.dataEdgeTs)?.dataEdgeTs;
        const args = [
          "scripts/backfill-historical-features.js",
          symbol,
          tf,
          `--features=${features.join(",")}`,
        ];
        if (start) args.push(`--start=${start}`);
        if (end) args.push(`--end=${end}`);
        args.push("--lifecycle-per-tf");
        tasks.push({
          kind: "derived-backfill",
          feature: features.join(","),
          symbol,
          tf,
          verdict: [...new Set(derived.map((r) => r.verdict))].join(","),
          cmd: "node",
          args,
        });
      }
    }
  }

  if (!opts.skipLifecycle) {
    for (const symbol of opts.symbols) {
      for (const tf of opts.tfs) {
        tasks.push({
          kind: "lifecycle",
          symbol,
          tf,
          cmd: "node",
          args: ["scripts/drain-lifecycle.js", symbol, "10", "500", "--table=features_zone", `--tf=${tf}`],
        });
      }
    }
  }

  if (!opts.skipTouchLedger) {
    for (const symbol of opts.symbols) {
      for (const tf of opts.tfs) {
        tasks.push({
          kind: "touch-ledger",
          symbol,
          tf,
          cmd: "node",
          args: ["scripts/drain-zone-touch-events.js", symbol, "10", "500", `--tf=${tf}`],
        });
      }
    }
  }

  tasks.push({
    kind: "capability",
    cmd: "node",
    args: [
      "scripts/generate-feature-capability-matrix.js",
      `--symbols=${opts.symbols.join(",")}`,
      `--tfs=${opts.tfs.join(",")}`,
      `--days=${opts.days}`,
    ],
  });
  return { rows, unsafe, tasks };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: Number(process.env.TM_DB_PORT || "5432"),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
    max: 2,
  });
  let poolClosed = false;

  try {
    const matrix = await collectCapabilityMatrix(pool, {
      symbols: opts.symbols,
      tfs: opts.tfs,
      days: opts.days,
    });
    const plan = buildPlan(matrix, opts);
    console.log(`[freshness-dag] Symbols: ${opts.symbols.join(", ")} | TFs: ${opts.tfs.join(", ")} | apply=${opts.apply}`);
    console.log(`[freshness-dag] Matrix verdicts: ${JSON.stringify(summarize(matrix))}`);
    console.log(`[freshness-dag] Unsafe selected surfaces: ${plan.unsafe.length}`);
    for (const row of plan.unsafe) {
      console.log(`  - ${row.table}@${row.tf ?? "*"} ${row.symbol}: ${row.verdict} latest=${row.latestTs ?? "-"} age=${row.latestAgeHours ?? "-"}h producer=${row.producerAgeHours ?? "-"}h`);
    }
    console.log(`[freshness-dag] Planned tasks: ${plan.tasks.length}`);
    for (const [i, task] of plan.tasks.entries()) {
      console.log(`  ${i + 1}. ${task.kind}${task.symbol ? ` ${task.symbol}` : ""}${task.tf ? `@${task.tf}` : ""}${task.feature ? ` ${task.feature}` : ""}`);
    }

    if (!opts.apply) {
      console.log("[freshness-dag] Dry run only. Re-run with --apply to execute.");
      return;
    }

    await pool.end();
    poolClosed = true;
    for (const task of plan.tasks) run(task.cmd, task.args);
  } finally {
    if (!poolClosed) await pool.end();
  }
}

module.exports = { parseArgs, buildPlan, BLOCKING_VERDICTS, LEAF_RECENT_FEATURES };

if (require.main === module) {
  main().catch((err) => {
    console.error("[freshness-dag] Fatal:", err.message);
    process.exit(1);
  });
}
