import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import { fetchAnalyzeSnapshot } from "@/lib/analyzeSnapshot";

const VALID_TFS = ["1m", "5m", "15m", "1h", "4h", "1d"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? "EURUSD";
  let tfParam = searchParams.get("tf") ?? "1m";
  if (tfParam === "1D") tfParam = "1d";
  const tf = VALID_TFS.includes(tfParam) ? tfParam : "1m";
  const replayTsParam = searchParams.get("replayTs");
  const replayTs = replayTsParam ? new Date(replayTsParam) : undefined;

  const pool = getPool();
  const snapshot = await fetchAnalyzeSnapshot(pool, symbol, tf, replayTs);
  return NextResponse.json(snapshot);
}
