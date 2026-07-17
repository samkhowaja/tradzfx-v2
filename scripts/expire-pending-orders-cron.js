/**
 * Pending-order expiry cron.
 *
 * Runs a background loop that:
 *   1. Queues CANCEL_PENDING_ORDER commands for stale limit orders that already
 *      have an MT5 ticket, so the EA cannot fill them after the server gives up.
 *   2. Marks pending/sent orders with expired expires_at as status='expired'.
 *   3. Fails pending/sent position commands that have exceeded their TTL.
 *
 * Managed by PM2 via ecosystem.config.js.
 */

const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.TM_DB_HOST ?? "localhost",
  port: Number(process.env.TM_DB_PORT ?? 5432),
  database: process.env.TM_DB_NAME ?? "tradzfx_v2",
  user: process.env.TM_DB_USER ?? "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: process.env.TM_DB_APPLICATION_NAME ?? "tradzfx-expire-orders",
  max: Number(process.env.TM_DB_POOL_MAX ?? 2),
  connectionTimeoutMillis: Number(process.env.TM_DB_CONNECTION_TIMEOUT ?? 5000),
  idleTimeoutMillis: Number(process.env.TM_DB_IDLE_TIMEOUT ?? 30000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

const INTERVAL_MS = Number(process.env.EXPIRE_PENDING_ORDERS_INTERVAL_MS ?? 30_000);

async function queueCancelForStaleLimits() {
  const { rows } = await pool.query(
    `SELECT id, mt5_ticket, terminal_key_id
     FROM orders
     WHERE status IN ('pending', 'sent')
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
       AND execution_strategy = 'limit'
       AND mt5_ticket IS NOT NULL`
  );

  let queued = 0;
  for (const row of rows) {
    try {
      await pool.query(
        `INSERT INTO position_commands (order_id, command_type, mt5_ticket, terminal_key_id, expires_at)
         VALUES ($1, 'CANCEL_PENDING_ORDER', $2, $3, NOW() + INTERVAL '30 minutes')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [row.id, Number(row.mt5_ticket), row.terminal_key_id ?? null]
      );
      queued++;
    } catch (err) {
      console.warn(`[expire-cron] Failed to queue cancel for expired limit ${row.id}:`, err.message);
    }
  }
  return queued;
}

async function expireStaleOrders() {
  const { rowCount } = await pool.query(
    `UPDATE orders
     SET status = 'expired'
     WHERE status IN ('pending', 'sent')
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`
  );
  return rowCount ?? 0;
}

async function expireStaleCommands() {
  const { rowCount } = await pool.query(
    `UPDATE position_commands
     SET status = 'failed',
         error = 'TTL expired',
         completed_at = NOW()
     WHERE status IN ('pending', 'sent')
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`
  );
  return rowCount ?? 0;
}

async function tick() {
  const start = Date.now();
  try {
    const cancelled = await queueCancelForStaleLimits();
    const expiredOrders = await expireStaleOrders();
    const expiredCommands = await expireStaleCommands();
    console.log(
      `[expire-cron] tick=${new Date().toISOString()} cancelled=${cancelled} expired_orders=${expiredOrders} expired_commands=${expiredCommands} ms=${Date.now() - start}`
    );
  } catch (err) {
    console.error("[expire-cron] Tick failed:", err.message);
  }
}

let timer = null;
let running = false;

async function runLoop() {
  running = true;
  while (running) {
    await tick();
    await new Promise((resolve) => {
      timer = setTimeout(resolve, INTERVAL_MS);
    });
  }
}

async function shutdown() {
  running = false;
  if (timer) clearTimeout(timer);
  await pool.end();
  process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

runLoop().catch((err) => {
  console.error("[expire-cron] Fatal:", err);
  process.exit(1);
});
