import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

async function safeQuery(
  pool: any,
  text: string,
  params: any[],
  fallback: { rows: any[] } = { rows: [] }
): Promise<{ rows: any[] }> {
  try {
    return await pool.query(text, params);
  } catch (err: any) {
    // 42P01 = undefined table, 42703 = undefined column
    if (err?.code === "42P01" || err?.code === "42703") {
      console.warn(`[analyze] skipping query: ${err.message}`);
      return fallback;
    }
    throw err;
  }
}

const VALID_TFS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/** How many 1m candles to fetch for each display TF (covers ~same time span) */
const TF_CANDLE_LIMIT: Record<string, number> = {
  "1m": 2000,
  "5m": 2000,
  "15m": 2000,
  "1h": 1500,
  "4h": 1000,
  "1d": 500,
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? "EURUSD";
  let tf = searchParams.get("tf") ?? "1m";
  if (tf === "1D") tf = "1d";
  if (!VALID_TFS.includes(tf)) tf = "1m";

  const pool = getPool();

  // ── Candles: fetch 1m then aggregate if needed ──
  const limit = TF_CANDLE_LIMIT[tf];
  const { rows: rawCandles } = await pool.query(
    `
    SELECT ts, o, h, l, c, v
    FROM candles_1m
    WHERE symbol = $1
    ORDER BY ts DESC
    LIMIT $2
    `,
    [symbol, limit * (tf === "1m" ? 1 : Math.ceil(TF_MS[tf] / TF_MS["1m"]))]
  );

  // Reverse to chronological order
  rawCandles.reverse();

  // Deduplicate by rounding to nearest minute (MT5 sends bars at both xx:59 and xx:00)
  const dedupedMap = new Map<number, { ts: Date; o: number; h: number; l: number; c: number; v: number }>();
  for (const r of rawCandles) {
    const key = Math.round(r.ts.getTime() / 60000) * 60000;
    const existing = dedupedMap.get(key);
    if (!existing) {
      dedupedMap.set(key, { ts: new Date(key), o: r.o, h: r.h, l: r.l, c: r.c, v: Number(r.v ?? 0) });
    } else {
      existing.h = Math.max(existing.h, r.h);
      existing.l = Math.min(existing.l, r.l);
      existing.c = r.c;
      existing.v += Number(r.v ?? 0);
    }
  }
  const deduped = Array.from(dedupedMap.values()).sort((a, b) => a.ts.getTime() - b.ts.getTime());

  const candles =
    tf === "1m"
      ? deduped.map((r) => ({
          ts: r.ts.toISOString(),
          o: r.o,
          h: r.h,
          l: r.l,
          c: r.c,
          v: r.v,
        }))
      : aggregateCandles(deduped, tf);

  // ── Features from V2 feature tables ──
  const [
    { rows: biasRows },
    { rows: structureRows },
    { rows: zoneRows },
    { rows: ifvgRows },
    { rows: pricingRows },
    { rows: pivotRows },
    { rows: atrRows },
    { rows: sweepRows },
    { rows: liquidityPoolRows },
    { rows: displacementRows },
    { rows: candlePatternRows },
    { rows: movingAverageRows },
    { rows: bollingerRows },
    { rows: keltnerRows },
    { rows: zoneRetestRows },
    { rows: orderBlockRows },
    { rows: eqLiquidityRows },
  ] = await Promise.all([
    safeQuery(
      pool,
      `SELECT direction, confidence, reason FROM features_bias WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 1`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, event_type, direction, level, invalidated_at FROM features_structure WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 5`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, zone_kind, direction, top, bottom, fill_pct, tapped, mitigated_at, invalidated_at FROM features_zone WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 10`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, direction, top, bottom, fill_pct, tapped, originating_zone_ts, mitigated_at, invalidated_at FROM features_ifvg WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 10`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT position, in_ote, ote_low, ote_high FROM features_pricing WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 1`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, kind, price, confidence FROM features_pivot WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 10`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT period, value FROM features_atr WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 1`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, direction, level, mitigated_at FROM features_sweep WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 5`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT kind, side, label, price, distance, strength, interval, recent_sweep_matched FROM features_liquidity_pools WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 20`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, grade, direction, body_pct, consecutive_count, sequence_grade FROM features_displacement WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 5`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, pattern_name, direction, confidence, body_pct_of_atr, shadow_pct_of_atr FROM features_candle_pattern WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 10`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ma_type, period, value FROM features_moving_average WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 10`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT period, multiplier, upper_band, middle_band, lower_band, bandwidth, percent_b FROM features_bollinger WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 5`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ema_period, atr_period, multiplier, upper_channel, middle_channel, lower_channel FROM features_keltner WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 5`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, zone_kind, top, bottom, wick_into_zone, close_inside_zone, engulfing_at_zone, direction FROM features_zone_retest WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 10`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, ob_kind, degree, top, bottom, formation_ts, age_bars, is_fresh, strength_score, mitigated_at, invalidated_at FROM features_order_block WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 10`,
      [symbol, tf]
    ),
    safeQuery(
      pool,
      `SELECT ts, kind, price, strength, touched FROM features_eq_liquidity WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT 20`,
      [symbol, tf]
    ),
  ]);

  const features = {
    bias: biasRows[0]
      ? {
          direction: biasRows[0].direction,
          confidence: biasRows[0].confidence ?? 0,
          reason: biasRows[0].reason ?? "",
        }
      : null,
    pricing: pricingRows[0]
      ? {
          position: pricingRows[0].position,
          in_ote: !!pricingRows[0].in_ote,
          ote_low: pricingRows[0].ote_low,
          ote_high: pricingRows[0].ote_high,
        }
      : null,
    atr: atrRows[0] ? { value: atrRows[0].value, period: atrRows[0].period } : null,
    structure: structureRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      event_type: r.event_type,
      direction: r.direction,
      level: r.level,
      invalidated_at: r.invalidated_at?.toISOString() ?? null,
    })),
    zones: zoneRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      zone_kind: r.zone_kind,
      direction: r.direction ?? null,
      top: r.top,
      bottom: r.bottom,
      fill_pct: r.fill_pct ?? 0,
      tapped: !!r.tapped,
      mitigated_at: r.mitigated_at?.toISOString() ?? null,
      invalidated_at: r.invalidated_at?.toISOString() ?? null,
    })),
    ifvgs: ifvgRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      originating_zone_ts: r.originating_zone_ts?.toISOString() ?? r.ts.toISOString(),
      direction: r.direction,
      top: r.top,
      bottom: r.bottom,
      fill_pct: r.fill_pct ?? 0,
      tapped: !!r.tapped,
      mitigated_at: r.mitigated_at?.toISOString() ?? null,
      invalidated_at: r.invalidated_at?.toISOString() ?? null,
    })),
    pivots: pivotRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      kind: r.kind,
      price: r.price,
      confidence: r.confidence ?? 80,
    })),
    sweep: sweepRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      direction: r.direction,
      level: r.level,
      mitigated_at: r.mitigated_at?.toISOString() ?? null,
    })),
    liquidityPools: liquidityPoolRows.map((r: any) => ({
      kind: r.kind,
      side: r.side ?? null,
      label: r.label,
      price: r.price,
      distance: r.distance,
      strength: r.strength,
      interval: r.interval,
      recent_sweep_matched: !!r.recent_sweep_matched,
    })),
    displacement: displacementRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      grade: r.grade,
      direction: r.direction,
      body_pct: r.body_pct,
      consecutive_count: r.consecutive_count,
      sequence_grade: r.sequence_grade,
    })),
    candlePatterns: candlePatternRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      pattern_name: r.pattern_name,
      direction: r.direction,
      confidence: r.confidence,
      body_pct_of_atr: r.body_pct_of_atr,
      shadow_pct_of_atr: r.shadow_pct_of_atr,
    })),
    movingAverages: movingAverageRows.map((r: any) => ({
      ma_type: r.ma_type,
      period: r.period,
      value: r.value,
    })),
    bollinger: bollingerRows[0]
      ? {
          period: bollingerRows[0].period,
          multiplier: bollingerRows[0].multiplier,
          upper: bollingerRows[0].upper_band,
          middle: bollingerRows[0].middle_band,
          lower: bollingerRows[0].lower_band,
          bandwidth: bollingerRows[0].bandwidth,
          percent_b: bollingerRows[0].percent_b,
        }
      : null,
    keltner: keltnerRows[0]
      ? {
          ema_period: keltnerRows[0].ema_period,
          atr_period: keltnerRows[0].atr_period,
          multiplier: keltnerRows[0].multiplier,
          upper: keltnerRows[0].upper_channel,
          middle: keltnerRows[0].middle_channel,
          lower: keltnerRows[0].lower_channel,
        }
      : null,
    zoneRetests: zoneRetestRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      zone_kind: r.zone_kind,
      top: r.top,
      bottom: r.bottom,
      wick_into_zone: !!r.wick_into_zone,
      close_inside_zone: !!r.close_inside_zone,
      engulfing_at_zone: !!r.engulfing_at_zone,
      direction: r.direction,
    })),
    orderBlocks: orderBlockRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      ob_kind: r.ob_kind,
      degree: r.degree,
      top: r.top,
      bottom: r.bottom,
      formation_ts: r.formation_ts?.toISOString() ?? r.ts.toISOString(),
      age_bars: r.age_bars ?? 0,
      is_fresh: !!r.is_fresh,
      strength_score: r.strength_score ?? 0,
      mitigated_at: r.mitigated_at?.toISOString() ?? null,
      invalidated_at: r.invalidated_at?.toISOString() ?? null,
    })),
    eqLiquidity: eqLiquidityRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      kind: r.kind,
      price: r.price,
      strength: r.strength ?? 0,
      touched: !!r.touched,
    })),
  };

  // ── Signals ──
  const { rows: signals } = await safeQuery(
    pool,
    `
    SELECT id, side, entry_price, stop_loss, take_profit, status, outcome, outcome_r, created_at, filled_at, closed_at
    FROM orders
    WHERE symbol = $1
    ORDER BY created_at DESC
    LIMIT 10
    `,
    [symbol]
  );

  // ── Build narrative from available features ──
  const narrative = buildNarrative(features, symbol);

  return NextResponse.json({
    symbol,
    tf,
    candles,
    features,
    signals,
    narrative,
  });
}

/** Aggregate 1m candles to target timeframe */
function aggregateCandles(
  raw: Array<{ ts: Date; o: number; h: number; l: number; c: number; v: number }>,
  tf: string
): Array<{ ts: string; o: number; h: number; l: number; c: number; v: number }> {
  const intervalMs = TF_MS[tf];
  const buckets = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();

  for (const r of raw) {
    const t = r.ts.getTime();
    const bucketKey = Math.floor(t / intervalMs) * intervalMs;
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, { o: r.o, h: r.h, l: r.l, c: r.c, v: Number(r.v ?? 0) });
    } else {
      existing.h = Math.max(existing.h, r.h);
      existing.l = Math.min(existing.l, r.l);
      existing.c = r.c;
      existing.v += Number(r.v ?? 0);
    }
  }

  const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  return sorted.map(([t, v]) => ({
    ts: new Date(t).toISOString(),
    o: v.o,
    h: v.h,
    l: v.l,
    c: v.c,
    v: v.v,
  }));
}

function buildNarrative(features: any, symbol: string) {
  const bias = features.bias;
  const pricing = features.pricing;
  const dir = bias?.direction ?? "neutral";
  const conf = bias?.confidence ?? 0;

  let headline = `${symbol} — no clear direction yet`;
  if (dir === "bullish") headline = conf > 65 ? `${symbol} is trending upward` : `${symbol} has a slight upward lean`;
  else if (dir === "bearish") headline = conf > 65 ? `${symbol} is trending downward` : `${symbol} has a slight downward lean`;

  let verdict = "Unclear market conditions";
  let verdictColor = "gray";
  if (dir === "bullish") { verdict = "Market leans bullish but no clear entry yet"; verdictColor = "amber"; }
  else if (dir === "bearish") { verdict = "Market leans bearish but no clear entry yet"; verdictColor = "amber"; }

  const sections: any[] = [];

  // Big Picture
  const pos = pricing?.position ?? "unknown";
  let bigPic = `${symbol} is currently ${dir === "bullish" ? "moving upward" : dir === "bearish" ? "moving downward" : "moving sideways"} on the bigger picture.`;
  bigPic += ` Price is in the ${pos} zone.`;
  if (bias?.reason) bigPic += ` The main reason: ${bias.reason}.`;
  sections.push({ heading: "The Big Picture", body: bigPic, emoji: "🌍", importance: "high" });

  // What's Happening Now
  const structure = features.structure ?? [];
  let happening = `The market is showing ${structure.length > 0 ? "active structure with recent " + structure.slice(0, 2).map((s: any) => s.event_type.toUpperCase()).join(", ") : "normal activity"}.`;
  if (pricing?.in_ote) happening += " Price is currently in the optimal trade entry (OTE) zone.";
  sections.push({ heading: "What's Happening Now", body: happening, emoji: "⏰", importance: "high" });

  // Confidence
  let confDesc = "Low confidence — conditions are uncertain. Be cautious.";
  if (conf >= 80) confDesc = "Very high confidence — the analysis strongly supports this setup.";
  else if (conf >= 60) confDesc = "Good confidence — the analysis supports this setup with reasonable certainty.";
  else if (conf >= 40) confDesc = "Moderate confidence — some supporting evidence, but not everything aligns.";
  sections.push({ heading: "Confidence Level", body: `Confidence score: ${conf}/100. ${confDesc}`, emoji: "🎯", importance: "medium" });

  // Zones
  const zones = features.zones ?? [];
  const activeZones = zones.filter((z: any) => !z.tapped).slice(0, 3);
  if (activeZones.length > 0) {
    const zoneText = activeZones.map((z: any) => `${z.zone_kind} zone at ${z.bottom.toFixed(5)}–${z.top.toFixed(5)}`).join("; ");
    sections.push({ heading: "Active Zones", body: `Untapped ${zoneText}. Watch for price to reach these levels.`, emoji: "📍", importance: "medium" });
  }

  // Glossary
  const glossary = [
    { term: "Bias", definition: "The expected direction of price movement based on technical analysis." },
    { term: "Entry Zone", definition: "A price area where conditions favor entering a trade." },
    { term: "Stop Loss", definition: "A price level where you exit to prevent further losses if the trade goes wrong." },
    { term: "Target / Take Profit", definition: "A price level where you close the trade to lock in gains." },
    { term: "Timeframe", definition: "The time period each candle represents (e.g., 15m = 15 minutes). Higher timeframes show the bigger picture." },
  ];

  return {
    headline,
    verdict,
    verdictColor,
    sections,
    glossary,
    keyLevels: null,
  };
}
