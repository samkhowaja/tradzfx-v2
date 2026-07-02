import { describe, it, expect, vi } from "vitest";
import {
  parseArgs,
  parseReconcileTargets,
  checkReconcileTarget,
  ALREADY_EXISTS_CODES,
  runMigrations,
  type Migration,
} from "./migrationRunner";

function createFakePool(
  handlers: Array<{ match: RegExp; rows: unknown[] }>
): any {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const handler = handlers.find((h) => h.match.test(sql));
      if (!handler) {
        throw new Error(`Unexpected query in test: ${sql.slice(0, 120)}`);
      }
      return { rows: handler.rows };
    }),
  };
}

describe("parseArgs", () => {
  it("defaults both flags to false", () => {
    expect(parseArgs([])).toEqual({ repair: false, reconcile: false });
  });

  it("detects --repair", () => {
    expect(parseArgs(["--repair"])).toEqual({ repair: true, reconcile: false });
  });

  it("detects --reconcile", () => {
    expect(parseArgs(["--reconcile"])).toEqual({
      repair: false,
      reconcile: true,
    });
  });
});

describe("parseReconcileTargets", () => {
  it("extracts table targets", () => {
    const sql = "-- @reconcile: table:features_indicator\nCREATE TABLE ...";
    expect(parseReconcileTargets(sql)).toEqual(["table:features_indicator"]);
  });

  it("extracts multiple targets", () => {
    const sql = [
      "-- @reconcile: table:orders",
      "-- @reconcile: column:orders.status",
      "-- @reconcile: index:idx_orders_status",
      "-- @reconcile: extension:timescaledb",
    ].join("\n");
    expect(parseReconcileTargets(sql)).toEqual([
      "table:orders",
      "column:orders.status",
      "index:idx_orders_status",
      "extension:timescaledb",
    ]);
  });

  it("ignores comments without the marker", () => {
    const sql = "-- regular comment\nCREATE TABLE ...";
    expect(parseReconcileTargets(sql)).toEqual([]);
  });
});

describe("checkReconcileTarget", () => {
  it("returns true when table exists", async () => {
    const pool = createFakePool([
      { match: /SELECT 1 FROM pg_class/, rows: [{ exists: true }] },
    ]);
    const result = await checkReconcileTarget(pool, "table:orders");
    expect(result).toBe(true);
  });

  it("returns false when table does not exist", async () => {
    const pool = createFakePool([
      { match: /SELECT 1 FROM pg_class/, rows: [] },
    ]);
    const result = await checkReconcileTarget(pool, "table:orders");
    expect(result).toBe(false);
  });

  it("checks column existence", async () => {
    const pool = createFakePool([
      {
        match: /SELECT 1 FROM information_schema.columns/,
        rows: [{ exists: true }],
      },
    ]);
    const result = await checkReconcileTarget(
      pool,
      "column:position_commands.close_reason"
    );
    expect(result).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("information_schema.columns"),
      ["position_commands", "close_reason"]
    );
  });

  it("checks extension existence", async () => {
    const pool = createFakePool([
      { match: /SELECT 1 FROM pg_extension/, rows: [{ exists: true }] },
    ]);
    const result = await checkReconcileTarget(pool, "extension:timescaledb");
    expect(result).toBe(true);
  });

  it("returns false for unknown target kinds", async () => {
    const pool = createFakePool([]);
    const result = await checkReconcileTarget(pool, "unknown:foo");
    expect(result).toBe(false);
  });
});

describe("ALREADY_EXISTS_CODES", () => {
  it("includes duplicate table and column codes", () => {
    expect(ALREADY_EXISTS_CODES.has("42P07")).toBe(true);
    expect(ALREADY_EXISTS_CODES.has("42701")).toBe(true);
  });
});

