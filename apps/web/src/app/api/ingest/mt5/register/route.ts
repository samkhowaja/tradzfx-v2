/**
 * V1 EA compat: auto-registration endpoint.
 * The MT5 Manager EA calls this on startup when no cached API key exists.
 * The server returns the configured MT5 API key and records the terminal.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";

const API_KEY =
  process.env.TM_MT5_API_KEY ??
  process.env.MT5_API_KEY ??
  "";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const platform = String(body.platform ?? "mt5");
    const accountNumber = String(body.accountNumber ?? "");
    const broker = body.broker ? String(body.broker) : null;
    const brokerServer = body.brokerServer ? String(body.brokerServer) : null;
    const accountType = body.accountType ? String(body.accountType) : null;
    const currency = body.currency ? String(body.currency) : null;
    const leverage = typeof body.leverage === "number" ? Math.round(body.leverage) : null;
    const label = body.label ? String(body.label) : null;
    const balance = typeof body.balance === "number" ? body.balance : null;

    if (!accountNumber) {
      return NextResponse.json(
        { ok: false, error: "accountNumber required" },
        { status: 400 }
      );
    }

    const pool = getPool();
    await pool.query(
      `INSERT INTO mt5_terminals (
         platform, account_number, broker, broker_server, account_type,
         currency, leverage, label, balance, api_key, last_seen_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (platform, account_number, broker_server)
       DO UPDATE SET
         broker = EXCLUDED.broker,
         account_type = EXCLUDED.account_type,
         currency = EXCLUDED.currency,
         leverage = EXCLUDED.leverage,
         label = EXCLUDED.label,
         balance = EXCLUDED.balance,
         api_key = EXCLUDED.api_key,
         last_seen_at = NOW()`,
      [
        platform,
        accountNumber,
        broker,
        brokerServer,
        accountType,
        currency,
        leverage,
        label,
        balance,
        API_KEY,
      ]
    );

    return NextResponse.json({ ok: true, apiKey: API_KEY });
  } catch (err: any) {
    console.error("[mt5-register] Error:", err.message);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
