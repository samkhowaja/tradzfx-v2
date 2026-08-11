const {
  FEATURE_REGISTRY,
  FEATURE_ENGINE_VERSIONS,
} = require("../packages/strategies/dist/index.js");
const {
  classifyReadiness,
  resolveFreshnessPolicy,
  summarizeReadiness,
} = require("../packages/shared/dist/index.js");

const DEFAULT_TFS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const LIFECYCLE_TABLES = new Set(["features_zone", "features_ifvg", "features_order_block"]);
const CANONICAL_CANDLE_TABLES = Object.freeze({
  "1m": "market.candles_1m_canonical",
  "5m": "market.candles_5m_canonical",
  "15m": "market.candles_15m_canonical",
  "1h": "market.candles_1h_canonical",
  "4h": "market.candles_4h_canonical",
  "1d": "market.candles_1d_utc_canonical",
});
const VALID_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Capability scans touch many small metadata queries. Keep them bounded so a
// large strategy set cannot serialize for hours or exhaust the DB pool.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

function assertIdent(name) {
  if (!VALID_IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

function ageHours(from, to = new Date()) {
  if (!from) return null;
  return Math.max(0, (to.getTime() - new Date(from).getTime()) / 3_600_000);
}

function fmtIso(v) {
  return v ? new Date(v).toISOString() : null;
}

function freshnessMinutes(contract, tf, opts = {}) {
  if (!tf) return null;
  // Session-scoped opening ranges remain valid after session completion. Do
  // not apply generic 15m producer freshness to this static session object.
  if (contract?.table === "features_opening_range") return 1440;
  const contractFreshness = contract?.defaultFreshnessMinutesByTf?.[tf];
  if (contractFreshness != null) return contractFreshness;
  return resolveFreshnessPolicy({
    tf,
    producerCadenceMinutes: opts.producerCadenceMinutes,
    graceMinutes: opts.freshnessGraceMinutes,
  }).maxAgeMinutes;
}

function classifyVerdict(row) {
  return classifyReadiness({
    tableExists: row.tableExists,
    missingColumns: row.missingColumns,
    semanticType: row.semanticType,
    rowCount: row.rows90d,
    lifecycleAgeHours: row.lifecycleAgeHours,
    lifecycleMaxAgeHours: row.lifecycleMaxAgeHours,
    latestAgeHours: row.latestAgeHours,
    maxFreshnessMinutes: row.maxFreshnessMinutes,
    producerLagHours: row.producerLagHours,
    producerAgeHours: row.producerAgeHours,
    producerMaxAgeHours: row.producerMaxAgeHours,
    producerSucceeded: row.producerSucceeded,
    expectedEngineVersion: row.expectedEngineVersion,
    observedEngineVersions: row.observedEngineVersions,
  });
}

async function tableInfo(pool, table) {
  const { rows } = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set(rows.map((r) => r.column_name));
}

async function getSymbols(pool, explicit) {
  if (explicit?.length) return explicit.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM market.candles_1m_canonical ORDER BY symbol");
  return rows.map((r) => r.symbol);
}

async function featureStats(pool, table, hasTf, hasEngineVer, symbol, tf, from, to) {
  assertIdent(table);
  const where = hasTf
    ? "symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4"
    : "symbol = $1 AND ts >= $3 AND ts <= $4";
  const params = hasTf ? [symbol, tf, from, to] : [symbol, null, from, to];
  const versionSelect = hasEngineVer
    ? ", ARRAY_REMOVE(ARRAY_AGG(DISTINCT engine_ver), NULL) AS engine_versions"
    : ", ARRAY[]::text[] AS engine_versions";
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS rows_90d, MAX(ts) AS latest_ts${versionSelect}
     FROM ${table}
     WHERE ${where}`,
    params
  );
  return {
    rows90d: Number(rows[0]?.rows_90d ?? 0),
    latestTs: rows[0]?.latest_ts ?? null,
    engineVersions: rows[0]?.engine_versions ?? [],
  };
}

async function producerStats(pool, table, symbol, tf) {
  const { rows } = await pool.query(
    `SELECT finished_at, source_max_ts, watermark_ts, status,
            rows_seen, rows_inserted, rows_updated, rows_invalidated
     FROM feature_producer_runs
     WHERE symbol = $1 AND feature_table = $2 AND ($3::text IS NULL OR tf = $3 OR tf IS NULL)
     ORDER BY CASE WHEN tf = $3 THEN 0 ELSE 1 END,
              finished_at DESC NULLS LAST
     LIMIT 1`,
    [symbol, table, tf]
  );
  return rows[0] ?? null;
}

async function tableExistsByRegclass(pool, table) {
  const { rows } = await pool.query(`SELECT to_regclass($1) AS regclass`, [`public.${table}`]);
  return Boolean(rows[0]?.regclass);
}

async function lifecycleStats(pool, table, symbol, tf, dataEdge) {
  if (!LIFECYCLE_TABLES.has(table)) return null;
  if (table === "features_zone" && tf && await tableExistsByRegclass(pool, "lifecycle_refresh_state_tf")) {
    const { rows } = await pool.query(
      `SELECT last_processed_ts
       FROM lifecycle_refresh_state_tf
       WHERE symbol = $1 AND table_name = $2 AND tf = $3`,
      [symbol, table, tf]
    );
    const last = rows[0]?.last_processed_ts ?? null;
    return {
      lastProcessedTs: last,
      ageHours: last && dataEdge ? ageHours(last, dataEdge) : null,
      scope: tf,
    };
  }
  const { rows } = await pool.query(
    `SELECT last_processed_ts
     FROM lifecycle_refresh_state
     WHERE symbol = $1 AND table_name = $2`,
    [symbol, table]
  );
  const last = rows[0]?.last_processed_ts ?? null;
  return {
    lastProcessedTs: last,
    ageHours: last && dataEdge ? ageHours(last, dataEdge) : null,
    scope: "*",
  };
}

async function dataEdge(pool, symbol, to, tf = "1m") {
  const table = CANONICAL_CANDLE_TABLES[tf] ?? CANONICAL_CANDLE_TABLES["1m"];
  const { rows } = await pool.query(
    `SELECT MAX(ts) AS max_ts
     FROM ${table}
     WHERE symbol = $1
       AND ts <= $2
       AND EXTRACT(DOW FROM ts) NOT IN (0, 6)`,
    [symbol, to]
  );
  return rows[0]?.max_ts ?? null;
}

async function collectCapabilityMatrix(pool, opts = {}) {
  const now = opts.now ?? new Date();
  const to = opts.to ?? now;
  const from = opts.from ?? new Date(to.getTime() - (opts.days ?? 90) * 24 * 60 * 60 * 1000);
  const symbols = await getSymbols(pool, opts.symbols);
  const tfs = opts.tfs?.length ? opts.tfs : DEFAULT_TFS;
  const requestedFeatures = opts.features?.length ? new Set(opts.features) : null;
  const producerMaxAgeHours = opts.producerMaxAgeHours ?? 2;
  const lifecycleMaxAgeHours = opts.lifecycleMaxAgeHours ?? 2;
  const rows = [];
  const tableColumns = new Map();
  const dataEdges = new Map();

  const featureEntries = Object.entries(FEATURE_REGISTRY)
    .filter(([featureName]) => !requestedFeatures || requestedFeatures.has(featureName));

  for (const [featureName, contract] of featureEntries) {
    const table = contract.table ?? featureName;
    if (!tableColumns.has(table)) tableColumns.set(table, await tableInfo(pool, table));
    const columns = tableColumns.get(table);
    const tableExists = columns.size > 0;
    const hasTf = columns.has("tf");
    const missingColumns = tableExists
      ? contract.requiredColumns.filter((c) => !columns.has(c))
      : contract.requiredColumns.slice();
    const tfList = hasTf ? tfs : [null];

    const cells = symbols.flatMap((symbol) => tfList.map((tf) => ({ symbol, tf })));
    const cellRows = await mapLimit(cells, opts.concurrency ?? 8, async ({ symbol, tf }) => {
        const edgeKey = `${symbol}:${tf ?? "1m"}`;
        if (!dataEdges.has(edgeKey)) {
          dataEdges.set(edgeKey, dataEdge(pool, symbol, to, tf ?? "1m"));
        }
        const edgeValue = dataEdges.get(edgeKey);
        const edge = edgeValue && typeof edgeValue.then === "function" ? await edgeValue : edgeValue;
        if (edgeValue && typeof edgeValue.then === "function") dataEdges.set(edgeKey, edge);
        let stats = { rows90d: 0, latestTs: null, engineVersions: [] };
        let producer = null;
        let lifecycle = null;
        if (tableExists && missingColumns.length === 0) {
          [stats, producer, lifecycle] = await Promise.all([
            featureStats(pool, table, hasTf, columns.has("engine_ver"), symbol, tf, from, to),
            producerStats(pool, table, symbol, tf),
            lifecycleStats(pool, table, symbol, tf, edge),
          ]);
        }

        const latestAgeHours = stats.latestTs ? ageHours(stats.latestTs, edge ?? to) : null;
        const producerAgeHours = producer?.finished_at ? ageHours(producer.finished_at, now) : null;
        const producerLagHours = producer?.source_max_ts && edge
          ? ageHours(producer.source_max_ts, edge)
          : null;
        const row = {
          feature: featureName,
          table,
          symbol,
          tf,
          semanticType: contract.semanticType,
          joinPolicy: contract.joinPolicy,
          tableExists,
          missingColumns,
          rows90d: stats.rows90d,
          latestTs: fmtIso(stats.latestTs),
          latestAgeHours: latestAgeHours == null ? null : Number(latestAgeHours.toFixed(2)),
          maxFreshnessMinutes: tf ? freshnessMinutes(contract, tf, opts) : null,
          producerStatus: producer?.status ?? null,
          producerFinishedAt: fmtIso(producer?.finished_at),
          producerSourceMaxTs: fmtIso(producer?.source_max_ts),
          producerWatermarkTs: fmtIso(producer?.watermark_ts),
          producerAgeHours: producerAgeHours == null ? null : Number(producerAgeHours.toFixed(2)),
          producerLagHours: producerLagHours == null ? null : Number(producerLagHours.toFixed(2)),
          producerMaxAgeHours,
          producerSucceeded: producer == null ? null : producer.status === "done",
          expectedEngineVersion: columns.has("engine_ver") ? (FEATURE_ENGINE_VERSIONS[featureName] ?? null) : null,
          observedEngineVersions: stats.engineVersions,
          lifecycleLastProcessedTs: fmtIso(lifecycle?.lastProcessedTs),
          lifecycleAgeHours: lifecycle?.ageHours == null ? null : Number(lifecycle.ageHours.toFixed(2)),
          lifecycleMaxAgeHours,
          lifecycleScope: lifecycle?.scope ?? null,
          dataEdgeTs: fmtIso(edge),
        };
        row.verdict = classifyVerdict(row);
        return row;
      });
    rows.push(...cellRows);
  }

  return {
    generatedAt: now.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    symbols,
    tfs,
    rows,
  };
}

function summarize(matrix) {
  const counts = {};
  for (const row of matrix.rows) counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
  return counts;
}

function readinessStatus(matrix) {
  return summarizeReadiness(matrix.rows.map((row) => row.verdict));
}

module.exports = {
  collectCapabilityMatrix,
  summarize,
  readinessStatus,
  classifyVerdict,
  freshnessMinutes,
};
