#!/usr/bin/env node
/**
 * P3.0 guardrail — verify every FEATURE_REGISTRY contract names columns that
 * actually exist on its table. Catches the P2c-class drift where a contract
 * advertises a column the table lacks (e.g. features_ifvg.zone_kind,
 * features_order_block.quality_score, features_time_of_day_edge.value) so the
 * compiler never emits `DISTINCT ON` / `ORDER BY` SQL that 42703s at runtime.
 *
 * Read-only. Usage: node scripts/audit-feature-contracts.js
 * Exit 1 if any contract FAILs.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { FEATURE_REGISTRY } = require("../packages/strategies/dist/featureRegistry.js");

const SQL_WORDS = new Set([
  "asc", "desc", "nulls", "last", "first",
  "case", "when", "then", "else", "end",
  "and", "or", "not", "is", "null", "true", "false",
]);
const IDENT = /\b[a-z_][a-z0-9_]*\b/gi;

function tieBreakerColumns(tb) {
  if (!tb) return [];
  // Remove SQL string literals before tokenizing. Remaining non-keyword
  // identifiers are column references, including columns inside CASE clauses.
  const expression = tb.replace(/'(?:''|[^'])*'/g, " ");
  return [...new Set(
    (expression.match(IDENT) ?? []).filter((tok) => !SQL_WORDS.has(tok.toLowerCase()))
  )];
}

(async () => {
  const pool = new Pool({
    host: "localhost", port: 5432,
    database: process.env.TM_DB_NAME, user: "postgres", password: process.env.TM_DB_PASSWORD,
  });
  const failures = [];
  const skipped = [];
  let checked = 0;

  try {
    for (const [key, c] of Object.entries(FEATURE_REGISTRY)) {
      const table = c.table || key;
      const { rows } = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
        [table]
      );
      if (rows.length === 0) { skipped.push(`${key} (table ${table} not present)`); continue; }
      const cols = new Set(rows.map((r) => r.column_name));

      const referenced = new Set([
        ...(c.requiredColumns ?? []),
        ...(c.equalityGroupByDefaults ?? []),
        ...tieBreakerColumns(c.tieBreaker),
        c.timeColumn,
        c.timeframeColumn,
        c.validityColumns?.invalidatedAt,
        c.validityColumns?.mitigatedAt,
        c.validityColumns?.createdAt,
      ].filter(Boolean));

      const missing = [...referenced].filter((col) => !cols.has(col));
      checked++;
      if (missing.length) {
        failures.push({ key, table, missing: [...new Set(missing)] });
      }
    }

    console.log(`contracts checked: ${checked} | skipped (no table): ${skipped.length} | FAIL: ${failures.length}`);
    if (skipped.length) console.log("  skipped:", skipped.join(", "));
    if (failures.length) {
      console.log("\nFAILURES (contract references a column the table lacks):");
      for (const f of failures) console.log(`  ${f.key} [${f.table}]: missing ${f.missing.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("OK: every contract token resolves to a real column.");
    }
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(2); });
