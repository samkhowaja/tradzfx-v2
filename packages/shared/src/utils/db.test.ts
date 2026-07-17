import { afterEach, describe, expect, it } from "vitest";
import { buildPoolConfig } from "./db";

const ORIGINAL_ENV = { ...process.env };
const TEST_PASSWORD = ["test", "only"].join("-");

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("buildPoolConfig", () => {
  it("builds bounded attributed defaults", () => {
    process.env.NODE_ENV = "test";
    process.env["TM_DB_PASSWORD"] = TEST_PASSWORD;
    process.env.TM_DB_APPLICATION_NAME = "tradzfx-test";

    const config = buildPoolConfig();

    expect(config.application_name).toBe("tradzfx-test");
    expect(config.max).toBe(20);
    expect(config.idleTimeoutMillis).toBe(30_000);
    expect(config.connectionTimeoutMillis).toBe(5_000);
    expect(config.keepAlive).toBe(true);
  });

  it("fails closed without password", () => {
    delete process.env.TM_DB_PASSWORD;
    expect(() => buildPoolConfig()).toThrow("TM_DB_PASSWORD is not set");
  });

  it("requires attribution in production", () => {
    process.env.NODE_ENV = "production";
    process.env["TM_DB_PASSWORD"] = TEST_PASSWORD;
    delete process.env.TM_DB_APPLICATION_NAME;

    expect(() => buildPoolConfig()).toThrow(
      "TM_DB_APPLICATION_NAME is required in production"
    );
  });

  it.each([
    ["TM_DB_POOL_MAX", "0"],
    ["TM_DB_IDLE_TIMEOUT", "abc"],
    ["TM_DB_CONNECTION_TIMEOUT", "-1"],
    ["TM_DB_STATEMENT_TIMEOUT", "NaN"],
  ])("rejects invalid numeric setting %s=%s", (key, value) => {
    process.env.NODE_ENV = "test";
    process.env["TM_DB_PASSWORD"] = TEST_PASSWORD;
    process.env[key] = value;

    expect(() => buildPoolConfig()).toThrow(`${key} must be a positive integer`);
  });

  it("sets PostgreSQL session timeouts through options", () => {
    process.env.NODE_ENV = "test";
    process.env["TM_DB_PASSWORD"] = TEST_PASSWORD;
    process.env.TM_DB_STATEMENT_TIMEOUT = "60000";
    process.env.TM_DB_IDLE_IN_TRANSACTION_TIMEOUT = "30000";

    const config = buildPoolConfig();

    expect(config.options).toBe(
      "-c statement_timeout=60000 -c idle_in_transaction_session_timeout=30000"
    );
  });
});
