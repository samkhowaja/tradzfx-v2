"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const ecosystem = require(path.join(ROOT, "ecosystem.config.js"));

const DB_PROCESSES = ecosystem.apps.filter(
  (app) => app.env && Object.hasOwn(app.env, "TM_DB_HOST")
);

function positiveInteger(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}

test("every PM2 DB process has unique attribution and bounded pool settings", () => {
  const names = [];

  for (const app of DB_PROCESSES) {
    assert.ok(app.env.TM_DB_APPLICATION_NAME, `${app.name}: missing TM_DB_APPLICATION_NAME`);
    assert.ok(positiveInteger(app.env.TM_DB_POOL_MAX), `${app.name}: invalid TM_DB_POOL_MAX`);
    assert.ok(
      positiveInteger(app.env.TM_DB_CONNECTION_TIMEOUT),
      `${app.name}: invalid TM_DB_CONNECTION_TIMEOUT`
    );
    assert.ok(
      positiveInteger(app.env.TM_DB_IDLE_TIMEOUT),
      `${app.name}: invalid TM_DB_IDLE_TIMEOUT`
    );
    names.push(app.env.TM_DB_APPLICATION_NAME);
  }

  assert.equal(new Set(names).size, names.length, "TM_DB_APPLICATION_NAME values must be unique");
});

test("every PM2 DB process resolves an explicit workload role URL", () => {
  const allowedRoleUrls = new Set([
    "TM_DATABASE_URL_INGEST",
    "TM_DATABASE_URL_ENGINE",
    "TM_DATABASE_URL_LIFECYCLE",
    "TM_DATABASE_URL_WEB_READ",
    "TM_DATABASE_URL_WEB_COMMAND",
    "TM_DATABASE_URL_EXECUTION",
    "TM_DATABASE_URL_BACKTEST",
    "TM_DATABASE_URL_MONITOR",
    "TM_DATABASE_URL_MAINTENANCE",
  ]);

  for (const app of DB_PROCESSES) {
    assert.ok(
      allowedRoleUrls.has(app.env.TM_DB_ROLE_URL_NAME),
      `${app.name}: missing recognized TM_DB_ROLE_URL_NAME`
    );
  }
});

test("direct long-running PM2 pools declare safeguards and graceful shutdown", () => {
  const directPoolScripts = [
    "scripts/ingestion-server.js",
    "scripts/run-dxy-synthetic-cron.js",
    "scripts/expire-pending-orders-cron.js",
    "scripts/cleanup-rejection-log-cron.js",
    "scripts/feature-freshness-monitor.js",
    "scripts/recompute-feature-recent.js",
  ];

  for (const relativePath of directPoolScripts) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(source, /application_name\s*:/, `${relativePath}: missing attribution`);
    assert.match(source, /connectionTimeoutMillis\s*:/, `${relativePath}: missing connect timeout`);
    assert.match(source, /idleTimeoutMillis\s*:/, `${relativePath}: missing idle timeout`);
    assert.match(source, /keepAlive\s*:\s*true/, `${relativePath}: missing TCP keepalive`);
    assert.match(source, /pool\.end\(\)/, `${relativePath}: missing graceful pool shutdown`);
  }
});

test("rejection cleanup uses dedicated maintenance identity", () => {
  const cleanup = ecosystem.apps.find((app) => app.name === "tz-cleanup-rejection-log");
  assert.ok(cleanup, "missing rejection cleanup process");
  assert.equal(cleanup.env.TM_DB_ROLE_URL_NAME, "TM_DATABASE_URL_MAINTENANCE");
  assert.notEqual(cleanup.env.TM_DB_ROLE_URL_NAME, "TM_DATABASE_URL_MONITOR");
});

