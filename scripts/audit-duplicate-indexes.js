#!/usr/bin/env node
"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", ".env.local"),
  quiet: true,
});
const { getPool } = require("../packages/shared/dist/index.js");

const PAIRS = [
  ["zone_touch_events_pkey", "idx_zone_touch_events_zone"],
  ["feature_config_snapshot_content_hash_key", "idx_feature_config_snapshot_hash"],
  ["strategy_settings_snapshot_content_hash_key", "idx_strategy_settings_snapshot_hash"],
];

async function main() {
  const pool = getPool();
  const expectRemoved = process.argv.includes("--expect-removed");
  try {
    const names = PAIRS.flat();
    const { rows } = await pool.query(
      `SELECT
         i.relname AS index_name,
         t.relname AS table_name,
         pg_get_indexdef(i.oid) AS index_definition,
         x.indkey::text AS key_columns,
         x.indclass::text AS operator_classes,
         pg_get_expr(x.indpred, x.indrelid) AS predicate,
         pg_get_expr(x.indexprs, x.indrelid) AS expressions,
         pg_relation_size(i.oid)::bigint AS bytes,
         c.conname AS owning_constraint
       FROM pg_class i
       JOIN pg_index x ON x.indexrelid = i.oid
       JOIN pg_class t ON t.oid = x.indrelid
       LEFT JOIN pg_constraint c ON c.conindid = i.oid
       WHERE i.relname = ANY($1::text[])
       ORDER BY t.relname, i.relname`,
      [names]
    );

    const byName = new Map(rows.map((row) => [row.index_name, row]));
    const findings = PAIRS.map(([keeperName, duplicateName]) => {
      const keeper = byName.get(keeperName);
      const duplicate = byName.get(duplicateName);
      const exact = Boolean(
        keeper &&
          duplicate &&
          keeper.table_name === duplicate.table_name &&
          keeper.key_columns === duplicate.key_columns &&
          keeper.operator_classes === duplicate.operator_classes &&
          keeper.predicate === duplicate.predicate &&
          keeper.expressions === duplicate.expressions
      );
      return {
        keeper: keeper ?? null,
        duplicate: duplicate ?? null,
        exact,
        duplicate_is_constraint_owned: Boolean(duplicate?.owning_constraint),
        removed_safely: Boolean(keeper && !duplicate),
      };
    });

    console.log(
      JSON.stringify(
        { mode: "read-only", expectation: expectRemoved ? "removed" : "duplicates", findings },
        null,
        2
      )
    );
    const invalid = expectRemoved
      ? findings.some((finding) => !finding.removed_safely)
      : findings.some((finding) => !finding.exact || finding.duplicate_is_constraint_owned);
    if (invalid) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
