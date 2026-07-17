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
  ];
  for (const route of routes) {
    const source = fs.readFileSync(path.join(ROOT, route), "utf8");
    assert.match(source, /getWebReadPool/);
    assert.doesNotMatch(source, /\bgetPool\b/);
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
  }
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
