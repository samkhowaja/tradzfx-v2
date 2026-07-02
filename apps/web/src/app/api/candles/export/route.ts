/**
 * GET /api/candles/export
 *
 * Export DB candles as a tab-delimited MT5-style CSV.
 *
 * Query params:
 *   symbol       - required, e.g. XAUUSD
 *   from         - required, ISO 8601 UTC start time
 *   to           - required, ISO 8601 UTC end time
 *   tf           - optional, one of 1m,5m,15m,1h,4h,1d_utc,1d_ny (default 1m)
 *   tzOffsetSec  - optional, shift timestamps by this many seconds (e.g. 10800 for UTC+3)
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";

const EXPECTED_API_KEY = process.env.MT5_API_KEY ?? "";

function validateApiKey(req: NextRequest): boolean {
  if (!EXPECTED_API_KEY) return true;
  const key = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  return key === EXPECTED_API_KEY;
}

const VALID_TFS: Record<string, string> = {
  "1m": "candles_1m",
  "5m": "candles_5m",
  "15m": "candles_15m",
  "1h": "candles_1h",
  "4h": "candles_4h",
  "1d_utc": "candles_1d_utc",
  "1d_ny": "candles_1d_ny",
};

export async function GET(req: NextRequest) {
  if (!validateApiKey(req)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const symbol = searchParams.get("symbol")?.toUpperCase();
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const tf = searchParams.get("tf") ?? "1m";
  const tzOffsetSecRaw = searchParams.get("tzOffsetSec");
  const tzOffsetSec = tzOffsetSecRaw ? parseInt(tzOffsetSecRaw, 10) : 0;

  if (!symbol || !from || !to) {
    return NextResponse.json({ ok: false, error: "Missing symbol, from, or to" }, { status: 400 });
  }

  const table = VALID_TFS[tf.toLowerCase()];
  if (!table) {
    return NextResponse.json(
      { ok: false, error: `Invalid tf. Valid: ${Object.keys(VALID_TFS).join(", ")}` },
      { status: 400 }
    );
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ ok: false, error: "Invalid from/to date" }, { status: 400 });
  }

  const pool = getPool();

  try {
    const { rows } = await pool.query(
      `
      SELECT
        to_char(ts + make_interval(secs => $4), 'YYYY.MM.DD') AS d,
        to_char(ts + make_interval(secs => $4), 'HH24:MI:SS') AS t,
        o,
        h,
        l,
        c,
        v,
        0 AS real_vol,
        COALESCE(spread, 0) AS spread
      FROM ${table}
      WHERE symbol = $1 AND ts >= $2 AND ts <= $3
      ORDER BY ts
      `,
      [symbol, fromDate, toDate, tzOffsetSec]
    );

    const lines: string[] = ["<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>"];
    for (const r of rows) {
      lines.push(
        `${r.d}\t${r.t}\t${r.o}\t${r.h}\t${r.l}\t${r.c}\t${r.v}\t${r.real_vol}\t${r.spread}`
      );
    }

    return new NextResponse(lines.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${symbol}_${tf}_${fromDate.toISOString()}_${toDate.toISOString()}.csv"`,
      },
    });
  } catch (err: any) {
    console.error("[candles/export] error:", err);
    return NextResponse.json({ ok: false, error: err.message ?? "DB error" }, { status: 500 });
  }
}
