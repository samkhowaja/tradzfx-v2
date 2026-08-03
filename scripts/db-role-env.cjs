"use strict";

const ROLE_URL_NAMES = Object.freeze([
  "TM_DATABASE_URL_INGEST",
  "TM_DATABASE_URL_ENGINE",
  "TM_DATABASE_URL_LIFECYCLE",
  "TM_DATABASE_URL_WEB_READ",
  "TM_DATABASE_URL_WEB_COMMAND",
  "TM_DATABASE_URL_EXECUTION",
  "TM_DATABASE_URL_BACKTEST",
  "TM_DATABASE_URL_STRATEGY",
  "TM_DATABASE_URL_MONITOR",
  "TM_DATABASE_URL_MAINTENANCE",
]);

function parseDatabaseUrl(name, value) {
  if (!ROLE_URL_NAMES.includes(name)) {
    throw new Error(`Unknown database role URL: ${name}`);
  }
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${name} must use postgresql:// or postgres://`);
  }
  if (!url.hostname || !url.username || !url.password || !url.pathname.slice(1)) {
    throw new Error(`${name} must include host, database, user, and password`);
  }
  const port = url.port || "5432";
  if (!/^\d+$/.test(port) || Number(port) <= 0 || Number(port) > 65535) {
    throw new Error(`${name} has invalid port`);
  }

  return {
    TM_DB_HOST: url.hostname,
    TM_DB_PORT: port,
    TM_DB_NAME: decodeURIComponent(url.pathname.slice(1)),
    TM_DB_USER: decodeURIComponent(url.username),
    TM_DB_PASSWORD: decodeURIComponent(url.password),
  };
}

function roleDbEnv(name, env = process.env) {
  const parsed = parseDatabaseUrl(name, env[name]);
  if (parsed) return parsed;
  return {
    TM_DB_HOST: env.TM_DB_HOST || "localhost",
    TM_DB_PORT: env.TM_DB_PORT || "5432",
    TM_DB_NAME: env.TM_DB_NAME || "tradzfx_v2",
    TM_DB_USER: env.TM_DB_USER || "postgres",
    TM_DB_PASSWORD: env.TM_DB_PASSWORD,
  };
}

module.exports = { ROLE_URL_NAMES, parseDatabaseUrl, roleDbEnv };
