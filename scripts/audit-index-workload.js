#!/usr/bin/env node
"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", ".env.local"),
  quiet: true,
});
const { getPool } = require("../packages/shared/dist/index.js");

const TARGET_TABLES = [
  "market_levels",
  "feature_cache",
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

    const capability = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS extension_installed,
         current_setting('shared_preload_libraries', true) AS shared_preload_libraries,
         current_setting('pg_stat_statements.track', true) AS track_mode,
         current_setting('track_io_timing', true) AS track_io_timing`
    );
    const databaseStats = await client.query(
      `SELECT datname, stats_reset, xact_commit, xact_rollback,
              blks_read, blks_hit, tup_returned, tup_fetched, tup_inserted,
              tup_updated, tup_deleted
         FROM pg_stat_database
        WHERE datname = current_database()`
    );
    const tableStats = await client.query(
      `SELECT
         s.relname AS table_name,
         s.seq_scan, s.seq_tup_read, s.idx_scan, s.idx_tup_fetch,
         s.n_tup_ins, s.n_tup_upd, s.n_tup_del, s.n_live_tup, s.n_dead_tup,
         s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
       FROM pg_stat_user_tables s
       WHERE s.schemaname = 'public' AND s.relname = ANY($1::text[])
       ORDER BY s.relname`,
      [TARGET_TABLES]
    );
    const indexStats = await client.query(
      `SELECT
         s.relname AS table_name,
         s.indexrelname AS index_name,
         s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
         pg_relation_size(s.indexrelid)::bigint AS index_bytes,
         pg_get_indexdef(s.indexrelid) AS index_definition
       FROM pg_stat_user_indexes s
       WHERE s.schemaname = 'public' AND s.relname = ANY($1::text[])
       ORDER BY s.relname, pg_relation_size(s.indexrelid) DESC`,
      [TARGET_TABLES]
    );

    let statements = null;
    if (capability.rows[0].extension_installed) {
      const statementResult = await client.query(
        `SELECT queryid::text, calls, total_exec_time, mean_exec_time,
                rows, shared_blks_hit, shared_blks_read, temp_blks_read,
                temp_blks_written, query
           FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND query ~* $1
          ORDER BY total_exec_time DESC
          LIMIT 200`,
        [TARGET_TABLES.join("|")]
      );
      statements = statementResult.rows;
    }

    const foundTables = new Set(tableStats.rows.map((row) => row.table_name));
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          captured_at: new Date().toISOString(),
          capability: capability.rows[0],
          database_stats: databaseStats.rows[0] ?? null,
          tables: tableStats.rows,
          indexes: indexStats.rows,
          statements,
          missing_tables: TARGET_TABLES.filter((name) => !foundTables.has(name)),
        },
        null,
        2
      )
    );
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
