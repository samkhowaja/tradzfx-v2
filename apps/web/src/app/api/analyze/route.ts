import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

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
  const [{ rows: biasRows }, { rows: structureRows }, { rows: zoneRows },
         { rows: pricingRows }, { rows: pivotRows }, { rows: atrRows },
         { rows: sweepRows }] = await Promise.all([
    pool.query(
      `SELECT direction, confidence, reason FROM features_bias WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
      [symbol]
    ),
    pool.query(
      `SELECT ts, event_type, direction, level FROM features_structure WHERE symbol = $1 ORDER BY ts DESC LIMIT 5`,
      [symbol]
    ),
    pool.query(
      `SELECT ts, zone_kind, top, bottom, fill_pct, tapped FROM features_zone WHERE symbol = $1 AND tapped = false ORDER BY ts DESC LIMIT 10`,
      [symbol]
    ),
    pool.query(
      `SELECT position, in_ote FROM features_pricing WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
      [symbol]
    ),
    pool.query(
      `SELECT ts, kind, price, confidence FROM features_pivot WHERE symbol = $1 ORDER BY ts DESC LIMIT 10`,
      [symbol]
    ),
    pool.query(
      `SELECT period, value FROM features_atr WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
      [symbol]
    ),
    pool.query(
      `SELECT ts, direction, level FROM features_sweep WHERE symbol = $1 ORDER BY ts DESC LIMIT 5`,
      [symbol]
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
      ? { position: pricingRows[0].position, in_ote: !!pricingRows[0].in_ote }
      : null,
    atr: atrRows[0] ? { value: atrRows[0].value, period: atrRows[0].period } : null,
    structure: structureRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      event_type: r.event_type,
      direction: r.direction,
      level: r.level,
    })),
    zones: zoneRows.map((r: any) => ({
      ts: r.ts.toISOString(),
      zone_kind: r.zone_kind,
      top: r.top,
      bottom: r.bottom,
      fill_pct: r.fill_pct ?? 0,
      tapped: !!r.tapped,
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
    })),
  };

  // ── Signals ──
  const { rows: signals } = await pool.query(
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