test("web process exposes bounded staged read credentials", () => {
  const web = ecosystem.apps.find((app) => app.name === "tz-web-v2");
  assert.ok(web, "missing web process");
  assert.equal(web.env.TM_DB_ROLE_URL_NAME, "TM_DATABASE_URL_WEB_COMMAND");
  assert.equal(web.env.TM_DATABASE_URL_WEB_READ, process.env.TM_DATABASE_URL_WEB_READ);
  assert.match(String(web.env.TM_DB_WEB_READ_POOL_MAX), /^\d+$/);
  assert.ok(Number(web.env.TM_DB_WEB_READ_POOL_MAX) > 0);
});

function findRouteFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findRouteFiles(fullPath);
    return entry.name === "route.ts" ? [fullPath] : [];
  });
}

test("migrated pure-read web routes use only the web-read pool", () => {
  const routes = [
    "apps/web/src/app/api/dashboard/signals/route.ts",
    "apps/web/src/app/api/dashboard/positions/route.ts",
    "apps/web/src/app/api/dashboard/rejections/route.ts",
    "apps/web/src/app/api/strategies/route.ts",
    "apps/web/src/app/api/analytics/route.ts",
    "apps/web/src/app/api/dashboard/performance/route.ts",
    "apps/web/src/app/api/dashboard/activity/route.ts",
    "apps/web/src/app/api/dashboard/strategies/route.ts",
    "apps/web/src/app/api/signals/route.ts",
    "apps/web/src/app/api/pairs/route.ts",
    "apps/web/src/app/api/journal/route.ts",
    "apps/web/src/app/api/strategies/detail/route.ts",
    "apps/web/src/app/api/strategies/backtest/[familyId]/route.ts",
    "apps/web/src/app/api/strategies/variants/[variantId]/backtest/route.ts",
    "apps/web/src/app/api/strategies/variants/[variantId]/trades/route.ts",
    "apps/web/src/app/api/candles/export/route.ts",
    "apps/web/src/app/api/v2/pipeline/health/route.ts",
    "apps/web/src/app/api/v2/pipeline/alerts/route.ts",
    "apps/web/src/app/api/ingest/status/route.ts",
    "apps/web/src/app/api/orders/[orderId]/setup/route.ts",
    "apps/web/src/app/api/health/data-clock/route.ts",
    "apps/web/src/app/api/calibration/route.ts",
    "apps/web/src/app/api/analyze/backtest/report/route.ts",
    "apps/web/src/app/api/strategies/[familyId]/route.ts",
    "apps/web/src/app/api/analyze/route.ts",
    "apps/web/src/app/api/analyze/stream/route.ts",
  ];
  for (const route of routes) {
    const source = fs.readFileSync(path.join(ROOT, route), "utf8");
    assert.match(source, /getWebReadPool/);
    assert.doesNotMatch(source, /\bgetPool\b/);
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
  }
});

test("remaining web-command route inventory is exact and intentional", () => {
  const apiRoot = path.join(ROOT, "apps/web/src/app/api");
  const actual = findRouteFiles(apiRoot)
    .filter((file) => /\bgetPool\s*\(/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(ROOT, file).replaceAll("\\", "/"))
    .sort();

  assert.deepEqual(actual, [
    "apps/web/src/app/api/calibration/apply/route.ts",
    "apps/web/src/app/api/health/route.ts",
    "apps/web/src/app/api/ingest/heartbeat/route.ts",
    "apps/web/src/app/api/ingest/mt5/register/route.ts",
    "apps/web/src/app/api/ingest/route.ts",
    "apps/web/src/app/api/mt5/closes/route.ts",
    "apps/web/src/app/api/mt5/commands/route.ts",
    "apps/web/src/app/api/mt5/fills/route.ts",
    "apps/web/src/app/api/mt5/signals/route.ts",
    "apps/web/src/app/api/strategies/[familyId]/variants/route.ts",
    "apps/web/src/app/api/strategies/update-spec/route.ts",
    "apps/web/src/app/api/strategies/variants/[variantId]/route.ts",
  ]);
});

test("monitor helper used by migrated alerts route contains no mutations", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "packages/tradePipeline/src/monitor.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
});

