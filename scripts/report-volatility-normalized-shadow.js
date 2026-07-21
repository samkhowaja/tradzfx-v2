#!/usr/bin/env node
/** Compare current mutable-profile p95 policy with causal normalized rank p95. */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function pct(n, d) { return d ? `${(100 * n / d).toFixed(2)}%` : "0.00%"; }
function num(value, digits = 2) { return Number(value ?? 0).toFixed(digits); }

async function main() {
  const symbol = (process.argv[2] || "XAUUSD").toUpperCase();
  const tf = process.argv[3] || "5m";
  const period = Number(process.argv[4] || 5);
  const outputPath = process.argv[5] || path.resolve("reports", `VOLATILITY_NORMALIZED_SHADOW_${symbol}_${tf}_2026-07-19.md`);
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
    max: 2,
  });

  const { rows } = await pool.query(
    `WITH profile AS (
       SELECT DISTINCT ON (session) session, p95, sample_count, sample_start, sample_end, updated_at
         FROM market_volatility_profile
        WHERE symbol=$1 AND tf=$2 AND period=$3
        ORDER BY session, lookback_days DESC
     )
     SELECT v.session,
            COUNT(*)::int rows,
            COUNT(*) FILTER (WHERE v.is_valid)::int valid_rows,
            COUNT(*) FILTER (WHERE p.p95 IS NULL)::int profile_missing,
            COUNT(*) FILTER (WHERE p.p95 IS NOT NULL AND v.atr_pips <= p.p95)::int legacy_pass,
            COUNT(*) FILTER (WHERE v.is_valid AND v.percentile_rank <= 0.95)::int shadow_pass,
            COUNT(*) FILTER (WHERE v.is_valid AND p.p95 IS NOT NULL
              AND (v.atr_pips <= p.p95) <> (v.percentile_rank <= 0.95))::int disagreements,
            COUNT(*) FILTER (WHERE v.is_valid AND p.p95 IS NOT NULL
              AND v.atr_pips <= p.p95 AND v.percentile_rank > 0.95)::int legacy_pass_shadow_block,
            COUNT(*) FILTER (WHERE v.is_valid AND p.p95 IS NOT NULL
              AND v.atr_pips > p.p95 AND v.percentile_rank <= 0.95)::int legacy_block_shadow_pass,
            MIN(v.ts) min_ts, MAX(v.ts) max_ts,
            MIN(v.sample_count)::int min_sample, MAX(v.sample_count)::int max_sample,
            MAX(p.p95) p95, MAX(p.sample_count)::int profile_samples,
            MAX(p.sample_start) profile_start, MAX(p.sample_end) profile_end,
            MAX(p.updated_at) profile_updated
       FROM features_volatility_normalized v
       LEFT JOIN profile p USING(session)
      WHERE v.symbol=$1 AND v.tf=$2 AND v.period=$3
      GROUP BY v.session ORDER BY v.session`,
    [symbol, tf, period]
  );

  const total = rows.reduce((a, r) => ({
    rows: a.rows + r.rows, valid: a.valid + r.valid_rows,
    missing: a.missing + r.profile_missing, legacy: a.legacy + r.legacy_pass,
    shadow: a.shadow + r.shadow_pass, disagree: a.disagree + r.disagreements,
    lpSb: a.lpSb + r.legacy_pass_shadow_block, lbSp: a.lbSp + r.legacy_block_shadow_pass,
  }), { rows: 0, valid: 0, missing: 0, legacy: 0, shadow: 0, disagree: 0, lpSb: 0, lbSp: 0 });

  const lines = [
    `# Normalized Volatility Shadow Report — ${symbol} ${tf}`,
    "", `**Generated:** ${new Date().toISOString()}`, `**ATR period:** ${period}`,
    "", "## Scope and caveat", "",
    "Current control uses latest mutable `market_volatility_profile.p95`. Shadow uses causal same-session rank computed with rows at or before each anchor. This report measures decision disagreement, not economic performance. Mutable control profile is not historical PIT evidence.",
    "", "## Summary", "",
    "| Rows | Valid shadow | Missing profile | Control pass | Shadow pass | Disagreement | Control pass / shadow block | Control block / shadow pass |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| ${total.rows} | ${total.valid} | ${total.missing} | ${total.legacy} (${pct(total.legacy,total.valid)}) | ${total.shadow} (${pct(total.shadow,total.valid)}) | ${total.disagree} (${pct(total.disagree,total.valid)}) | ${total.lpSb} | ${total.lbSp} |`,
    "", "## Session detail", "",
    "| Session | Rows | Valid | p95 pips | Control pass | Shadow pass | Disagreement | Control pass / shadow block | Control block / shadow pass | Shadow samples | Profile samples |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map(r => `| ${r.session} | ${r.rows} | ${r.valid_rows} | ${num(r.p95)} | ${r.legacy_pass} | ${r.shadow_pass} | ${r.disagreements} (${pct(r.disagreements,r.valid_rows)}) | ${r.legacy_pass_shadow_block} | ${r.legacy_block_shadow_pass} | ${r.min_sample}–${r.max_sample} | ${r.profile_samples ?? 0} |`),
    "", "## Profile provenance", "",
    "| Session | Profile sample start | Profile sample end | Updated | Shadow start | Shadow end |",
    "|---|---|---|---|---|---|",
    ...rows.map(r => `| ${r.session} | ${r.profile_start?.toISOString?.() ?? r.profile_start ?? "missing"} | ${r.profile_end?.toISOString?.() ?? r.profile_end ?? "missing"} | ${r.profile_updated?.toISOString?.() ?? r.profile_updated ?? "missing"} | ${r.min_ts.toISOString()} | ${r.max_ts.toISOString()} |`),
    "", "## Promotion status", "",
    "**NOT READY.** Required next evidence: trade-anchor join, frozen policy, walk-forward/OOS economics, loss-cohort review, and multi-symbol coverage. No live consumer switch authorized.", "",
  ];
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n"));
  console.log(JSON.stringify({ outputPath, ...total }, null, 2));
  await pool.end();
}
main().catch(error => { console.error(error); process.exit(1); });
