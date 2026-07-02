import type { Pool, TimeFrame, BiasNode } from "@tm/shared";
import {
  CANDLE_TABLE_BY_TF,
  getPairCharacteristics,
  getPipSizeForSymbol,
} from "@tm/shared";
import type {
  SetupDirection,
  BiasFeature,
  EvaluationContext,
  EvaluationInput,
  ZoneFeature,
  StructureFeature,
} from "./types";

export function biasToSetup(direction: string): SetupDirection {
  if (direction === "bullish") return "long";
  if (direction === "bearish") return "short";
  return "neutral";
}

export function setupToBias(direction: SetupDirection): string {
  if (direction === "long") return "bullish";
  if (direction === "short") return "bearish";
  return "neutral";
}

export async function buildContext(
  pool: Pool,
  input: EvaluationInput
): Promise<EvaluationContext> {
  const symbol = input.symbol.toUpperCase();
  const tf = input.tf;
  const asOf = input.asOf ?? new Date();

  // Resolve direction: prefer explicit input, fall back to current LTF bias
  let direction: SetupDirection = "neutral";
  if (input.direction) {
    direction = input.direction;
  } else {
    const bias = await fetchBias(pool, symbol, tf, asOf);
    direction = bias?.direction ?? "neutral";
  }

  const pair = getPairCharacteristics(symbol);
  const latestCandle = await fetchLatestCandle(pool, symbol, tf, asOf);

  const [bias, htfBias, pricing, zones, structure, atrRow, spreadRow, sessionRow, positionCount] =
    await Promise.all([
      fetchBias(pool, symbol, tf, asOf),
      fetchHtfBias(pool, symbol, tf, asOf),
      fetchPricing(pool, symbol, tf, asOf),
      fetchZones(pool, symbol, tf, asOf),
      fetchStructure(pool, symbol, tf, asOf),
      fetchAtr(pool, symbol, tf, asOf),
      input.backtest?.spreadPips != null
        ? Promise.resolve({ spread: input.backtest.spreadPips })
        : fetchSpread(pool, symbol, input.tf, asOf),
      input.backtest?.sessionName != null
        ? Promise.resolve({ session: input.backtest.sessionName })
        : fetchSession(pool, symbol, asOf),
      input.backtest?.activePositionCount != null
        ? Promise.resolve(input.backtest.activePositionCount)
        : fetchActivePositionCount(pool, symbol),
    ]);

  const spreadPips = spreadRow?.spread ?? pair.baseSpreadPips;
  const atrPrice = atrRow?.value ?? 0;
  const pipSize = getPipSizeForSymbol(symbol);
  const atrPips = pipSize > 0 ? atrPrice / pipSize : 0;

  const volatilityRegime = classifyVolatility(atrPips, latestCandle?.c ?? 0, pair.volLowAtrPct, pair.volHighAtrPct);

  const sessionName = sessionRow?.session ?? "UNKNOWN";
  const sessionIsKillzone = /KILLZONE|LONDON|NY|OVERLAP/i.test(sessionName);

  const maxAllowedSpreadPips = Math.max(pair.baseSpreadPips * 4, 3);
  const maxStopPips = atrPips > 0 ? Math.max(15, atrPips * 1.5) : 50;

  const entryZone = deriveEntryZone(zones, direction, atrPrice, latestCandle?.c);

  const featuresUsed: string[] = [];
  if (bias) featuresUsed.push("features_bias");
  if (htfBias) featuresUsed.push("features_htf_bias");
  if (pricing) featuresUsed.push("features_pricing");
  if (zones.length) featuresUsed.push("features_zone");
  if (structure.length) featuresUsed.push("features_structure");
  if (atrRow) featuresUsed.push("features_atr");
  if (spreadRow) featuresUsed.push("features_spread");
  if (sessionRow) featuresUsed.push("features_session");

  return {
    pool,
    symbol,
    tf,
    asOf,
    direction,
    minRR: input.minRR ?? 2,
    latestCandle,
    bias,
    htfBias,
    pricing,
    zones,
    structure,
    pivots: [], // populated when features_pivot is available
    atr: atrPrice,
    spreadPips,
    maxAllowedSpreadPips,
    maxStopPips,
    volatility: {
      regime: volatilityRegime,
      atrPips,
    },
    sessionProfile: sessionRow ? { name: sessionName, killzone: sessionIsKillzone } : null,
    activePositionCount: positionCount,
    maxPositionsPerSymbol: 2,
    evidence: [],
    warnings: [],
    featuresUsed,
    entryZone,
  };
}

