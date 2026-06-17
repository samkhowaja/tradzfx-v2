/**
 * V1 EA compat: config endpoint.
 * Returns EA runtime configuration. V2 uses DB/strategy_specs as source of truth,
 * but the EA still polls this on startup for backfill/settings.
 */

import { NextRequest, NextResponse } from "next/server";

function parseSymbols(): string[] {
  const raw = process.env.MT5_SYMBOLS ?? "EURUSD,GBPUSD,USDJPY,USDCHF,AUDUSD,USDCAD,NZDUSD,XAUUSD";
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const EXPECTED_API_KEY =
    process.env.TM_MT5_API_KEY ??
    process.env.MT5_API_KEY ??
    "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== EXPECTED_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const symbols = parseSymbols();
  const mode = process.env.NINJA_LIVE_MODE === "live" ? "live" : "paper";
  const backfillDays = Math.max(1, Math.min(365, Number(process.env.MT5_BACKFILL_DAYS ?? 30)));

  return NextResponse.json({
    // Legacy flat fields (kept for older EAs)
    backfillDays,
    syncIntervalSec: 60,
    batchSize: 2000,
    execEnabled: true,
    execPaperMode: mode !== "live",
    execPollSec: 3,
    execSlippage: 20,
    execMaxSpreadPips: 5.0,
    paused: false,
    clearAndResync: false,
    symbols,

    // Manager EA structured config
    ok: true,
    manager: {
      enabled: true,
      mode,
      symbols,
      sync: {
        enabled: true,
        intervalSec: 60,
        backfillDays,
        batchSize: 2000,
      },
      execution: {
        enabled: true,
        pollSec: 3,
        maxSpreadPips: 5.0,
        maxSlippagePoints: 20,
        defaultLots: Number(process.env.NINJA_LOT_SIZE ?? 0.01),
      },
      commands: {
        enabled: true,
        pollSec: 10,
      },
    },
  });
}
