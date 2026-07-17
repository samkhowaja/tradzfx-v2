const { FEATURE_REGISTRY } = require("../packages/strategies/dist/index.js");

const DEFAULT_TFS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const LIFECYCLE_TABLES = new Set(["features_zone", "features_ifvg", "features_order_block"]);
const VALID_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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

function freshnessMinutes(contract, tf) {
  return contract.defaultFreshnessMinutesByTf?.[tf] ?? null;
}

function classifyVerdict(row) {
  if (!row.tableExists) return "MISSING_TABLE";
  if (row.missingColumns.length > 0) return "CONTRACT_MISMATCH";

  const sem = row.semanticType;
  if (row.rows90d === 0) {
    if (sem === "event") return "SPARSE_EVENT_EMPTY";
    return "EMPTY_DENSE";
  }

  if (row.lifecycleAgeHours != null && row.lifecycleAgeHours > row.lifecycleMaxAgeHours) {
    return "BLOCKED_LIFECYCLE";
  }

  if ((sem === "state" || sem === "distribution") && row.latestAgeHours != null) {
    const maxAgeHours = row.maxFreshnessMinutes != null ? row.maxFreshnessMinutes / 60 : null;
    if (maxAgeHours != null && row.latestAgeHours > maxAgeHours) return "STALE_STATE";
  }

  if (row.producerAgeHours != null && row.producerAgeHours > row.producerMaxAgeHours) {
    return sem === "event" ? "PRODUCER_STALE_EVENT" : "PRODUCER_STALE";
  }

  if (sem === "event") return "READY_EVENT";
  if (sem === "level") return "READY_LEVEL";
  return "READY";
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

async function featureStats(pool, table, hasTf, symbol, tf, from, to) {
  assertIdent(table);
  const where = hasTf
    ? "symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4"
    : "symbol = $1 AND ts >= $3 AND ts <= $4";
  const params = hasTf ? [symbol, tf, from, to] : [symbol, null, from, to];
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS rows_90d, MAX(ts) AS latest_ts
     FROM ${table}
     WHERE ${where}`,
    params
  );
  return {
    rows90d: Number(rows[0]?.rows_90d ?? 0),
    latestTs: rows[0]?.latest_ts ?? null,
  };
}

async function producerStats(pool, table, symbol, tf) {
  const { rows } = await pool.query(
    `SELECT finished_at, watermark_ts, status, rows_seen, rows_inserted, rows_updated, rows_invalidated
     FROM feature_producer_runs
     WHERE symbol = $1 AND feature_table = $2 AND ($3::text IS NULL OR tf = $3 OR tf IS NULL)
     ORDER BY finished_at DESC NULLS LAST
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

async function dataEdge(pool, symbol, to) {
  const { rows } = await pool.query(
    `SELECT MAX(ts) AS max_ts
     FROM market.candles_1m_canonical
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
  const producerMaxAgeHours = opts.producerMaxAgeHours ?? 2;
  const lifecycleMaxAgeHours = opts.lifecycleMaxAgeHours ?? 2;
  const rows = [];
  const tableColumns = new Map();
  const dataEdges = new Map();

  for (const [featureName, contract] of Object.entries(FEATURE_REGISTRY)) {
    const table = contract.table ?? featureName;
    if (!tableColumns.has(table)) tableColumns.set(table, await tableInfo(pool, table));
    const columns = tableColumns.get(table);
    const tableExists = columns.size > 0;
    const hasTf = columns.has("tf");
    const missingColumns = tableExists
      ? contract.requiredColumns.filter((c) => !columns.has(c))
      : contract.requiredColumns.slice();
    const tfList = hasTf ? tfs : [null];

    for (const symbol of symbols) {
      if (!dataEdges.has(symbol)) dataEdges.set(symbol, await dataEdge(pool, symbol, to));
      const edge = dataEdges.get(symbol);

      for (const tf of tfList) {
        let stats = { rows90d: 0, latestTs: null };
        let producer = null;
        let lifecycle = null;
        if (tableExists && missingColumns.length === 0) {
          stats = await featureStats(pool, table, hasTf, symbol, tf, from, to);
          producer = await producerStats(pool, table, symbol, tf);
          lifecycle = await lifecycleStats(pool, table, symbol, tf, edge);
        }

        const latestAgeHours = stats.latestTs ? ageHours(stats.latestTs, edge ?? to) : null;
        const producerAgeHours = producer?.finished_at ? ageHours(producer.finished_at, now) : null;
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
          maxFreshnessMinutes: tf ? freshnessMinutes(contract, tf) : null,
          producerStatus: producer?.status ?? null,
          producerFinishedAt: fmtIso(producer?.finished_at),
          producerWatermarkTs: fmtIso(producer?.watermark_ts),
          producerAgeHours: producerAgeHours == null ? null : Number(producerAgeHours.toFixed(2)),
          producerMaxAgeHours,
          lifecycleLastProcessedTs: fmtIso(lifecycle?.lastProcessedTs),
          lifecycleAgeHours: lifecycle?.ageHours == null ? null : Number(lifecycle.ageHours.toFixed(2)),
          lifecycleMaxAgeHours,
          lifecycleScope: lifecycle?.scope ?? null,
          dataEdgeTs: fmtIso(edge),
        };
        row.verdict = classifyVerdict(row);
        rows.push(row);
      }
    }
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

module.exports = {
  collectCapabilityMatrix,
  summarize,
  classifyVerdict,
};