test("analyzer snapshot dependency closure has no primary-pool or mutation dependency", () => {
  const files = [
    "apps/web/src/lib/analyzeSnapshot.ts",
    "packages/setupEngine/src/evaluateSetup.ts",
    "packages/setupEngine/src/contextBuilder.ts",
    "packages/setupEngine/src/calibrationTuning.ts",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /\bgetPool\b/, file);
    assert.doesNotMatch(
      source,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i,
      file
    );
  }
});

test("data-clock uses only its exact live schema-qualified relation allowlist", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "apps/web/src/app/api/health/data-clock/route.ts"),
    "utf8"
  );
  const relations = [...source.matchAll(/^\s{2}[a-z0-9_]+:\s*"(public\.[a-z0-9_]+)",$/gm)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(relations, [
    "public.candles_1m",
    "public.features_atr",
    "public.features_bias",
    "public.features_candle_pattern",
    "public.features_correlation",
    "public.features_direction_state",
    "public.features_displacement",
    "public.features_htf_bias",
    "public.features_ifvg",
    "public.features_indicator",
    "public.features_liquidity_pools",
    "public.features_moving_average",
    "public.features_opening_range",
    "public.features_order_block",
    "public.features_pivot",
    "public.features_pricing",
    "public.features_session",
    "public.features_spread",
    "public.features_structure",
    "public.features_sweep",
    "public.features_time_of_day_edge",
    "public.features_zone",
    "public.features_zone_retest",
  ]);
  assert.doesNotMatch(source, /features_time_of_day["':,]/);
});

test("candle export uses only its exact schema-qualified relation allowlist", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "apps/web/src/app/api/candles/export/route.ts"),
    "utf8"
  );
  const relations = [...source.matchAll(/"(?:1m|5m|15m|1h|4h|1d_utc|1d_ny)":\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(relations, [
    "market.candles_15m_canonical",
    "market.candles_1d_ny_canonical",
    "market.candles_1d_utc_canonical",
    "market.candles_1h_canonical",
    "market.candles_1m_canonical",
    "market.candles_4h_canonical",
    "market.candles_5m_canonical",
  ]);
});

test("freshness observer and healer use isolated runtime identities", () => {
  const observer = ecosystem.apps.find((app) => app.name === "tz-feature-freshness");
  const healer = ecosystem.apps.find((app) => app.name === "tz-feature-freshness-healer");
  const recompute = fs.readFileSync(path.join(ROOT, "scripts/recompute-feature-recent.js"), "utf8");

  assert.ok(observer, "missing freshness observer");
  assert.ok(healer, "missing freshness healer");
  assert.equal(observer.env.TM_DB_ROLE_URL_NAME, "TM_DATABASE_URL_MONITOR");
  assert.equal(observer.env.FRESHNESS_AUTO_HEAL, "false");
  assert.equal(healer.env.TM_DB_ROLE_URL_NAME, "TM_DATABASE_URL_ENGINE");
  assert.equal(healer.env.FRESHNESS_AUTO_HEAL, "true");
  assert.notEqual(observer.env.TM_DB_APPLICATION_NAME, healer.env.TM_DB_APPLICATION_NAME);
  assert.match(recompute, /user:\s*process\.env\.TM_DB_USER/);
  assert.doesNotMatch(recompute, /user:\s*["']postgres["']/);
});

test("health and monitor expose safe pool telemetry and enforce session bounds", () => {
  const health = fs.readFileSync(
    path.join(ROOT, "apps/web/src/app/api/health/route.ts"),
    "utf8"
  );
  const monitor = fs.readFileSync(path.join(ROOT, "ops/monitor-v2-health.ps1"), "utf8");

  assert.match(health, /getPoolStats\(\)/);
  assert.match(health, /FROM pg_stat_activity/);
  assert.doesNotMatch(health, /\bquery\s*,/i, "health must not expose PostgreSQL query text");
  assert.match(monitor, /TM_DB_SESSION_ALERT_MAX/);
  assert.match(monitor, /unattributed client session/);
  assert.doesNotMatch(monitor, /pg_terminate_backend|Stop-Service\s+postgres|Restart-Service\s+postgres/i);
});
