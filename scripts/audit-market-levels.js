#!/usr/bin/env node
"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", ".env.local"),
  quiet: true,
});
const { getPool } = require("../packages/shared/dist/index.js");

const RELATION = "public.market_levels";
const EXACT = process.argv.includes("--exact");
const SAMPLE_LIMIT = 100000;

async function query(client, text, params = []) {
  return (await client.query(text, params)).rows;
}

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '10min'");

    const identity = await query(
      client,
      `SELECT
         c.oid::bigint AS oid,
         n.nspname AS schema_name,
         c.relname,
         c.relkind,
         c.relpersistence,
         c.relpages,
         c.reltuples::bigint AS estimated_rows,
         c.relallvisible,
         c.reltoastrelid::regclass::text AS toast_relation,
         pg_relation_filenode(c.oid)::bigint AS relation_filenode,
         pg_relation_filepath(c.oid) AS relation_filepath,
         pg_relation_size(c.oid)::bigint AS heap_bytes,
         pg_indexes_size(c.oid)::bigint AS index_bytes,
         pg_total_relation_size(c.oid)::bigint AS total_bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.oid = to_regclass($1)`,
      [RELATION]
    );
    if (!identity.length) throw new Error(`${RELATION} does not exist`);

    const tableStats = await query(
      client,
      `SELECT
         seq_scan, seq_tup_read, idx_scan, idx_tup_fetch,
         n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd,
         n_live_tup, n_dead_tup, n_mod_since_analyze,
         last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
         vacuum_count, autovacuum_count, analyze_count, autoanalyze_count
       FROM pg_stat_user_tables
       WHERE relid = to_regclass($1)`,
      [RELATION]
    );

    const indexes = await query(
      client,
      `SELECT
         i.indexrelid::regclass::text AS index_name,
         i.indisprimary, i.indisunique, i.indisvalid, i.indisready,
         pg_relation_size(i.indexrelid)::bigint AS bytes,
         COALESCE(s.idx_scan, 0) AS idx_scan,
         COALESCE(s.idx_tup_read, 0) AS idx_tup_read,
         COALESCE(s.idx_tup_fetch, 0) AS idx_tup_fetch,
         con.conname AS owning_constraint,
         pg_get_indexdef(i.indexrelid) AS definition
       FROM pg_index i
       LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
       LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
       WHERE i.indrelid = to_regclass($1)
       ORDER BY pg_relation_size(i.indexrelid) DESC`,
      [RELATION]
    );

    const constraints = await query(
      client,
      `SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = to_regclass($1)
       ORDER BY conname`,
      [RELATION]
    );

    const dependentViews = await query(
      client,
      `SELECT DISTINCT
         nv.nspname AS dependent_schema,
         v.relname AS dependent_relation,
         v.relkind,
         pg_get_viewdef(v.oid, true) AS definition
       FROM pg_depend d
       JOIN pg_rewrite r ON r.oid = d.objid
       JOIN pg_class v ON v.oid = r.ev_class
       JOIN pg_namespace nv ON nv.oid = v.relnamespace
       WHERE d.refobjid = to_regclass($1)
         AND v.oid <> to_regclass($1)
       ORDER BY nv.nspname, v.relname`,
      [RELATION]
    );

    const referencingFunctions = await query(
      client,
      `SELECT n.nspname AS schema_name, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.prokind IN ('f', 'p')
         AND pg_get_functiondef(p.oid) ~* $1
       ORDER BY n.nspname, p.proname`,
      ["\\mmarket_levels\\M"]
    );

    const sampledProfile = await query(
      client,
      `WITH sampled AS MATERIALIZED (
         SELECT symbol, tf, level_type, source_id, source_json, ts, created_at, updated_at
         FROM public.market_levels TABLESAMPLE SYSTEM (0.5)
         LIMIT $1
       )
       SELECT
         COUNT(*)::bigint AS sampled_rows,
         MIN(ts) AS min_ts,
         MAX(ts) AS max_ts,
         COUNT(*) FILTER (WHERE source_id IS NULL)::bigint AS missing_source_id,
         COUNT(*) FILTER (WHERE source_json IS NULL)::bigint AS missing_source_json,
         COUNT(DISTINCT symbol)::bigint AS symbols,
         COUNT(DISTINCT tf)::bigint AS timeframes,
         COUNT(DISTINCT level_type)::bigint AS level_types
       FROM sampled`,
      [SAMPLE_LIMIT]
    );

    let exact = null;
    let exactBreakdown = null;
    if (EXACT) {
      const exactRows = await query(
        client,
        `SELECT
           COUNT(*)::bigint AS rows,
           MIN(ts) AS min_ts,
           MAX(ts) AS max_ts,
           MIN(created_at) AS min_created_at,
           MAX(created_at) AS max_created_at,
           COUNT(*) FILTER (WHERE source_id IS NULL)::bigint AS missing_source_id,
           COUNT(*) FILTER (WHERE source_json IS NULL)::bigint AS missing_source_json
         FROM public.market_levels`
      );
      exact = exactRows[0];
      exactBreakdown = await query(
        client,
        `SELECT symbol, tf, level_type, COUNT(*)::bigint AS rows,
                MIN(ts) AS min_ts, MAX(ts) AS max_ts
         FROM public.market_levels
         GROUP BY symbol, tf, level_type
         ORDER BY symbol, tf, level_type`
      );
    }

    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          relation: RELATION,
          captured_at: new Date().toISOString(),
          exact_scan_requested: EXACT,
          identity: identity[0],
          table_stats: tableStats[0] ?? null,
          indexes,
          constraints,
          dependent_views: dependentViews,
          referencing_functions: referencingFunctions,
          sampled_profile: sampledProfile[0],
          exact_profile: exact,
          exact_breakdown: exactBreakdown,
          interpretation: {
            reltuples_and_pg_stat_rows_are_estimates: true,
            exact_profile_requires_flag: "--exact",
            sample_is_not_row_count_evidence: true,
            no_analyze_or_mutation_performed: true,
          },
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
