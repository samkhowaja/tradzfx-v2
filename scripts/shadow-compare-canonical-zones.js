#!/usr/bin/env node
"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", ".env.local"),
  quiet: true,
});
const { getPool } = require("../packages/shared/dist/index.js");
const { compileStrategy, loadStrategyFromDB } = require("../packages/strategies/dist/index.js");

function usage() {
  console.error("Usage: node scripts/shadow-compare-canonical-zones.js <variant> <symbol> <from-iso> <to-iso>");
}

function canonicalizeZoneReads(sql) {
  let replacements = 0;
  const rewritten = sql.replace(
    /FROM features_zone(?:\s+([a-z][a-z0-9_]*))?\s*\n(\s*)WHERE (?:\1\.)?symbol = ([a-z][a-z0-9_]*)\.symbol\s*\n\s*AND (?:\1\.)?tf = '([^']+)'/gi,
    (_match, alias, indent, anchorAlias, tf) => {
      replacements++;
      // Compiler-generated unaliased laterals still qualify predicates as
      // features_zone.*, so preserve that relation name as an explicit alias.
      const relationAlias = ` ${alias || "features_zone"}`;
      return `FROM public.canonical_zones_as_of(${anchorAlias}.symbol, '${tf}', ${anchorAlias}.ts)${relationAlias}\n${indent}WHERE TRUE`;
    }
  );
  const remaining = (rewritten.match(/FROM\s+(?:public\.)?features_zone\b/gi) ?? []).length;
  if (replacements === 0 || remaining > 0) {
    throw new Error(`Canonical rewrite incomplete: replacements=${replacements}, remaining=${remaining}`);
  }
  return { sql: rewritten, replacements };
}

function signalKey(row) {
  return `${new Date(row.ts).toISOString()}|${row.symbol}|${row.side ?? ""}`;
}

function normalize(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    value instanceof Date ? value.toISOString() : typeof value === "number" ? Number(value.toFixed(10)) : value,
  ]));
}

function diffRows(rawRows, canonicalRows) {
  const raw = new Map(rawRows.map((row) => [signalKey(row), normalize(row)]));
  const canonical = new Map(canonicalRows.map((row) => [signalKey(row), normalize(row)]));
  const rawOnly = [];
  const canonicalOnly = [];
  const changed = [];
  for (const [key, row] of raw) {
    if (!canonical.has(key)) rawOnly.push(row);
    else if (JSON.stringify(row) !== JSON.stringify(canonical.get(key))) {
      changed.push({ key, raw: row, canonical: canonical.get(key) });
    }
  }
  for (const [key, row] of canonical) if (!raw.has(key)) canonicalOnly.push(row);
  return { rawOnly, canonicalOnly, changed };
}

async function main() {
  const [variant, symbolRaw, fromRaw, toRaw] = process.argv.slice(2);
  if (!variant || !symbolRaw || !fromRaw || !toRaw) {
    usage();
    process.exitCode = 2;
    return;
  }
  const symbol = symbolRaw.toUpperCase();
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error("Invalid comparison window");
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15min'");
    const migration = await client.query("SELECT to_regprocedure('public.canonical_zones_as_of(text,text,timestamptz,interval)') AS fn");
    if (!migration.rows[0]?.fn) throw new Error("Migration 161 not applied: canonical_zones_as_of() missing");
    const spec = await loadStrategyFromDB(client, variant);
    if (!spec) throw new Error(`Strategy variant not found: ${variant}`);
    const compiled = compileStrategy(spec, {
      mode: "pit", from, to, symbol, trustStoredLifecycle: false,
    });
    const shadow = canonicalizeZoneReads(compiled.sql);
    const [rawResult, canonicalResult] = await Promise.all([
      client.query(compiled.sql),
      client.query(shadow.sql),
    ]);
    const diffs = diffRows(rawResult.rows, canonicalResult.rows);
    console.log(JSON.stringify({
      mode: "read-only-shadow",
      variant,
      symbol,
      window: { from: from.toISOString(), to: to.toISOString() },
      zone_reads_rewritten: shadow.replacements,
      raw_signals: rawResult.rowCount,
      canonical_signals: canonicalResult.rowCount,
      raw_only: diffs.rawOnly.length,
      canonical_only: diffs.canonicalOnly.length,
      changed: diffs.changed.length,
      samples: {
        raw_only: diffs.rawOnly.slice(0, 20),
        canonical_only: diffs.canonicalOnly.slice(0, 20),
        changed: diffs.changed.slice(0, 20),
      },
    }, null, 2));
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = { canonicalizeZoneReads, diffRows, signalKey };
