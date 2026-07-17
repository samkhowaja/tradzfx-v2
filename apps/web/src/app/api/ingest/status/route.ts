/**
 * V1 EA compat: status endpoint.
 * Returns server-side symbol status for gap detection.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import { validateMt5ApiKey } from "@/lib/mt5Auth";

async function auth(request: NextRequest) {
  if (!(await validateMt5ApiKey(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = await auth(request);
  if (denied) return denied;

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

export async function POST(request: NextRequest) {
  const denied = await auth(request);
  if (denied) return denied;

  // Fire-and-forget status snapshot from the EA. We currently just ack it;
  // future versions can persist terminal errors/symbols here.
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object" && Array.isArray(body.errors) && body.errors.length > 0) {
      console.warn("[mt5-status] EA reported errors:", body.errors);
    }
  } catch {
    // ignore malformed body
  }

  return NextResponse.json({ ok: true });
}
