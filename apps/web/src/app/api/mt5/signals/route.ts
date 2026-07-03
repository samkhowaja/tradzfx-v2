// GET /api/mt5/signals
// =====================
// EA polls this endpoint to pick up PENDING trade signals.
// V2 implementation — uses the orders table in tradzfx_v2.

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import { getPendingOrders, markOrderSent, expireStaleOrders } from "@/lib/orderService";
import { resolveTerminalKeyId, expireStaleCommands } from "@/lib/positionCommandService";

// Simple API key validation (reuse same key as bar ingest for now)
const EXPECTED_API_KEY = process.env.TM_MT5_API_KEY ??
  process.env.MT5_API_KEY ??
  "";

function validateApiKey(req: NextRequest): boolean {
  const key = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  return key === EXPECTED_API_KEY;
}

// EA-facing signal shape (must match MQL5 parser exactly)
interface EaSignal {
  signalId: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  entryType: "market" | "limit" | "stop";
  executionStrategy: "market" | "limit" | "market_if_close_else_limit";
  limitPrice: number | null;
  maxEntryDriftPips: number;
  minEffectiveRR: number;
  timeInForce: "GTC" | "IOC" | "FOK";
  riskReward: number;
  expiresAt: string;
  expiresInSeconds: number;
  entryZonePips: number | null;
  trailingStop: null;
  maxHoldMinutes: number | null;
  portfolioId: string | null;
}

export async function GET(req: NextRequest) {
  // 1. Auth
  if (!validateApiKey(req)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });
  }

  // 2. Expire stale orders and commands before returning
  try {
    const expired = await expireStaleOrders();
    if (expired > 0) {
      console.log(`[mt5-signals] Expired ${expired} stale order(s)`);
    }
    const expiredCmds = await expireStaleCommands();
    if (expiredCmds > 0) {
      console.log(`[mt5-signals] Expired ${expiredCmds} stale command(s)`);
    }
  } catch {
    // Non-fatal
  }

  // 3. Parse optional symbol filter and EA's last acknowledged command sequence
  const symbolsParam = req.nextUrl.searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  const lastAckSequenceRaw = req.nextUrl.searchParams.get("last_ack_sequence");
  const lastAckSequence = lastAckSequenceRaw ? parseInt(lastAckSequenceRaw, 10) : undefined;
  if (lastAckSequence != null && (!Number.isFinite(lastAckSequence) || lastAckSequence < 0)) {
    return NextResponse.json({ ok: false, error: "Invalid last_ack_sequence" }, { status: 400 });
  }

  // 4. Identify the calling terminal
  const pool = getPool();
  const terminalKeyId = await resolveTerminalKeyId(pool, req);

  // 5. Fetch pending orders
  const orders = await getPendingOrders(symbols);

  // 6. Mark as sent and build EA response
  const signals: EaSignal[] = [];
  let hasLive = false;
  let hasPaper = false;
  // Commands have their own poll endpoint; last_ack_sequence is ignored here.
  for (const order of orders) {
    try {
      const sent = await markOrderSent(order.id, terminalKeyId ?? undefined);
      if (!sent) continue;

      const expiresInSeconds = order.expires_at
        ? Math.max(0, Math.round((new Date(order.expires_at).getTime() - Date.now()) / 1000))
        : 0;

      if (order.trade_mode === "live") hasLive = true;
      else hasPaper = true;

      signals.push({
        signalId: order.id,
        symbol: order.symbol,
        side: order.side,
        entryPrice: Number(order.entry_price),
        stopLoss: Number(order.stop_loss),
        takeProfit: Number(order.take_profit),
        lotSize: Number(order.lot_size),
        entryType: order.entry_type,
        executionStrategy: (order.execution_strategy as EaSignal["executionStrategy"]) ?? order.entry_type,
        limitPrice: order.limit_price != null ? Number(order.limit_price) : null,
        maxEntryDriftPips: Number(order.max_entry_drift_pips ?? 2.0),
        minEffectiveRR: Number(order.min_effective_rr ?? 1.0),
        timeInForce: (order.time_in_force as EaSignal["timeInForce"]) ?? "GTC",
        riskReward: Number(order.risk_reward),
        expiresAt: order.expires_at ? new Date(order.expires_at).toISOString() : "",
        expiresInSeconds,
        entryZonePips: order.entry_zone_pips != null ? Number(order.entry_zone_pips) : null,
        trailingStop: null,
        maxHoldMinutes: null,
        portfolioId: null,
      });
    } catch (err) {
      console.error(`[mt5-signals] Error processing order ${order.id}:`, err);
    }
  }

  // If any order is live, report live so the EA does not paper-fill it.
  const responseMode = hasLive ? "live" : hasPaper ? "paper" : "paper";

  return NextResponse.json({
    ok: true,
    signals,
    count: signals.length,
    mode: responseMode,
  });
}
