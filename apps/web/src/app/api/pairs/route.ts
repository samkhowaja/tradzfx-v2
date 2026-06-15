import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

const MAJOR_PAIRS = [
  "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD",
  "USDCAD", "USDCHF", "USDJPY", "XAUUSD",
];

export async function GET() {
  const pool = getPool();

  const [biasRes, pricingRes, candleRes, signalRes] = await Promise.all([
    // Latest bias per symbol
    pool.query(
      `
      SELECT DISTINCT ON (symbol)
        symbol, direction, confidence, ts
      FROM features_bias
      WHERE symbol = ANY($1) AND tf = '15m'
      ORDER BY symbol, ts DESC
    `,
      [MAJOR_PAIRS]
    ),

    // Latest HTF pricing position per symbol
    pool.query(
      `
      SELECT DISTINCT ON (symbol)
        symbol, position, in_ote, ts
      FROM features_pricing
      WHERE symbol = ANY($1) AND tf = '4h'
      ORDER BY symbol, ts DESC
    `,
      [MAJOR_PAIRS]
    ),

    // Last candle per symbol
    pool.query(
      `
      SELECT DISTINCT ON (symbol)
        symbol, ts as last_bar_at
      FROM candles_1m
      WHERE symbol = ANY($1)
      ORDER BY symbol, ts DESC
    `,
      [MAJOR_PAIRS]
    ),

    // Signal activity in last 24h per symbol
    pool.query(
      `
      SELECT
        symbol,
        COUNT(*) FILTER (WHERE status IN ('pending', 'filled')) as active_count,
        COUNT(*) FILTER (WHERE status = 'closed' AND outcome IN ('win', 'partial_win')) as wins_24h,
        COUNT(*) FILTER (WHERE status = 'closed' AND outcome IN ('loss', 'breakeven')) as losses_24h
      FROM orders
      WHERE symbol = ANY($1) AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY symbol
    `,
      [MAJOR_PAIRS]
    ),
  ]);

  const biasMap = new Map(biasRes.rows.map((r: any) => [r.symbol, r]));
  const pricingMap = new Map(pricingRes.rows.map((r: any) => [r.symbol, r]));
  const candleMap = new Map(candleRes.rows.map((r: any) => [r.symbol, r]));
  const signalMap = new Map(signalRes.rows.map((r: any) => [r.symbol, r]));

  const now = Date.now();
  const pairs = MAJOR_PAIRS.map((symbol) => {
    const bias = biasMap.get(symbol);
    const pricing = pricingMap.get(symbol);
    const candle = candleMap.get(symbol);
    const sig = signalMap.get(symbol);

    const lastBarAt = candle?.last_bar_at
      ? new Date(candle.last_bar_at).getTime()
      : null;
    const isStale = lastBarAt ? now - lastBarAt > 8 * 60 * 1000 : true;

    return {
      symbol,
      bias: bias?.direction ?? null,
      biasConfidence: bias?.confidence ?? null,
      htfPosition: pricing?.position ?? null,
      inOte: pricing?.in_ote ?? false,
      lastBarAt: candle?.last_bar_at ?? null,
      isStale,
      activeSignals: parseInt(sig?.active_count ?? "0", 10),
      wins24h: parseInt(sig?.wins_24h ?? "0", 10),
      losses24h: parseInt(sig?.losses_24h ?? "0", 10),
    };
  });

  return NextResponse.json({ pairs });
}
