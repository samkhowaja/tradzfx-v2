/**
 * Database connection pool for TimescaleDB.
 * Singleton pattern — import and use everywhere.
 */

import { Pool, type PoolConfig } from "pg";
export type { Pool, PoolConfig } from "pg";
export type PoolClientLike = { query: Pool["query"] };
export type Queryable = Pool | PoolClientLike;
export type PoolStats = {
  applicationName: string;
  max: number;
  total: number;
  idle: number;
  waiting: number;
};

let pool: Pool | null = null;

function positiveInteger(name: string, fallback: string): number {
  const raw = process.env[name] ?? fallback;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(raw);
}

export function buildPoolConfig(): PoolConfig {
  const password = process.env.TM_DB_PASSWORD;
  if (!password) throw new Error("TM_DB_PASSWORD is not set");

  const applicationName = process.env.TM_DB_APPLICATION_NAME;
  if (process.env.NODE_ENV === "production" && !applicationName) {
    throw new Error("TM_DB_APPLICATION_NAME is required in production");
  }

  const pgOptions: string[] = [];
  if (process.env.TM_DB_STATEMENT_TIMEOUT) {
    pgOptions.push(
      `-c statement_timeout=${positiveInteger("TM_DB_STATEMENT_TIMEOUT", "60000")}`
    );
  }
  if (process.env.TM_DB_IDLE_IN_TRANSACTION_TIMEOUT) {
    pgOptions.push(
      `-c idle_in_transaction_session_timeout=${positiveInteger("TM_DB_IDLE_IN_TRANSACTION_TIMEOUT", "30000")}`
    );
  }

  return {
    host: process.env.TM_DB_HOST ?? "localhost",
    port: positiveInteger("TM_DB_PORT", "5432"),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER ?? "postgres",
    password,
    application_name: applicationName ?? "tradzfx-unattributed",
    max: positiveInteger("TM_DB_POOL_MAX", "20"),
    idleTimeoutMillis: positiveInteger("TM_DB_IDLE_TIMEOUT", "30000"),
    connectionTimeoutMillis: positiveInteger("TM_DB_CONNECTION_TIMEOUT", "5000"),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    options: pgOptions.length > 0 ? pgOptions.join(" ") : undefined,
  };
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(buildPoolConfig());

    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", err.message);
    });
  }

  return pool;
}

export function getPoolStats(): PoolStats | null {
  if (!pool) return null;
  return {
    applicationName: process.env.TM_DB_APPLICATION_NAME ?? "tradzfx-unattributed",
    max: positiveInteger("TM_DB_POOL_MAX", "20"),
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
