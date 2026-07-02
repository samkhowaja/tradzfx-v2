/**
 * V1 EA compat: config endpoint.
 * Returns EA runtime configuration in the nested "manager" shape expected by
 * tradzfxManager_v5_0_1.mq5.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const EXPECTED_API_KEY =
    process.env.TM_MT5_API_KEY ??
    process.env.MT5_API_KEY ??
    "";
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== EXPECTED_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    manager: {
      enabled: true,
      mode: "paper",
      symbols: ["AUDUSD", "EURUSD", "GBPUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY", "USDSEK", "XAUUSD", "DXY"],
      sync: {
        enabled: true,
        intervalSec: 60,
        backfillDays: 90,
        batchSize: 2000,
      },
      execution: {
        enabled: true,
        pollSec: 3,
        maxSpreadPips: 3.0,
        maxSlippagePoints: 20,
        maxSignalEntrySlippagePips: 2.0,
        minEffectiveRiskReward: 1.0,
        allowLimitOrders: true,
        defaultTimeInForce: "GTC",
        defaultLots: 0.01,
      },
      commands: {
        enabled: true,
        pollSec: 10,
      },
    },
  });
}
