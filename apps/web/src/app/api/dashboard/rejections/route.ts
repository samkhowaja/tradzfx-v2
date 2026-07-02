import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET() {
  const pool = getPool();

  const { rows: overall } = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
      COUNT(*) FILTER (WHERE status = 'filled') as filled,
      COUNT(*) FILTER (WHERE status = 'closed') as closed,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'sent') as sent,
      COUNT(*) FILTER (WHERE status = 'expired') as expired
    FROM orders
    WHERE created_at >= NOW() - INTERVAL '7 days'
  `);

  const { rows: byReason } = await pool.query(`
    SELECT 
      COALESCE(NULLIF(reject_reason, ''), 'Unknown') as reason,
      COUNT(*) as count
    FROM orders
    WHERE status = 'rejected' AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY COALESCE(NULLIF(reject_reason, ''), 'Unknown')
    ORDER BY count DESC
  `);

  const { rows: bySymbol } = await pool.query(`
    SELECT 
      symbol,
      COUNT(*) FILTER (WHERE status = 'rejected') as rejections,
      COUNT(*) as total,
      ROUND(COUNT(*) FILTER (WHERE status = 'rejected')::numeric / NULLIF(COUNT(*), 0)::numeric, 3) as reject_rate
    FROM orders
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY symbol
    ORDER BY rejections DESC
  `);

  const { rows: byStrategy } = await pool.query(`
    SELECT 
      strategy_id,
      COUNT(*) FILTER (WHERE status = 'rejected') as rejections,
      COUNT(*) as total,
      ROUND(COUNT(*) FILTER (WHERE status = 'rejected')::numeric / NULLIF(COUNT(*), 0)::numeric, 3) as reject_rate
    FROM orders
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY strategy_id
    ORDER BY rejections DESC
  `);

  const { rows: dailyTrend } = await pool.query(`
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
      COUNT(*) FILTER (WHERE status = 'filled') as filled,
      COUNT(*) FILTER (WHERE status = 'closed') as closed
    FROM orders
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);

  const { rows: recent } = await pool.query(`
    SELECT 
      id, symbol, strategy_id, side, entry_price, stop_loss, take_profit,
      status, reject_reason, created_at
    FROM orders
    WHERE status = 'rejected'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  // Signal-level rejections that never became orders (dedup, stale data, gates, etc.)
  const { rows: signalRejectionStats } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT reason) as distinct_reasons
    FROM live_signal_rejection
    WHERE created_at >= NOW() - INTERVAL '7 days'
  `);

  const { rows: signalRejectionsByReason } = await pool.query(`
    SELECT
      reason,
      COUNT(*) as count
    FROM live_signal_rejection
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY reason
    ORDER BY count DESC
  `);

  const { rows: signalRejectionsBySymbol } = await pool.query(`
    SELECT
      symbol,
      COUNT(*) as count
    FROM live_signal_rejection
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY symbol
    ORDER BY count DESC
  `);

  const { rows: recentSignalRejections } = await pool.query(`
    SELECT
      id, symbol, strategy_id, side, reason, signal_fingerprint, created_at
    FROM live_signal_rejection
    ORDER BY created_at DESC
    LIMIT 10
  `);

  return NextResponse.json({
    overall: overall[0],
    byReason,
    bySymbol,
    byStrategy,
    dailyTrend,
    recent,
    signalRejections: {
      overall: signalRejectionStats[0],
      byReason: signalRejectionsByReason,
      bySymbol: signalRejectionsBySymbol,
      recent: recentSignalRejections,
    },
  });
}
