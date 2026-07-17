import { NextResponse } from "next/server";
import { getWebReadPool } from "@tm/shared";

export async function GET() {
  const pool = getWebReadPool();

  const { rows: orderEvents } = await pool.query(`
    SELECT 
      id as entity_id,
      symbol,
      status as event_type,
      side,
      outcome,
      realized_pnl,
      outcome_r,
      COALESCE(filled_at, closed_at, created_at) as ts
    FROM orders
    WHERE status IN ('filled', 'closed')
    ORDER BY COALESCE(filled_at, closed_at, created_at) DESC
    LIMIT 20
  `);

  const { rows: traces } = await pool.query(`
    SELECT 
      run_id,
      symbol,
      node_type,
      passed,
      reason,
      ts
    FROM decision_trace
    ORDER BY ts DESC
    LIMIT 20
  `);

  const events = [
    ...orderEvents.map((e: any) => ({
      type: "order" as const,
      entityId: e.entity_id,
      symbol: e.symbol,
      event: e.event_type,
      side: e.side,
      outcome: e.outcome,
      pnl: e.realized_pnl,
      r: e.outcome_r,
      ts: e.ts,
    })),
    ...traces.map((t: any) => ({
      type: "trace" as const,
      entityId: t.run_id,
      symbol: t.symbol,
      event: t.node_type,
      passed: t.passed,
      reason: t.reason,
      ts: t.ts,
    })),
  ];

  events.sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
  );

  return NextResponse.json({ events: events.slice(0, 25) });
}
