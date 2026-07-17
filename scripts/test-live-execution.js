/**
 * Test live execution on both MT5 (1xTrade) and MT4 (OANDA).
 *
 * Creates a USDCAD buy order, waits for the EA to pick it up,
 * then closes it after 5 seconds. Repeats for the second terminal.
 *
 * USDCAD is least volatile forex pair — safe for a live test.
 * Run: node scripts/test-live-execution.js
 */
const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432"),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD || "2k16Dub@i",
});

// 1xTrade terminal, OANDA terminal
const TERMINALS = [
  { id: "81927103-da67-4995-8422-956a956abaff", label: "MT5 1xTrade" },
  { id: "dd465615-05da-4171-b4d2-cda1caa53939", label: "MT4 OANDA" },
];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getCurrentPrice(symbol) {
  const { rows } = await pool.query(
    `SELECT c FROM market.candles_1m_canonical WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );
  return rows[0]?.c ?? null;
}

async function waitForOrderPickup(orderId, terminalLabel, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await pool.query(
      `SELECT status, terminal_key_id, sent_at FROM orders WHERE id = $1`,
      [orderId]
    );
    if (rows.length > 0) {
      const r = rows[0];
      if (r.status === "sent" && r.terminal_key_id) {
        console.log(`  ✅ Picked up by ${terminalLabel} (terminal_key_id=${r.terminal_key_id.slice(0, 8)}...) at ${r.sent_at}`);
        return r;
      }
      if (r.status === "filled") {
        console.log(`  ✅ Filled by ${terminalLabel} (terminal_key_id=${r.terminal_key_id?.slice(0, 8)}...)`);
        return r;
      }
      if (r.status === "rejected") {
        console.log(`  ❌ Rejected by ${terminalLabel}`);
        return r;
      }
    }
    await sleep(1000);
  }
  console.log(`  ⏰ Timeout waiting for ${terminalLabel} to pick up order`);
  return null;
}

async function waitForOrderClose(orderId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await pool.query(
      `SELECT status, outcome, close_price, realized_pnl FROM orders WHERE id = $1`,
      [orderId]
    );
    if (rows.length > 0) {
      const r = rows[0];
      if (r.status === "closed") {
        console.log(`  ✅ Closed: outcome=${r.outcome}, pnl=${r.realized_pnl}, close_price=${r.close_price}`);
        return r;
      }
    }
    await sleep(1000);
  }
  console.log(`  ⏰ Timeout waiting for order to close`);
  return null;
}

async function run() {
  console.log("=== Live Execution Test ===\n");

  // Get current USDCAD price
  const price = await getCurrentPrice("USDCAD");
  if (!price) {
    console.error("Could not get USDCAD price");
    process.exit(1);
  }
  console.log(`USDCAD current price: ${price}`);
  console.log(`0.01 lots, market buy, SL ${(price - 0.0020).toFixed(5)} (20p), TP ${(price + 0.0020).toFixed(5)} (20p)\n`);

  for (let i = 0; i < TERMINALS.length; i++) {
    const { id, label } = TERMINALS[i];
    const orderId = `test_manual_${crypto.randomUUID().slice(0, 8)}_${label.replace(/\s+/g, "_")}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 min expiry

    console.log(`[${i + 1}/${TERMINALS.length}] Testing ${label}...`);
    console.log(`  Order ID: ${orderId}`);

    // Insert order
    await pool.query(
      `INSERT INTO orders (id, symbol, strategy_id, side, entry_type, entry_price, stop_loss, take_profit,
        status, trade_mode, lot_size, risk_reward, created_at, expires_at)
       VALUES ($1, 'USDCAD', 'test_execution', 'buy', 'market', $2, $3, $4,
        'pending', 'live', 0.01, 1.0, $5, $6)`,
      [
        orderId,
        price,
        price - 0.0020, // SL 20 pips
        price + 0.0020, // TP 20 pips
        now,
        expiresAt,
      ]
    );
    console.log(`  📝 Order inserted, waiting for ${label} to pick it up...`);

    // Wait for pickup
    const picked = await waitForOrderPickup(orderId, label);
    if (!picked) {
      console.log(`  ⏩ ${label} did not pick up order, skipping close\n`);
      continue;
    }

    // Wait 5 seconds then close
    console.log(`  ⏱️  Waiting 5 seconds before closing...`);
    await sleep(5000);

    // Queue close command
    await pool.query(
      `INSERT INTO position_commands (order_id, command_type, close_reason, terminal_key_id, expires_at)
       VALUES ($1, 'CLOSE_POSITION', 'manual_test_close_5s', $2, NOW() + INTERVAL '30 minutes')`,
      [orderId, id]
    );
    console.log(`  🔒 Close command queued for ${label}, waiting for execution...`);

    // Wait for close
    const closed = await waitForOrderClose(orderId);
    if (closed) {
      console.log(`  ✅ ${label} test PASSED\n`);
    } else {
      console.log(`  ⚠️  ${label} order may still be open, check terminal\n`);
    }
  }

  await pool.end();
  console.log("=== Test Complete ===");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
