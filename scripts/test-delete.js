/**
 * Point-in-Time backtest runner for all V2 strategy specs.
 *
 * Supports signalSource: zone | orb | indicator | moving_average | fvg.
 * Uses LATERAL lookups so each signal only sees features available at that time.
 *
 * Usage:
 *   node backtest-pit-v2.js [symbol] [days] [specId] [--json] [--trades] [--debug] [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   node backtest-pit-v2.js EURUSD 7 doyle_sd
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { randomUUID } = require("crypto");
const {
  loadStrategyFromDB,
  compileStrategy,
  buildEntryPriceSql: _buildEntryPriceSql,
  buildSlSql: _buildSlSql,
  buildTpSql: _buildTpSql,
  buildOrbSessionScopedJoin,
  extractEqualityPushdowns,
  FEATURE_REGISTRY,
} = require("../packages/strategies/dist/index.js");
const { collectCapabilityMatrix } = require("./feature-capability.js");
const { appendCandidate, drainSpool } = require("./candidate-audit-spool.js");

// ATR timeframe handling: the risk compiler emits atr(<tf>) references. We
// join every distinct timeframe referenced in risk expressions (and any
// explicit features_atr condition) as its own alias so atr(1m) is never
// silently mapped to a different timeframe's value.
const ATR_TF_RE = /\batr\s*\(\s*(1m|5m|15m|30m|1h|4h|1d)\s*\)/gi;
const VALID_ATR_TFS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

// Historical features_spread rows can be polluted by bad ticks or wide ECN
// snapshots.  Cap any observed spread at this multiple of the deterministic
// session spread; values above the cap are quarantined and replaced with the
// session model so extreme rows do not silently block valid setups.
// The constant itself lives in @tm/shared (SPREAD_SANITY_MULTIPLIER) so the
// backtester, the setup engine, and the spread producer share one ceiling.

function extractAtrTimeframes(...exprs) {
  const tfs = [];
  for (const expr of exprs) {
    if (expr == null) continue;
    ATR_TF_RE.lastIndex = 0;
    let m;
    while ((m = ATR_TF_RE.exec(String(expr))) !== null) {
      const tf = m[1].toLowerCase();
      if (VALID_ATR_TFS.has(tf) && !tfs.includes(tf)) tfs.push(tf);
    }
  }
  return tfs;
}

function bindAtrReferences(sql, atrTfs) {
  let out = sql;
  for (const tf of atrTfs) {
    const re = new RegExp(`\\batr\\s*\\(\\s*${tf}\\s*\\)`, "gi");
    out = out.replace(re, `COALESCE(${atrAlias(tf)}.effective_value, ${atrAlias(tf)}.value)`);
  }
  return out;
}

function atrAlias(tf) {
  return `a_${tf.replace(/[^a-z0-9]/gi, "_")}`;
}

function buildAtrJoins(mainAlias, atrTfs) {
  return atrTfs
    .map(
      (tf) =>
        `JOIN features_atr ${atrAlias(tf)} ON ${mainAlias}.symbol = ${atrAlias(
          tf
        )}.symbol AND ${atrAlias(tf)}.tf = '${tf}' AND ${atrAlias(tf)}.period = 5
  AND ${atrAlias(tf)}.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = ${mainAlias}.symbol AND tf = '${tf}' AND period = 5 AND ts <= ${mainAlias}.ts)`
    )
    .join("\n");
}

function buildAtrSelectColumns(atrTfs, primaryTf) {
  return atrTfs
    .map((tf) => {
      const alias = atrAlias(tf);
      const eff = `COALESCE(${alias}.effective_value, ${alias}.value)`;
      const col = `  ${eff} as atr_${tf.replace(/[^a-z0-9]/gi, "_")}`;
      return tf === primaryTf
        ? `${col},\n  ${eff} as atr_5,\n  ${alias}.value as atr_5_raw,`
        : `${col},`;
    })
    .join("\n");
}

function buildPitEntryPriceSql(spec, source, ctx, atrTfs) {
  return bindAtrReferences(_buildEntryPriceSql(spec, source, ctx), atrTfs);
}
function buildPitSlSql(spec, source, ctx, atrTfs) {
  return bindAtrReferences(_buildSlSql(spec, source, ctx), atrTfs);
}
function buildPitTpSql(spec, source, ctx, atrTfs) {
  return bindAtrReferences(_buildTpSql(spec, source, ctx), atrTfs);
}
const { getSession, getPairCharacteristics, getSessionSpread, getSessionSlippage, TF_MS, SPREAD_SANITY_MULTIPLIER } = require("../packages/shared/dist/index.js");
const {
  createSessionGate,
  createRateLimitGate,
  createDailyLossGate,
  createDailyWinGate,
  createSpreadGate,
  createVolatilityGate,
  createFamilyPositionGate,
} = require("../packages/tradePipeline/dist/index.js");
const { evaluateSetup, evaluateSetupBatch } = require("../packages/setupEngine/dist/index.js");