async function fetchLatestCandle(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<EvaluationContext["latestCandle"]> {
  const table = CANDLE_TABLE_BY_TF[tf];
  if (!table) return null;
  try {
    const { rows } = await pool.query(
      `SELECT ts, o, h, l, c, v FROM ${table}
       WHERE symbol = $1 AND ts <= $2
       ORDER BY ts DESC LIMIT 1`,
      [symbol, asOf]
    );
    if (!rows.length) return null;
    return {
      ts: rows[0].ts,
      o: Number(rows[0].o),
      h: Number(rows[0].h),
      l: Number(rows[0].l),
      c: Number(rows[0].c),
      v: rows[0].v != null ? Number(rows[0].v) : undefined,
    };
  } catch (err) {
    console.warn(`[setupEngine] Failed to fetch candle from ${table}:`, (err as Error).message);
    return null;
  }
}

async function fetchBias(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<BiasFeature | null> {
  try {
    const { rows } = await pool.query(
      `SELECT direction, confidence, reason FROM features_bias
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      direction: biasToSetup(row.direction),
      confidence: Number(row.confidence) || 0,
      reason: row.reason,
      strength: inferStrength(Number(row.confidence)),
    };
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch bias:", (err as Error).message);
    return null;
  }
}

async function fetchHtfBias(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<EvaluationContext["htfBias"]> {
  try {
    const { rows } = await pool.query(
      `SELECT direction, confidence, state, score, reason,
              by_time_frame, trading_tf
       FROM features_htf_bias
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC
       LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      direction: biasToSetup(row.direction),
      confidence: Number(row.confidence) || 0,
      state: row.state ?? "BLOCK",
      score: Number(row.score) || 0,
      reason: row.reason ?? "",
      strength: inferStrength(Number(row.confidence)),
      byTimeFrame: parseHtfTree(row.by_time_frame),
      tradingTf: row.trading_tf ?? tf,
    };
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch HTF bias:", (err as Error).message);
    return null;
  }
}

function parseHtfTree(raw: unknown): Record<TimeFrame, BiasNode> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record: Record<TimeFrame, BiasNode> = {} as any;
  for (const [tf, nodeRaw] of Object.entries(raw as Record<string, unknown>)) {
    const n = nodeRaw as Record<string, unknown>;
    record[tf as TimeFrame] = {
      tf: (n.tf ?? tf) as TimeFrame,
      direction: n.direction as BiasNode["direction"],
      confidence: Number(n.confidence) || 0,
      state: (n.state as BiasNode["state"]) ?? "neutral",
      score: Number(n.score) || 0,
      reason: (n.reason as string) ?? "",
      parentTf: n.parent_tf ? (n.parent_tf as TimeFrame) : undefined,
    };
  }
  return record;
}

async function fetchPricing(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<EvaluationContext["pricing"]> {
  try {
    const { rows } = await pool.query(
      `SELECT position, in_ote, ote_low, ote_high,
              dynamic_ote_low, dynamic_ote_high, dynamic_ote_mid,
              dynamic_ote_source, dynamic_ote_quality, premium_discount_score
       FROM features_pricing
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      position: row.position,
      inOte: row.in_ote === true,
      oteLow: row.ote_low != null ? Number(row.ote_low) : undefined,
      oteHigh: row.ote_high != null ? Number(row.ote_high) : undefined,
      dynamicOteLow: row.dynamic_ote_low != null ? Number(row.dynamic_ote_low) : undefined,
      dynamicOteHigh: row.dynamic_ote_high != null ? Number(row.dynamic_ote_high) : undefined,
      dynamicOteMid: row.dynamic_ote_mid != null ? Number(row.dynamic_ote_mid) : undefined,
      dynamicOteSource: row.dynamic_ote_source ?? undefined,
      dynamicOteQuality: row.dynamic_ote_quality != null ? Number(row.dynamic_ote_quality) : undefined,
      premiumDiscountScore: row.premium_discount_score != null ? Number(row.premium_discount_score) : undefined,
    };
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch pricing:", (err as Error).message);
    return null;
  }
}

async function fetchZones(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<ZoneFeature[]> {
  try {
    const { rows } = await pool.query(
      `SELECT zone_kind, top, bottom, fill_pct, tapped
       FROM features_zone
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC`,
      [symbol, tf, asOf]
    );
    return rows.map((r) => ({
      id: `${r.zone_kind}-${r.top}-${r.bottom}`,
      type: r.zone_kind,
      top: Number(r.top),
      bottom: Number(r.bottom),
      fillPct: r.fill_pct != null ? Number(r.fill_pct) : 0,
      tapped: r.tapped === true,
      direction: zoneKindToDirection(r.zone_kind),
    }));
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch zones:", (err as Error).message);
    return [];
  }
}

async function fetchStructure(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<StructureFeature[]> {
  try {
    const { rows } = await pool.query(
      `SELECT event_type, direction, level, ts
       FROM features_structure
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC
       LIMIT 20`,
      [symbol, tf, asOf]
    );
    return rows.map((r) => ({
      eventType: r.event_type,
      direction: biasToSetup(r.direction),
      level: Number(r.level),
      ts: r.ts,
    }));
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch structure:", (err as Error).message);
    return [];
  }
}

async function fetchAtr(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<{ value: number; period: number } | null> {
  try {
    const { rows } = await pool.query(
      `SELECT value, period FROM features_atr
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC, period DESC
       LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) return null;
    return { value: Number(rows[0].value), period: Number(rows[0].period) };
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch ATR:", (err as Error).message);
    return null;
  }
}

async function fetchSpread(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<{ spread: number } | null> {
  try {
    const { rows } = await pool.query(
      `SELECT spread FROM features_spread
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
       ORDER BY ts DESC
       LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) return null;
    return { spread: Number(rows[0].spread) };
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch spread:", (err as Error).message);
    return null;
  }
}

async function fetchSession(
  pool: Pool,
  symbol: string,
  asOf: Date
): Promise<{ session: string } | null> {
  try {
    const { rows } = await pool.query(
      `SELECT session FROM features_session
       WHERE symbol = $1 AND ts <= $2
       ORDER BY ts DESC
       LIMIT 1`,
      [symbol, asOf]
    );
    if (!rows.length) return null;
    return { session: rows[0].session };
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch session:", (err as Error).message);
    return null;
  }
}

async function fetchActivePositionCount(pool: Pool, symbol: string): Promise<number> {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM orders
       WHERE symbol = $1 AND status = 'filled' AND closed_at IS NULL`,
      [symbol]
    );
    return rows[0]?.cnt ?? 0;
  } catch (err) {
    console.warn("[setupEngine] Failed to count active positions:", (err as Error).message);
    return 0;
  }
}

function inferStrength(confidence: number): "weak" | "moderate" | "strong" {
  if (confidence >= 0.7) return "strong";
  if (confidence >= 0.4) return "moderate";
  return "weak";
}

function zoneKindToDirection(kind: string): "long" | "short" | undefined {
  if (kind === "demand" || kind === "fvg" || kind === "breaker") return "long";
  if (kind === "supply") return "short";
  return undefined;
}

function classifyVolatility(
  atrPips: number,
  price: number,
  lowPct: number,
  highPct: number
): "low" | "normal" | "high" {
  if (!price) return "normal";
  const pct = (atrPips / price) * 100;
  if (pct < lowPct) return "low";
  if (pct > highPct) return "high";
  return "normal";
}

function deriveEntryZone(
  zones: ZoneFeature[],
  direction: SetupDirection,
  atr: number,
  price?: number
): { top: number; bottom: number; zoneId?: string; zoneType?: string } | null {
  const aligned = zones.filter((z) => {
    if (direction === "long") return z.direction === "long" || z.type === "demand";
    if (direction === "short") return z.direction === "short" || z.type === "supply";
    return false;
  });

  const candidates = price != null
    ? aligned.filter((z) => (direction === "long" ? price >= z.bottom : price <= z.top))
    : aligned;

  if (!candidates.length) return null;

  // Require the nearest edge of the zone to be within 1.5 ATR of price.
  // Without this guard the fallback picked the first aligned zone regardless
  // of distance, producing stops that were far too wide.
  const maxDistance = atr * 1.5;
  const nearCandidates = price != null && atr > 0
    ? candidates.filter((z) => {
        const edge = direction === "long" ? z.top : z.bottom;
        return Math.abs(edge - price) <= maxDistance;
      })
    : candidates;

  if (!nearCandidates.length) return null;

  nearCandidates.sort((a, b) => {
    if (direction === "long") return b.bottom - a.bottom; // nearest support
    return a.top - b.top; // nearest resistance
  });

  return {
    top: nearCandidates[0].top,
    bottom: nearCandidates[0].bottom,
    zoneId: nearCandidates[0].id,
    zoneType: nearCandidates[0].type,
  };
}