describe("runMigrations", () => {
  it("applies unrecorded migrations and records them", async () => {
    const migrations: Migration[] = [
      { version: "001_test", sql: "CREATE TABLE test (id INT);" },
    ];
    const pool = createFakePool([
      { match: /CREATE TABLE IF NOT EXISTS schema_migrations/, rows: [] },
      { match: /SELECT 1 FROM schema_migrations/, rows: [] },
      { match: /CREATE TABLE test/, rows: [] },
      { match: /INSERT INTO schema_migrations/, rows: [] },
    ]);

    await runMigrations({ migrations, pool });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE test")
    );
    expect(pool.query).toHaveBeenCalledWith(
      "INSERT INTO schema_migrations (version) VALUES ($1)",
      ["001_test"]
    );
  });

  it("skips already-recorded migrations", async () => {
    const migrations: Migration[] = [
      { version: "001_test", sql: "CREATE TABLE test (id INT);" },
    ];
    const pool = createFakePool([
      { match: /CREATE TABLE IF NOT EXISTS schema_migrations/, rows: [] },
      { match: /SELECT 1 FROM schema_migrations/, rows: [{ applied: true }] },
    ]);

    await runMigrations({ migrations, pool });

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE test"),
      expect.anything()
    );
  });

  it("reconciles via explicit targets when all exist", async () => {
    const migrations: Migration[] = [
      {
        version: "002_test",
        sql: "-- @reconcile: table:test\nCREATE INDEX ...",
      },
    ];
    const pool = createFakePool([
      { match: /CREATE TABLE IF NOT EXISTS schema_migrations/, rows: [] },
      { match: /SELECT 1 FROM schema_migrations/, rows: [] },
      { match: /SELECT 1 FROM pg_class/, rows: [{ exists: true }] },
      { match: /INSERT INTO schema_migrations/, rows: [] },
    ]);

    await runMigrations({ migrations, pool });

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("CREATE INDEX"),
      expect.anything()
    );
    expect(pool.query).toHaveBeenCalledWith(
      "INSERT INTO schema_migrations (version) VALUES ($1)",
      ["002_test"]
    );
  });

  it("in reconcile mode, marks migration applied on already-exists error", async () => {
    const migrations: Migration[] = [
      { version: "003_test", sql: "CREATE TABLE test (id INT);" },
    ];
    const pool = createFakePool([
      { match: /CREATE TABLE IF NOT EXISTS schema_migrations/, rows: [] },
      { match: /SELECT 1 FROM schema_migrations/, rows: [] },
    ]);

    // First non-schema query fails with duplicate_table
    let callCount = 0;
    pool.query.mockImplementation(async (sql: string) => {
      if (/schema_migrations/.test(sql)) return { rows: [] };
      callCount++;
      if (callCount === 1 && /CREATE TABLE test/.test(sql)) {
        const err = new Error("relation \"test\" already exists") as any;
        err.code = "42P07";
        throw err;
      }
      return { rows: [] };
    });

    await runMigrations({ migrations, pool, reconcile: true });

    expect(pool.query).toHaveBeenCalledWith(
      "INSERT INTO schema_migrations (version) VALUES ($1)",
      ["003_test"]
    );
  });

  it("fails on non-already-exists errors even in reconcile mode", async () => {
    const migrations: Migration[] = [
      { version: "004_test", sql: "CREATE TABLE test (id INT);" },
    ];
    const pool = createFakePool([
      { match: /CREATE TABLE IF NOT EXISTS schema_migrations/, rows: [] },
      { match: /SELECT 1 FROM schema_migrations/, rows: [] },
    ]);

    pool.query.mockImplementation(async (sql: string) => {
      if (/schema_migrations/.test(sql)) return { rows: [] };
      const err = new Error("syntax error") as any;
      err.code = "42601";
      throw err;
    });

    await expect(
      runMigrations({ migrations, pool, reconcile: true })
    ).rejects.toThrow("syntax error");
  });

  it("repair mode records missing migrations without executing SQL", async () => {
    const migrations: Migration[] = [
      { version: "005_test", sql: "CREATE TABLE test (id INT);" },
    ];
    const pool = createFakePool([
      { match: /CREATE TABLE IF NOT EXISTS schema_migrations/, rows: [] },
      { match: /SELECT 1 FROM schema_migrations/, rows: [] },
      { match: /INSERT INTO schema_migrations/, rows: [] },
    ]);

    await runMigrations({ migrations, pool, repair: true });

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE test"),
      expect.anything()
    );
    expect(pool.query).toHaveBeenCalledWith(
      "INSERT INTO schema_migrations (version) VALUES ($1)",
      ["005_test"]
    );
  });
});
