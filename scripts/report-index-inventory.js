#!/usr/bin/env node
"use strict";

/**
 * DB-INDEX-01/02: read-only index inventory + duplicate/redundancy report.
 *
 * Scans every user index in all non-system schemas, computes a structural
 * fingerprint (table + key columns + opclasses + predicate + expressions),
 * and reports:
 *   - full inventory (name, table, size, scans, constraint-owned?)
 *   - EXACT duplicates (identical fingerprint, different index name)
 *   - REDUNDANT candidates (non-unique index whose key columns are a proper
 *     left-prefix of another non-unique index on the same table with the
 *     same predicate — the wider index can serve the narrower one's scans)
 *
 * Never writes to the DB. Output: reports/index-inventory-<date>.{json,md}
 * plus a console summary. Exit 0 always (reporting tool, not a gate).
 *
 * Usage: node scripts/report-index-inventory.js [--schemas=public,market] [--min-bytes=0]
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", ".env.local"),
  quiet: true,
});
const fs = require("fs");
const path = require("path");
const { getPool } = require("../packages/shared/dist/index.js");

const arg = (name, fallback) =>
  process.argv.find((x) => x.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const SCHEMAS = arg("schemas", "public,market").split(",").map((s) => s.trim()).filter(Boolean);
const MIN_BYTES = Number(arg("min-bytes", "0"));

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query(
      `SELECT DISTINCT ON (i.oid)
         n.nspname AS schema,
         t.relname AS table_name,
         i.relname AS index_name,
         x.indisunique AS is_unique,
         x.indisprimary AS is_primary,
         c.conname AS owning_constraint,
         x.indkey::text AS key_columns,
         (SELECT array_agg(oc.opcname ORDER BY k.ord)
            FROM unnest(x.indclass) WITH ORDINALITY AS k(oid, ord)
            JOIN pg_opclass oc ON oc.oid = k.oid) AS operator_classes,
         pg_get_expr(x.indpred, x.indrelid) AS predicate,
         pg_get_expr(x.indexprs, x.indrelid) AS expressions,
         pg_relation_size(i.oid)::bigint AS bytes,
         COALESCE(MAX(s.idx_scan) OVER (PARTITION BY i.oid), 0)::bigint AS scans,
         pg_get_indexdef(i.oid) AS index_definition
       FROM pg_class i
       JOIN pg_index x ON x.indexrelid = i.oid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       LEFT JOIN pg_constraint c ON c.conindid = i.oid
       LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
       WHERE n.nspname = ANY($1::text[]) AND pg_relation_size(i.oid) >= $2
       ORDER BY i.oid, n.nspname, t.relname, i.relname`,
      [SCHEMAS, MIN_BYTES]
    );

    // Structural fingerprint: two indexes are exact duplicates iff identical.
    const fingerprint = (r) =>
      JSON.stringify({
        t: `${r.schema}.${r.table_name}`,
        k: r.key_columns,
        o: r.operator_classes,
        p: r.predicate,
        e: r.expressions,
        u: r.is_unique,
      });

    // Exact duplicates: same fingerprint, different names.
    const byFingerprint = new Map();
    for (const r of rows) {
      const fp = fingerprint(r);
      if (!byFingerprint.has(fp)) byFingerprint.set(fp, []);
      byFingerprint.get(fp).push(r);
    }
    const exactDuplicates = [...byFingerprint.values()]
      .filter((group) => group.length > 1)
      .map((group) => ({
        table: `${group[0].schema}.${group[0].table_name}`,
        indexes: group
          .map((g) => ({
            index_name: g.index_name,
            bytes: g.bytes,
            scans: g.scans,
            constraint_owned: Boolean(g.owning_constraint),
            primary: g.is_primary,
          }))
          .sort((a, b) => Number(b.bytes - a.bytes)),
        reclaimable_bytes: group
          .slice(1)
          .reduce((total, g) => total + (g.owning_constraint ? 0 : Number(g.bytes)), 0),
      }));

    // Redundant left-prefix candidates (non-unique, no constraint, same table
    // + same predicate + same expression-ness): index A is redundant if a
    // wider non-unique index B exists with A's key columns as a left prefix.
    // indkey is an int2vector string like "1 2 3" (0 = expression column).
    const keyList = (r) => String(r.key_columns).trim().split(/\s+/);
    const redundant = [];
    const byTable = new Map();
    for (const r of rows) {
      if (r.is_unique || r.owning_constraint || r.expressions) continue;
      const key = `${r.schema}.${r.table_name}|${r.predicate ?? ""}`;
      if (!byTable.has(key)) byTable.set(key, []);
      byTable.get(key).push(r);
    }
    for (const group of byTable.values()) {
      for (const narrow of group) {
        const nk = keyList(narrow);
        if (nk.includes("0")) continue; // expression keys: skip prefix logic
        for (const wide of group) {
          if (wide === narrow) continue;
          const wk = keyList(wide);
          if (wk.length <= nk.length) continue;
          if (nk.every((col, i) => col === wk[i])) {
            redundant.push({
              table: `${narrow.schema}.${narrow.table_name}`,
              redundant_index: narrow.index_name,
              redundant_bytes: Number(narrow.bytes),
              redundant_scans: Number(narrow.scans),
              covered_by: wide.index_name,
              covered_by_bytes: Number(wide.bytes),
            });
            break; // first covering index is enough
          }
        }
      }
    }

    const totalBytes = rows.reduce((t, r) => t + Number(r.bytes), 0);
    const dupeBytes = exactDuplicates.reduce((t, d) => t + Number(d.reclaimable_bytes), 0);
    const redundantBytes = redundant.reduce((t, r) => t + r.redundant_bytes, 0);
    const neverScanned = rows.filter((r) => Number(r.scans) === 0 && !r.owning_constraint);

    const report = {
      generated_at: new Date().toISOString(),
      mode: "read-only",
      schemas: SCHEMAS,
      totals: {
        indexes: rows.length,
        bytes: totalBytes,
        exact_duplicate_groups: exactDuplicates.length,
        exact_duplicate_reclaimable_bytes: dupeBytes,
        redundant_prefix_candidates: redundant.length,
        redundant_prefix_bytes: redundantBytes,
        never_scanned_non_constraint: neverScanned.length,
      },
      exact_duplicates: exactDuplicates,
      redundant_prefix_candidates: redundant.sort((a, b) => b.redundant_bytes - a.redundant_bytes),
      never_scanned: neverScanned
        .map((r) => ({
          schema: r.schema,
          table_name: r.table_name,
          index_name: r.index_name,
          bytes: Number(r.bytes),
        }))
        .sort((a, b) => b.bytes - a.bytes),
      inventory: rows.map((r) => ({
        schema: r.schema,
        table_name: r.table_name,
        index_name: r.index_name,
        unique: r.is_unique,
        primary: r.is_primary,
        constraint_owned: Boolean(r.owning_constraint),
        bytes: Number(r.bytes),
        scans: Number(r.scans),
        definition: r.index_definition,
      })),
    };

    const date = report.generated_at.slice(0, 10);
    const reportsDir = path.resolve(__dirname, "..", "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    const jsonPath = path.join(reportsDir, `index-inventory-${date}.json`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

    const mb = (b) => (b / 1024 / 1024).toFixed(1);
    const md = [
      `# Index inventory ${date} (DB-INDEX-01/02, read-only)`,
      "",
      `- Indexes scanned: ${report.totals.indexes} (${mb(totalBytes)} MB) across schemas: ${SCHEMAS.join(", ")}`,
      `- Exact duplicate groups: ${exactDuplicates.length} (reclaimable ~${mb(dupeBytes)} MB)`,
      `- Redundant left-prefix candidates: ${redundant.length} (~${mb(redundantBytes)} MB)`,
      `- Never-scanned non-constraint indexes: ${neverScanned.length}`,
      "",
      "## Exact duplicates",
      ...(exactDuplicates.length
        ? exactDuplicates.map(
            (d) =>
              `- ${d.table}: ${d.indexes.map((i) => `\`${i.index_name}\` (${mb(i.bytes)} MB, ${i.scans} scans${i.constraint_owned ? ", constraint-owned" : ""})`).join(" + ")}`
          )
        : ["- none"]),
      "",
      "## Redundant left-prefix candidates (review before dropping)",
      ...(redundant.length
        ? redundant
            .slice(0, 25)
            .map(
              (r) =>
                `- ${r.table}: \`${r.redundant_index}\` (${mb(r.redundant_bytes)} MB, ${r.redundant_scans} scans) covered by \`${r.covered_by}\``
            )
        : ["- none"]),
      "",
      "Full detail: index-inventory-" + date + ".json",
      "",
    ].join("\n");
    const mdPath = path.join(reportsDir, `index-inventory-${date}.md`);
    fs.writeFileSync(mdPath, md);

    console.log(`indexes=${rows.length} bytes=${mb(totalBytes)}MB exact_dupe_groups=${exactDuplicates.length} (~${mb(dupeBytes)}MB) redundant_prefix=${redundant.length} (~${mb(redundantBytes)}MB) never_scanned=${neverScanned.length}`);
    console.log(`wrote ${path.relative(process.cwd(), jsonPath)}`);
    console.log(`wrote ${path.relative(process.cwd(), mdPath)}`);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
