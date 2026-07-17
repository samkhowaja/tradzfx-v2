/**
 * V1 EA compat: heartbeat endpoint.
 * Fire-and-forget health ping from MT5 EA.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import { getMt5RequestApiKey, validateMt5ApiKey } from "@/lib/mt5Auth";

export async function POST(request: NextRequest) {
  const apiKey = getMt5RequestApiKey(request);
  if (!(await validateMt5ApiKey(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object") {
      const platform = String(body.platform ?? "mt5");
      const accountNumber = body.accountNumber != null ? String(body.accountNumber) : null;
      const brokerServer = body.brokerServer != null ? String(body.brokerServer) : null;
      const balance = typeof body.balance === "number" ? body.balance : null;
      const equity = typeof body.equity === "number" ? body.equity : null;

      if (accountNumber) {
        const pool = getPool();
        const broker = body.broker != null ? String(body.broker) : null;
        const accountType = body.accountType != null ? String(body.accountType) : null;
        const currency = body.currency != null ? String(body.currency) : null;
        const leverage = typeof body.leverage === "number" ? Math.round(body.leverage) : null;
        const label = body.label != null ? String(body.label) : null;

        await pool.query(
          `INSERT INTO mt5_terminals (
             platform, account_number, broker_server, broker, account_type,
             currency, leverage, label, balance, equity, last_seen_at, api_key
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
           ON CONFLICT (platform, account_number, broker_server)
           DO UPDATE SET
             broker = COALESCE(EXCLUDED.broker, mt5_terminals.broker),
             account_type = COALESCE(EXCLUDED.account_type, mt5_terminals.account_type),
             currency = COALESCE(EXCLUDED.currency, mt5_terminals.currency),
             leverage = COALESCE(EXCLUDED.leverage, mt5_terminals.leverage),
             label = COALESCE(EXCLUDED.label, mt5_terminals.label),
             balance = COALESCE(EXCLUDED.balance, mt5_terminals.balance),
             equity = COALESCE(EXCLUDED.equity, mt5_terminals.equity),
             last_seen_at = NOW()`,
          [
            platform,
            accountNumber,
            brokerServer,
            broker,
            accountType,
            currency,
            leverage,
            label,
            balance,
            equity,
            apiKey,
          ]
        );
      }
    }
  } catch (err) {
    // Never fail the heartbeat because of a DB issue.
    console.warn("[mt5-heartbeat] Failed to refresh terminal status:", (err as Error).message);
  }

  return NextResponse.json({ ok: true });
}
