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
let webReadPool: Pool | null = null;

function positiveInteger(name: string, fallback: string): number {
  const raw = process.env[name] ?? fallback;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(raw);
}

function parsePoolUrl(name: string, value: string): Pick<PoolConfig, "host" | "port" | "database" | "user" | "password"> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${name} must use postgres:// or postgresql://`);
  }
  if (!url.hostname || !url.username || !url.password || !url.pathname.slice(1)) {
    throw new Error(`${name} must include host, database, user, and password`);
  }
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} contains an invalid port`);
  }
  return {
    host: url.hostname,
    port,
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
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

export function buildWebReadPoolConfig(): PoolConfig {
  const roleUrl = process.env.TM_DATABASE_URL_WEB_READ;
  const config = roleUrl
    ? {
        ...buildPoolConfig(),
        ...parsePoolUrl("TM_DATABASE_URL_WEB_READ", roleUrl),
      }
    : buildPoolConfig();
  return {
    ...config,
    application_name: `${process.env.TM_DB_APPLICATION_NAME ?? "tradzfx-unattributed"}-read`,
    max: positiveInteger("TM_DB_WEB_READ_POOL_MAX", "10"),
  };
}

export function getWebReadPool(): Pool {
  if (!webReadPool) {
    webReadPool = new Pool(buildWebReadPoolConfig());
    webReadPool.on("error", (err) => {
      console.error("[db:web-read] Unexpected pool error:", err.message);
    });
  }
  return webReadPool;
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
  const pools = [pool, webReadPool].filter((candidate): candidate is Pool => candidate !== null);
  pool = null;
  webReadPool = null;
  await Promise.all(pools.map((candidate) => candidate.end()));
}
