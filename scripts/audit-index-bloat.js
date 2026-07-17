#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { getPool } = require("../packages/shared/dist/index.js");

const TARGET_TABLES = [
  "features_pivot",
  "features_session_hl",
  "features_zone",
  "features_ifvg",
  "features_structure",
  "features_order_block",
];

async function main() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN READ ONLY");

    const extension = await client.query(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgstattuple') AS installed"
    );
    if (!extension.rows[0].installed) {
      throw new Error(
        "pgstattuple is not installed; install it through an approved DBA change before measuring bloat"
      );
    }

    const relations = await client.query(
      `SELECT
         n.nspname AS schema_name,
         c.relname AS table_name,
         c.reltuples::bigint AS estimated_rows,
         pg_total_relation_size(c.oid)::bigint AS total_bytes,
         pg_relation_size(c.oid)::bigint AS heap_bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
         AND c.relkind IN ('r', 'p')
       ORDER BY c.relname`,
      [TARGET_TABLES]
    );

    const results = [];
    for (const relation of relations.rows) {
      const qualified = `public.${relation.table_name}`;
      const tableStats = await client.query(
        `SELECT table_len::bigint, tuple_count::bigint, tuple_percent,
                dead_tuple_count::bigint, dead_tuple_percent, free_space::bigint,
                free_percent
           FROM pgstattuple($1::regclass)`,
        [qualified]
      );
      const indexes = await client.query(
        `SELECT i.indexrelid::regclass::text AS index_name,
                pg_relation_size(i.indexrelid)::bigint AS index_bytes
           FROM pg_index i
          WHERE i.indrelid = $1::regclass
          ORDER BY pg_relation_size(i.indexrelid) DESC`,
        [qualified]
      );

      const indexStats = [];
      for (const index of indexes.rows) {
        const stats = await client.query(
          `SELECT version, tree_level, index_size::bigint, root_block_no,
                  internal_pages, leaf_pages, empty_pages, deleted_pages,
                  avg_leaf_density, leaf_fragmentation
             FROM pgstatindex($1::regclass)`,
          [index.index_name]
        );
        indexStats.push({ ...index, ...stats.rows[0] });
      }

      results.push({
        ...relation,
        table_stats: tableStats.rows[0],
        indexes: indexStats,
      });
    }

    const missing = TARGET_TABLES.filter(
      (name) => !relations.rows.some((row) => row.table_name === name)
    );
    console.log(JSON.stringify({ mode: "read-only", results, missing }, null, 2));
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
