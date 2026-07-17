"use strict";

const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "..", ".env.local"),
  quiet: true,
});

function getDbConfig(overrides = {}) {
  const password = process.env.TM_DB_PASSWORD;
  if (!password) {
    throw new Error("TM_DB_PASSWORD is not set");
  }

  return {
    host: process.env.TM_DB_HOST || "localhost",
    port: Number.parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password,
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
