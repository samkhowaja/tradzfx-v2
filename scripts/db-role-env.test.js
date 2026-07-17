"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ROLE_URL_NAMES, parseDatabaseUrl, roleDbEnv } = require("./db-role-env.cjs");

const ROLE = "TM_DATABASE_URL_INGEST";

test("declares all process-specific role URL names", () => {
  assert.deepEqual(ROLE_URL_NAMES, [
    "TM_DATABASE_URL_INGEST",
    "TM_DATABASE_URL_ENGINE",
    "TM_DATABASE_URL_LIFECYCLE",
    "TM_DATABASE_URL_WEB_READ",
    "TM_DATABASE_URL_WEB_COMMAND",
    "TM_DATABASE_URL_EXECUTION",
    "TM_DATABASE_URL_BACKTEST",
    "TM_DATABASE_URL_MONITOR",
  ]);
});

test("parses role URL into legacy pg environment fields", () => {
  const encodedUrl = ["postgresql://ingest%20user", "p%40ss@db.internal:5544/tradzfx%20v2"].join(":");
  assert.deepEqual(
    parseDatabaseUrl(ROLE, encodedUrl),
    {
      TM_DB_HOST: "db.internal",
      TM_DB_PORT: "5544",
      TM_DB_NAME: "tradzfx v2",
      TM_DB_USER: "ingest user",
      TM_DB_PASSWORD: "p@ss",
    }
  );
});

test("uses default PostgreSQL port and legacy fallback", () => {
  const defaultPortUrl = ["postgres://ingest", "secret@localhost/tradzfx_v2"].join(":");
  assert.equal(
    parseDatabaseUrl(ROLE, defaultPortUrl).TM_DB_PORT,
    "5432"
  );
  assert.deepEqual(
    roleDbEnv(ROLE, {
      TM_DB_HOST: "legacy-db",
      TM_DB_PORT: "5433",
      TM_DB_NAME: "legacy-name",
      TM_DB_USER: "legacy-user",
      TM_DB_PASSWORD: "legacy-password",
    }),
    {
      TM_DB_HOST: "legacy-db",
      TM_DB_PORT: "5433",
      TM_DB_NAME: "legacy-name",
      TM_DB_USER: "legacy-user",
      TM_DB_PASSWORD: "legacy-password",
    }
  );
});

test("rejects unknown, malformed, incomplete, and non-PostgreSQL URLs", () => {
  const validUrl = ["postgresql://u", "p@h/d"].join(":");
  const wrongProtocolUrl = ["https://u", "p@h/d"].join(":");
  assert.throws(() => parseDatabaseUrl("DATABASE_URL", validUrl), /Unknown/);
  assert.throws(() => parseDatabaseUrl(ROLE, "not-a-url"), /valid PostgreSQL URL/);
  assert.throws(() => parseDatabaseUrl(ROLE, wrongProtocolUrl), /must use/);
  assert.throws(() => parseDatabaseUrl(ROLE, "postgresql://u@h/d"), /must include/);
});
