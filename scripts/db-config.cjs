"use strict";

const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "..", ".env.local"),
  quiet: true,
});

function positiveInteger(name, fallback) {
  const raw = process.env[name] ?? fallback;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(raw);
}

function getDbConfig(overrides = {}) {
  const password = process.env.TM_DB_PASSWORD;
  if (!password) {
    throw new Error("TM_DB_PASSWORD is not set");
  }

  const applicationName = process.env.TM_DB_APPLICATION_NAME;
  if (process.env.NODE_ENV === "production" && !applicationName) {
    throw new Error("TM_DB_APPLICATION_NAME is required in production");
  }

  return {
    host: process.env.TM_DB_HOST || "localhost",
    port: positiveInteger("TM_DB_PORT", "5432"),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password,
    application_name: applicationName || "tradzfx-script",
    max: positiveInteger("TM_DB_POOL_MAX", "5"),
    idleTimeoutMillis: positiveInteger("TM_DB_IDLE_TIMEOUT", "30000"),
    connectionTimeoutMillis: positiveInteger("TM_DB_CONNECTION_TIMEOUT", "5000"),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ...overrides,
  };
}

function getDbConnectionString() {
  if (process.env.TM_DB_URL) return process.env.TM_DB_URL;

  const config = getDbConfig();
  const user = encodeURIComponent(config.user);
  const password = encodeURIComponent(config.password);
  const database = encodeURIComponent(config.database);
  return `postgresql://${user}:${password}@${config.host}:${config.port}/${database}`;
}

module.exports = { getDbConfig, getDbConnectionString };
