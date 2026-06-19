import pg from "pg";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";

const pool = new pg.Pool({ host: "localhost", port: 5432, database: "tradementor_v2", user: "postgres", password: "2k16Dub@i" });

const specId = process.argv[2] || "waqar_v2_fvg";
const symbol = process.argv[3] || "EURUSD";

function translatePredicate(predicate, tableRef, context) {
  const biasRef = context === "setup" ? "b.direction" : "s.bias_direction";
  let sql = predicate
    .replace(/features_bias\.direction/g, "__BIAS_DIRECTION__")
    .replace(/features_bias\b/g, "__BIAS_TABLE__");
  sql = sql
    .replace(/\bzone_kind\b/g, `${tableRef}.zone_kind`)
    .replace(/\bevent_type\b/g, `${tableRef}.event_type`)
    .replace(/\bdirection\b/g, `${tableRef}.direction`)
    .replace(/\bposition\b/g, `${tableRef}.position`)
    .replace(/\bfill_pct\b/g, `${tableRef}.fill_pct`)
    .replace(/\btapped\b/g, `${tableRef}.tapped`)
    .replace(/\bgrade\b/g, `${tableRef}.grade`)
    .replace(/\bis_fresh\b/g, `${tableRef}.is_fresh`)
    .replace(/\bquality_score\b/g, `${tableRef}.quality_score`);
  sql = sql
    .replace(/__BIAS_DIRECTION__/g, biasRef)
    .replace(/__BIAS_TABLE__/g, context === "setup" ? "b" : "s");
  return sql;
}

function compile(spec, symbol, from, to) {
  const setupConds = spec.setup.filter((c) => c.required);
  const entryConds = spec.entry.filter((c) => c.required);
  const biasTf = spec.setup.find((c) => c.feature === "features_bias")?.tf ?? "15m";

  const setupPIT = setupConds
    .filter((c) => c.feature !== "features_bias")
    .map((cond) => {
      return `
      LATERAL (
        SELECT DISTINCT ON (symbol) *
        FROM ${cond.feature}
        WHERE symbol = b.symbol AND tf = '${cond.tf}' AND ts <= b.ts
        ORDER BY symbol, ts DESC
      ) AS pit_${cond.id}`;
    });

  const setupWheres = setupConds.map((cond) => {
    const ref = cond.feature === "features_bias" ? "b" : `pit_${cond.id}`;
    return `(${translatePredicate(cond.predicate, ref, "setup")})`;
  });

  const entryPIT = entryConds.map((cond) => {
    return `
      LATERAL (
        SELECT DISTINCT ON (symbol) *
        FROM ${cond.feature}
        WHERE symbol = s.symbol AND tf = '${cond.tf}' AND ts <= s.ts
        ORDER BY symbol, ts DESC
      ) AS pit_${cond.id}`;
  });

  const entryWheres = entryConds.map((cond) => {
    return `(${translatePredicate(cond.predicate, `pit_${cond.id}`, "entry")})`;
  });

  const structureFreshnessMin = spec.live?.structureFreshnessMinutes ?? 30;
  if (structureFreshnessMin > 0) {
    const structureCond = entryConds.find((c) => c.feature === "features_structure");
    if (structureCond) {
      entryWheres.push(`(pit_${structureCond.id}.ts >= s.ts - interval '${structureFreshnessMin} minutes')`);
    }
  }

  const setupPITJoins = setupPIT.length > 0 ? ",\n" + setupPIT.join(",\n") : "";
  const entryPITJoins = entryPIT.length > 0 ? ",\n" + entryPIT.join(",\n") : "";

  return `
WITH bias_times AS (
  SELECT symbol, ts, direction
  FROM features_bias
  WHERE symbol = '${symbol}'
    AND tf = '${biasTf}'
    AND ts >= '${from.toISOString()}'::timestamp
    AND ts <= '${to.toISOString()}'::timestamp
    AND direction != 'neutral'),
setup_passed AS (
  SELECT b.symbol, b.ts, b.direction as bias_direction
  FROM bias_times b
  ${setupPITJoins}
  WHERE ${setupWheres.join("\n    AND ")}
),
entry_passed AS (
  SELECT s.symbol, s.ts, s.bias_direction
  FROM setup_passed s
  ${entryPITJoins}
  WHERE ${entryWheres.join("\n    AND ")}
)
SELECT count(*) as cnt FROM entry_passed`;
}

async function main() {
  const file = path.join(process.cwd(), "packages", "strategies", "src", "specs", `${specId}.yaml`);
  const spec = yaml.load(fs.readFileSync(file, "utf8"));
  const to = new Date("2026-06-18T00:00:00Z");
  const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  const sql = compile(spec, symbol, from, to);
  const { rows } = await pool.query(sql);
  console.log(`${specId} ${symbol} entry_passed count:`, rows[0].cnt);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
