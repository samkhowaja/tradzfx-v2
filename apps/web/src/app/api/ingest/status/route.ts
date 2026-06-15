/**
 * V1 EA compat: status endpoint.
 * Returns server-side symbol status for gap detection.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET(request: NextRequest) {
  const EXPECTED_API_KEY =
    process.env.TM_MT5_API_KEY ??
    process.env.MT5_API_KEY ??
    "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== EXPECTED_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const symbol = request.nextUrl.searchParams.get("symbol") ?? "";
  const cleanSymbol = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT ts FROM candles_1m WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
      [cleanSymbol],
    );

    if (rows.length === 0) {
      return NextResponse.json({ symbol: cleanSymbol, hasData: false });
    }

    const ts = new Date(rows[0].ts);
    return NextResponse.json({
      symbol: cleanSymbol,
      hasData: true,
      lastBarMs: ts.getTime(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
