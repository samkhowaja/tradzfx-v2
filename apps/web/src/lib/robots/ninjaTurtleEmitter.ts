// apps/web/src/lib/robots/ninjaTurtleEmitter.ts
// Bridges the Ninja Turtle Scalper robot into V2's orders table.

import { getPool, checkSmallAccountGate } from "@tm/shared";
import type { Queryable } from "@tm/shared";
import { createOrder } from "@/lib/orderService";
import { createNinjaTurtleScalperStrategy } from "./ninjaTurtleScalper";
import type { Bar } from "./indicators";

const STRATEGY_ID = "ninja_turtle_scalper";

function envEnabled(): boolean {
  return process.env.NINJA_LIVE_ENABLED === "true";
}

function envMode(): "live" | "paper" {
  return process.env.NINJA_LIVE_MODE === "live" ? "live" : "paper";
}

function envSymbols(): string[] {
  const raw = process.env.NINJA_SYMBOLS ?? "XAUUSD";
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function envLookbackMinutes(): number {
  const raw = parseInt(process.env.NINJA_LOOKBACK_MINUTES ?? "4320", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 4320; // default 3 days
}

async function loadRecentBars(
  pool: ReturnType<typeof getPool>,
  symbol: string
): Promise<Bar[]> {
  const lookbackMs = envLookbackMinutes() * 60_000;
  const fromMs = Date.now() - lookbackMs;
  const { rows }: { rows: any[] } = await pool.query(
    `SELECT ts, o, h, l, c, v
     FROM market.candles_1m_canonical
     WHERE symbol = $1 AND ts >= to_timestamp($2 / 1000.0)
     ORDER BY ts ASC`,
    [symbol, fromMs]
  );
  return rows.map((r) => ({
    t_ms: new Date(r.ts).getTime(),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: Number(r.v),
  }));
}


async function canOpenNewPosition(
  db: Queryable,
  symbol: string
): Promise<{ ok: boolean; reason?: string }> {
  // Ninja-specific: no duplicate open/pending order for this strategy + symbol.
  const { rows } = await db.query(
    `SELECT 1 FROM orders
     WHERE symbol = $1 AND strategy_id = $2
       AND status IN ('pending', 'sent', 'filled')
     LIMIT 1`,
    [symbol, STRATEGY_ID]
  );
  if (rows.length > 0) {
    return { ok: false, reason: "ninja_turtle: existing open/pending order" };
  }

  // Account-level small-account guard (max total, daily loss, cooldown, etc.).
  return checkSmallAccountGate(db, symbol);
}

/**
 * Run the Ninja Turtle robot against the latest candles for a symbol and,
 * if a new signal fires, insert a pending order into V2's orders table.
 */
export async function emitNinjaTurtleSignals(
  pool: ReturnType<typeof getPool>,
  symbol: string
): Promise<void> {
  if (!envEnabled()) return;

  const allowed = envSymbols();
  const cleanSymbol = symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (allowed.length > 0 && !allowed.includes(cleanSymbol)) return;

  const bars = await loadRecentBars(pool, cleanSymbol);
  if (bars.length === 0) return;

  const strategy = createNinjaTurtleScalperStrategy();
  let signal: ReturnType<typeof strategy.onBar> | null = null;

  for (let i = 0; i < bars.length; i++) {
    const ctx = {
      bars,
      index: i,
      currentBar: bars[i],
      positions: [],
    };
    const s = strategy.onBar(ctx);
    if (s) signal = s;
  }

  if (!signal) return;

  // Serialize per-strategy+symbol with pg_advisory_xact_lock to prevent
  // TOCTOU race between gate check and order creation.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${STRATEGY_ID}:${cleanSymbol}`]);

    // Re-check gate inside the lock
    const gate = await canOpenNewPosition(client, cleanSymbol);
    if (!gate.ok) {
      await client.query("COMMIT");
      console.log(`[ninja-turtle] blocked: ${gate.reason}`);
      return;
    }

    const cfg = strategy.cfg;
    const rr = cfg.tpPct / cfg.slPct;

    await createOrder({
    symbol: cleanSymbol,
    strategy_id: STRATEGY_ID,
    side: signal.side,
    entry_type: "market",
    entry_price: signal.entryPrice,
    stop_loss: signal.stopLoss,
    take_profit: signal.takeProfit,
    lot_size: Number(process.env.NINJA_LOT_SIZE ?? 0.01),
    risk_reward: Number.isFinite(rr) ? rr : 3,
    trade_mode: envMode(),
    expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5m signal TTL
    entry_zone_pips: null,
    }, client);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(
    `[ninja-turtle] ${envMode().toUpperCase()} ${signal.side} ${cleanSymbol} @ ${signal.entryPrice.toFixed(2)} ` +
      `SL ${signal.stopLoss.toFixed(2)} TP ${signal.takeProfit.toFixed(2)}`
  );
}
