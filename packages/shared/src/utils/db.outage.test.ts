import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { buildPoolConfig } from "./db";

const ORIGINAL_ENV = { ...process.env };
const TEST_PASSWORD = ["test", "only"].join("-");

function configureUnreachablePool(): void {
  process.env.NODE_ENV = "test";
  process.env.TM_DB_HOST = "127.0.0.1";
  process.env.TM_DB_PORT = "1";
  process.env.TM_DB_NAME = "tradzfx_v2";
  process.env.TM_DB_USER = "connection_test";
  process.env["TM_DB_PASSWORD"] = TEST_PASSWORD;
  process.env.TM_DB_APPLICATION_NAME = "tradzfx-outage-test";
  process.env.TM_DB_POOL_MAX = "3";
  process.env.TM_DB_CONNECTION_TIMEOUT = "100";
  process.env.TM_DB_IDLE_TIMEOUT = "100";
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("pool outage and restart bounds", () => {
  it("never creates more clients than max during concurrent outage", async () => {
    configureUnreachablePool();
    const pool = new Pool(buildPoolConfig());
    const attempts = Array.from({ length: 30 }, () => pool.query("SELECT 1"));

    expect(pool.totalCount).toBeLessThanOrEqual(3);
    expect(pool.waitingCount).toBeGreaterThan(0);

    const results = await Promise.allSettled(attempts);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(pool.totalCount).toBeLessThanOrEqual(3);
    expect(pool.waitingCount).toBe(0);
    await pool.end();
    expect(pool.totalCount).toBe(0);
  });

  it("repeated pool restart cycles release all outage clients", async () => {
    configureUnreachablePool();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      const pool = new Pool(buildPoolConfig());
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => pool.query("SELECT 1"))
      );

      expect(results.every((result) => result.status === "rejected")).toBe(true);
      expect(pool.totalCount).toBeLessThanOrEqual(3);
      expect(pool.waitingCount).toBe(0);
      await pool.end();
      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
    }
  });
});
