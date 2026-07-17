/**
 * Database connection pool for TimescaleDB.
 * Singleton pattern — import and use everywhere.
 */

import { Pool, type PoolConfig } from "pg";
export type { Pool, PoolConfig } from "pg";
export type PoolClientLike = { query: Pool["query"] };
export type Queryable = Pool | PoolClientLike;

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const pgOptions: string[] = [];
    const statementTimeout = process.env.TM_DB_STATEMENT_TIMEOUT;
    if (statementTimeout) {
      pgOptions.push(`-c statement_timeout=${statementTimeout}`);
    }
    const idleInTransactionTimeout = process.env.TM_DB_IDLE_IN_TRANSACTION_TIMEOUT;
    if (idleInTransactionTimeout) {
      pgOptions.push(`-c idle_in_transaction_session_timeout=${idleInTransactionTimeout}`);
    }

    const config: PoolConfig = {
      host: process.env.TM_DB_HOST ?? "localhost",
      port: parseInt(process.env.TM_DB_PORT ?? "5432", 10),
      database: process.env.TM_DB_NAME || "tradzfx_v2",
      user: process.env.TM_DB_USER ?? "postgres",
      password: process.env.TM_DB_PASSWORD || (() => { throw new Error("TM_DB_PASSWORD is not set"); })(),
      application_name: process.env.TM_DB_APPLICATION_NAME ?? "tradzfx-unattributed",
      max: parseInt(process.env.TM_DB_POOL_MAX ?? "20", 10),
      idleTimeoutMillis: parseInt(process.env.TM_DB_IDLE_TIMEOUT ?? "30000", 10),
      connectionTimeoutMillis: parseInt(process.env.TM_DB_CONNECTION_TIMEOUT ?? "5000", 10),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      options: pgOptions.length > 0 ? pgOptions.join(" ") : undefined,
    };

    pool = new Pool(config);

    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", err.message);
    });
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
