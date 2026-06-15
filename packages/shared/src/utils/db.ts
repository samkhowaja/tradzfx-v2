/**
 * Database connection pool for TimescaleDB.
 * Singleton pattern — import and use everywhere.
 */

import { Pool, type PoolConfig } from "pg";
export type { Pool, PoolConfig } from "pg";

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
      database: process.env.TM_DB_NAME ?? "tradementor_v2",
      user: process.env.TM_DB_USER ?? "postgres",
      password: process.env.TM_DB_PASSWORD ?? "2k16Dub@i",
      max: parseInt(process.env.TM_DB_POOL_MAX ?? "20", 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
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
