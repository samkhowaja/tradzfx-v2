/**
 * V1 EA compat: config endpoint.
 * Returns EA runtime configuration. V2 uses DB/strategy_specs as source of truth,
 * but the EA still polls this on startup for backfill settings.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const EXPECTED_API_KEY =
    process.env.TM_MT5_API_KEY ??
    process.env.MT5_API_KEY ??
    "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== EXPECTED_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    backfillDays: 90,
    syncIntervalSec: 60,
    batchSize: 2000,
    execEnabled: true,
    execPaperMode: true,
    execPollSec: 3,
    execSlippage: 20,
    execMaxSpreadPips: 3.0,
    paused: false,
    clearAndResync: false,
    symbols: ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "DXY"],
  });
}
