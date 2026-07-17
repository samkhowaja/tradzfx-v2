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

test("direct long-running PM2 pools declare safeguards and graceful shutdown", () => {
  const directPoolScripts = [
    "scripts/ingestion-server.js",
    "scripts/run-dxy-synthetic-cron.js",
    "scripts/expire-pending-orders-cron.js",
    "scripts/cleanup-rejection-log-cron.js",
    "scripts/feature-freshness-monitor.js",
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
