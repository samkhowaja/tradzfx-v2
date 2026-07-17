#!/usr/bin/env node

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { collectCapabilityMatrix, summarize } = require("./feature-capability.js");

function parseList(v) {
  return v ? String(v).split(",").map((s) => {
    const t = s.trim();
    // PowerShell can coerce an unquoted trailing "1d" token to "1".
    // Treat that specific value as the intended daily timeframe.
    return t === "1" ? "1d" : t;
  }).filter(Boolean) : undefined;
}

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function mdEscape(v) {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderMarkdown(matrix) {
  const counts = summarize(matrix);
  const blocking = matrix.rows.filter((r) =>
    ["MISSING_TABLE", "CONTRACT_MISMATCH", "EMPTY_DENSE", "STALE_STATE", "BLOCKED_LIFECYCLE", "PRODUCER_STALE"].includes(r.verdict)
  );
  const lines = [];
  lines.push("# Feature Capability Matrix");
  lines.push("");
  lines.push(`Generated: ${matrix.generatedAt}`);
  lines.push(`Window: ${matrix.from} -> ${matrix.to}`);
  lines.push(`Symbols: ${matrix.symbols.join(", ")}`);
  lines.push(`Timeframes: ${matrix.tfs.join(", ")}`);
  lines.push("");
  lines.push("## Verdict Summary");
  lines.push("");
  lines.push("| Verdict | Count |");
  lines.push("|---|---:|");
  for (const [verdict, count] of Object.entries(counts).sort()) {
    lines.push(`| ${verdict} | ${count} |`);
  }
  lines.push("");
  lines.push("## Blocking / Unsafe Surfaces");
  lines.push("");
  lines.push("| Verdict | Feature | Symbol | TF | Rows 90d | Latest | Latest Age h | Producer Age h | Lifecycle Age h | Missing Columns |");
  lines.push("|---|---|---|---|---:|---|---:|---:|---:|---|");
  for (const r of blocking.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.feature.localeCompare(b.feature))) {
    lines.push(
      `| ${r.verdict} | ${r.feature} | ${r.symbol} | ${r.tf ?? ""} | ${r.rows90d} | ${r.latestTs ?? ""} | ${r.latestAgeHours ?? ""} | ${r.producerAgeHours ?? ""} | ${r.lifecycleAgeHours ?? ""} | ${mdEscape(r.missingColumns.join(","))} |`
    );
  }
  if (blocking.length === 0) lines.push("| READY | - | - | - | 0 | - | - | - | - | - |");
  lines.push("");
  lines.push("## Full Matrix");
  lines.push("");
  lines.push("| Verdict | Feature | Semantic | Join | Symbol | TF | Rows 90d | Latest | Producer | Lifecycle |");
  lines.push("|---|---|---|---|---|---|---:|---|---|---|");
  for (const r of matrix.rows) {
    lines.push(
      `| ${r.verdict} | ${r.feature} | ${r.semanticType} | ${r.joinPolicy} | ${r.symbol} | ${r.tf ?? ""} | ${r.rows90d} | ${r.latestTs ?? ""} | ${r.producerFinishedAt ?? ""} | ${r.lifecycleLastProcessedTs ?? ""} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const days = Number(argValue("days", "90"));
  const symbols = parseList(argValue("symbols", ""));
  const tfs = parseList(argValue("tfs", "1m,5m,15m,1h,4h,1d"));
  const outDir = argValue("out-dir", "reports");
  if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number");

  const pool = new Pool({
    host: "localhost",
    port: 5432,
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: "postgres",
    password: process.env.TM_DB_PASSWORD,
    max: 3,
  });

  try {
    const matrix = await collectCapabilityMatrix(pool, { days, symbols, tfs });
    fs.mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, "feature-capability-latest.json");
    const mdPath = path.join(outDir, "feature-capability-latest.md");
    fs.writeFileSync(jsonPath, `${JSON.stringify(matrix, null, 2)}\n`);
    fs.writeFileSync(mdPath, renderMarkdown(matrix));
    console.log(`[feature-capability] wrote ${jsonPath}`);
    console.log(`[feature-capability] wrote ${mdPath}`);
    console.log("[feature-capability] verdicts:", summarize(matrix));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[feature-capability] fatal:", err);
  process.exit(1);
});
