#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { Pool } = require("pg");

require("dotenv").config({
  path: path.resolve(__dirname, "..", ".env.local"),
  quiet: true,
});

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: "tradzfx-connection-audit",
  max: 1,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 5000,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(`
      SELECT
        COALESCE(NULLIF(application_name, ''), '(empty)') AS application_name,
        state,
        COUNT(*)::int AS sessions
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND backend_type = 'client backend'
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    console.table(result.rows);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[db-sessions] ${error.message}`);
  process.exitCode = 1;
});
