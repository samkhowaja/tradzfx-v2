// GET /api/mt5/signals
// =====================
// EA polls this endpoint to pick up PENDING trade signals.
// V2 implementation — uses the orders table in tradementor_v2.

import { NextRequest, NextResponse } from "next/server";
import { getPendingOrders, markOrderSent, expireStaleOrders } from "@/lib/orderService";

// Simple API key validation (reuse same key as bar ingest for now)
const EXPECTED_API_KEY = process.env.MT5_API_KEY ?? "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";

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

  // 2. Expire stale orders before returning
  try {
    const expired = await expireStaleOrders();
    if (expired > 0) {
      console.log(`[mt5-signals] Expired ${expired} stale order(s)`);
    }
  } catch {
    // Non-fatal
  }

  // 3. Parse optional symbol filter
  const symbolsParam = req.nextUrl.searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  // 4. Fetch pending orders
  const orders = await getPendingOrders(symbols);

  // 5. Mark as sent and build EA response
  const signals: EaSignal[] = [];
  let hasLive = false;
  let hasPaper = false;
  for (const order of orders) {
    try {
      await markOrderSent(order.id);

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
