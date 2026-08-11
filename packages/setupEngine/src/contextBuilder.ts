import type { Pool, Queryable, TimeFrame, BiasNode } from "@tm/shared";
import {
  getLatestCandle,
  getPairCharacteristics,
  getGateMaxSpreadPips,
  getRegistryPipSize,
  getLevelMaxAgeDays,
  SPREAD_SANITY_MULTIPLIER,
} from "@tm/shared";

// SPREAD_SANITY_MULTIPLIER comes from @tm/shared (pairCharacteristics) so the
// setup engine, the spread producer, and the PIT backtester share one ceiling.
import type {
  SetupDirection,
  BiasFeature,
  EvaluationContext,
  EvaluationInput,
  ZoneFeature,
  StructureFeature,
  BlockedData,
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
  pool: Queryable,
  input: EvaluationInput
): Promise<EvaluationContext> {
  const symbol = input.symbol.toUpperCase();
  const tf = input.tf;
  const asOf = input.asOf ?? new Date();
  const blockedData: BlockedData | undefined = undefined;

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
  const pipSize = getRegistryPipSize(symbol);
  const atrPips = pipSize > 0 ? atrPrice / pipSize : 0;

  const volatilityRegime = classifyVolatility(atrPips, latestCandle?.c ?? 0, pair.volLowAtrPct, pair.volHighAtrPct);

  const sessionName = sessionRow?.session ?? "UNKNOWN";
  const sessionIsKillzone = /KILLZONE|LONDON|NY|OVERLAP/i.test(sessionName);

  // Asset-class-aware spread gate: uses the pair's gateSpreadMultiplier (FX 4×,
  // metals 6×, exotics 8×) instead of the previous universal Math.max(base*4, 3)
  // formula that conflated the trading gate with the data-quarantine cap.
  // (RC-6 / BUG-3.1)
  const maxAllowedSpreadPips = getGateMaxSpreadPips(symbol);
  const maxStopPips = atrPips > 0 ? Math.max(15, atrPips * 1.5) : 50;

  const entryZone = deriveEntryZone(zones, direction, atrPrice, latestCandle?.c, input.signalZone);

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
    blockedData,
    setupFamily: input.setupFamily ?? "zone_reversal",
    strategyId: input.strategyId,
    familyId: input.familyId,
    signalSource: input.signalSource,
    evaluationEnvironment: input.evaluationEnvironment,
    strategySpecVersion: input.strategySpecVersion,
    signalContextHash: input.signalContextHash,
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
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<EvaluationContext["latestCandle"]> {
  try {
    const candle = await getLatestCandle(pool, symbol, tf, asOf);
    if (!candle) return null;
    return {
      ts: candle.ts,
      o: candle.o,
      h: candle.h,
      l: candle.l,
      c: candle.c,
      v: candle.v,
    };
  } catch (err) {
    console.warn(`[setupEngine] Failed to fetch candle for ${symbol} ${tf}:`, (err as Error).message);
    return null;
  }
}

async function fetchBias(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<BiasFeature | null> {
  try {
    const { rows } = await pool.query(
      `SELECT direction, confidence, reason FROM features_bias
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) throw new Error(`BLOCKED_DATA:FEATURE_LINEAGE_MISSING:${symbol}:${tf}:features_bias`);
    const row = rows[0];
    return {
      direction: biasToSetup(row.direction),
      confidence: Number(row.confidence) || 0,
      reason: row.reason,
      strength: inferStrength(Number(row.confidence)),
    };
  } catch (err) {
    throw err;
  }
}

async function fetchHtfBias(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<EvaluationContext["htfBias"]> {
  try {
    const { rows } = await pool.query(
      `SELECT direction, confidence, state, score, reason,
              by_time_frame, trading_tf, local_agreement
       FROM features_htf_bias
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC
       LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) throw new Error(`BLOCKED_DATA:FEATURE_LINEAGE_MISSING:${symbol}:${tf}:features_htf_bias`);
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
      localAgreement: row.local_agreement != null ? Number(row.local_agreement) : undefined,
    };
  } catch (err) {
    throw err;
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
  pool: Queryable,
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
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) throw new Error(`BLOCKED_DATA:FEATURE_LINEAGE_MISSING:${symbol}:${tf}:features_pricing`);
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
    throw err;
  }
}

async function fetchZones(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<ZoneFeature[]> {
  try {
    const maxAgeDays = getLevelMaxAgeDays("zone", tf);
    const { rows } = await pool.query(
      `SELECT zone_kind, direction, top, bottom, fill_pct, tapped,
              first_touch_at, mitigated_at, invalidated_at, touch_count, retest_count
       FROM public.canonical_zones_as_of($1, $2, $3, make_interval(days => $4))
       WHERE (mitigated_at IS NULL OR mitigated_at > $3)
       ORDER BY ts DESC
       LIMIT 50`,
      [symbol, tf, asOf, maxAgeDays ?? 30]
    );
    return rows.map((r) => ({
      id: `${r.zone_kind}-${r.direction ?? ""}-${r.top}-${r.bottom}`,
      type: r.zone_kind,
      top: Number(r.top),
      bottom: Number(r.bottom),
      fillPct: r.fill_pct != null ? Number(r.fill_pct) : 0,
      tapped: r.tapped === true,
      direction: r.direction ? biasToSetup(r.direction) : zoneKindToDirection(r.zone_kind),
      firstTouchAt: r.first_touch_at ?? null,
      mitigatedAt: r.mitigated_at ?? null,
      invalidatedAt: r.invalidated_at ?? null,
      touchCount: r.touch_count ?? 0,
      retestCount: r.retest_count ?? 0,
    }));
  } catch (err) {
    throw err instanceof Error && err.message.startsWith("BLOCKED_DATA:")
      ? err
      : new Error(`BLOCKED_DATA:FEATURES_UNTRUSTED:${symbol}:${tf}:features_zone`);
  }
}

async function fetchStructure(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<StructureFeature[]> {
  try {
    const { rows } = await pool.query(
      `SELECT event_type, direction, level, ts
       FROM features_structure
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
         AND lineage_state = 'trusted_current'
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
    throw err instanceof Error && err.message.startsWith("BLOCKED_DATA:")
      ? err
      : new Error(`BLOCKED_DATA:FEATURES_UNTRUSTED:${symbol}:${tf}:features_structure`);
  }
}

async function fetchAtr(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<{ value: number; period: number } | null> {
  try {
    const { rows } = await pool.query(
      `SELECT value, period FROM features_atr
       WHERE symbol = $1 AND tf = $2 AND ts <= $3
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC, period DESC
       LIMIT 1`,
      [symbol, tf, asOf]
    );
    if (!rows.length) throw new Error(`BLOCKED_DATA:FEATURE_LINEAGE_MISSING:${symbol}:${tf}:features_atr`);
    return { value: Number(rows[0].value), period: Number(rows[0].period) };
  } catch (err) {
    throw err;
  }
}

async function fetchSpread(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<{ spread: number } | null> {
  try {
    // features_spread is a 1m feature: the producer averages 1m candles
    // regardless of the requested tf, and only @1m rows are produced
    // continuously (liveRunner requires features_spread@1m freshness). Reading
    // the strategy tf here served weeks-stale one-off rows (V4 live-rejection
    // fix), so always read the latest 1m row as of the anchor.
    const { rows } = await pool.query(
      `SELECT spread FROM features_spread
       WHERE symbol = $1 AND tf = '1m' AND ts <= $2
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC
       LIMIT 1`,
      [symbol, asOf]
    );
    if (!rows.length) return null;
    const raw = Number(rows[0].spread);
    const cap = getPairCharacteristics(symbol).baseSpreadPips * SPREAD_SANITY_MULTIPLIER;
    if (Number.isFinite(raw) && raw > cap) {
      console.warn(`[setupEngine] Quarantined extreme spread for ${symbol}@${tf}: ${raw.toFixed(2)}p capped to ${cap.toFixed(2)}p`);
    }
    return { spread: Number.isFinite(raw) && raw > 0 ? Math.min(raw, cap) : cap };
  } catch (err) {
    console.warn("[setupEngine] Failed to fetch spread:", (err as Error).message);
    return null;
  }
}

async function fetchSession(
  pool: Queryable,
  symbol: string,
  asOf: Date
): Promise<{ session: string } | null> {
  try {
    const { rows } = await pool.query(
      `SELECT session FROM features_session
       WHERE symbol = $1 AND ts <= $2
         AND lineage_state = 'trusted_current'
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

async function fetchActivePositionCount(pool: Queryable, symbol: string): Promise<number> {
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

/**
 * Extended zone input carrying the compiler-pre-validated zone for the current
 * signal. Used to bypass the ATR-distance guard when the signal fired on a
 * wick retest and the closing price is farther from the zone than 1.5 ATR.
 */
export interface SignalZone {
  top: number;
  bottom: number;
  zoneKind?: string;
}

function deriveEntryZone(
  zones: ZoneFeature[],
  direction: SetupDirection,
  atr: number,
  price?: number,
  signalZone?: SignalZone | null
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

  if (!nearCandidates.length) {
    // No zone within ATR distance. If the signal compiler already identified
    // a zone via LATERAL join (retest strategies, e.g. lewis_kelly), use it
    // directly. The compiler validated direction/lifecycle at signal time.
    if (signalZone && aligned.length > 0) {
      const matched = aligned.find(
        (z) =>
          Math.abs(z.top - signalZone.top) < 0.000001 &&
          Math.abs(z.bottom - signalZone.bottom) < 0.000001
      );
      if (matched) {
        return {
          top: matched.top,
          bottom: matched.bottom,
          zoneId: matched.id,
          zoneType: matched.type,
        };
      }
    }
    return null;
  }

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

// ---------------------------------------------------------------------------
// Batched context builder for backtests
// ---------------------------------------------------------------------------

const BATCH_FEATURE_LOOKBACK = "7 days";
const BATCH_ZONE_LIMIT = 50;
const BATCH_STRUCTURE_LIMIT = 20;

function asOfKey(d: Date): string {
  return d.toISOString();
}

function groupRowsByAsOf<T extends { as_of: Date }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = asOfKey(new Date(row.as_of));
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

async function batchFetchLatestCandles(
  pool: Queryable,
  symbol: string,
  _tf: TimeFrame,
  asOfs: Date[]
): Promise<Map<string, EvaluationContext["latestCandle"]>> {
  if (!asOfs.length) return new Map();
  // The setup engine only consumes the close price (latestCandle.c) to measure
  // entry-zone distance and volatility regime. The dense candles_1m series is
  // the canonical point-in-time price source: it is always populated (unlike the
  // sparse HTF candle tables) and its close at-or-before asOf IS the current
  // price. This mirrors getLatestCandle's 1m rollup fallback but in one batched,
  // PIT-bounded query per (symbol, tf) group.
  const { rows } = await pool.query(
    `WITH buckets AS (SELECT UNNEST($1::timestamptz[]) AS as_of)
     SELECT b.as_of, c.ts, c.o, c.h, c.l, c.c, c.v
     FROM buckets b
     LEFT JOIN LATERAL (
       SELECT ts, o, h, l, c, v FROM market.candles_1m_canonical
       WHERE symbol = $2 AND ts <= b.as_of AND ts >= b.as_of - interval '${BATCH_FEATURE_LOOKBACK}'
       ORDER BY ts DESC LIMIT 1
     ) c ON true`,
    [asOfs, symbol]
  );
  const map = new Map<string, EvaluationContext["latestCandle"]>();
  for (const r of rows) {
    if (!r.ts) continue;
    map.set(asOfKey(new Date(r.as_of)), {
      ts: r.ts,
      o: Number(r.o),
      h: Number(r.h),
      l: Number(r.l),
      c: Number(r.c),
      v: r.v != null ? Number(r.v) : undefined,
    });
  }
  return map;
}

async function batchFetchBias(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOfs: Date[]
): Promise<Map<string, BiasFeature | null>> {
  if (!asOfs.length) return new Map();
  const { rows } = await pool.query(
    `WITH buckets AS (SELECT UNNEST($1::timestamptz[]) AS as_of)
     SELECT b.as_of, f.direction, f.confidence, f.reason
     FROM buckets b
     LEFT JOIN LATERAL (
       SELECT direction, confidence, reason FROM features_bias
       WHERE symbol = $2 AND tf = $3 AND ts <= b.as_of AND ts >= b.as_of - interval '${BATCH_FEATURE_LOOKBACK}'
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC LIMIT 1
     ) f ON true`,
    [asOfs, symbol, tf]
  );
  const map = new Map<string, BiasFeature | null>();
  for (const r of rows) {
    const key = asOfKey(new Date(r.as_of));
    if (!r.direction) {
      map.set(key, null);
      continue;
    }
    map.set(key, {
      direction: biasToSetup(r.direction),
      confidence: Number(r.confidence) || 0,
      reason: r.reason,
      strength: inferStrength(Number(r.confidence)),
    });
  }
  return map;
}

async function batchFetchHtfBias(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOfs: Date[]
): Promise<Map<string, EvaluationContext["htfBias"]>> {
  if (!asOfs.length) return new Map();
  const { rows } = await pool.query(
    `WITH buckets AS (SELECT UNNEST($1::timestamptz[]) AS as_of)
     SELECT b.as_of, f.direction, f.confidence, f.state, f.score, f.reason,
            f.by_time_frame, f.trading_tf, f.local_agreement
     FROM buckets b
     LEFT JOIN LATERAL (
       SELECT direction, confidence, state, score, reason,
              by_time_frame, trading_tf, local_agreement FROM features_htf_bias
       WHERE symbol = $2 AND tf = $3 AND ts <= b.as_of AND ts >= b.as_of - interval '${BATCH_FEATURE_LOOKBACK}'
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC LIMIT 1
     ) f ON true`,
    [asOfs, symbol, tf]
  );
  const map = new Map<string, EvaluationContext["htfBias"]>();
  for (const r of rows) {
    const key = asOfKey(new Date(r.as_of));
    if (!r.direction) {
      map.set(key, null);
      continue;
    }
    map.set(key, {
      direction: biasToSetup(r.direction),
      confidence: Number(r.confidence) || 0,
      state: r.state ?? "BLOCK",
      score: Number(r.score) || 0,
      reason: r.reason ?? "",
      strength: inferStrength(Number(r.confidence)),
      byTimeFrame: parseHtfTree(r.by_time_frame),
      tradingTf: r.trading_tf ?? tf,
      localAgreement: r.local_agreement != null ? Number(r.local_agreement) : undefined,
    });
  }
  return map;
}

async function batchFetchPricing(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOfs: Date[]
): Promise<Map<string, EvaluationContext["pricing"]>> {
  if (!asOfs.length) return new Map();
  const { rows } = await pool.query(
    `WITH buckets AS (SELECT UNNEST($1::timestamptz[]) AS as_of)
     SELECT b.as_of, f.position, f.in_ote, f.ote_low, f.ote_high,
            f.dynamic_ote_low, f.dynamic_ote_high, f.dynamic_ote_mid,
            f.dynamic_ote_source, f.dynamic_ote_quality, f.premium_discount_score
     FROM buckets b
     LEFT JOIN LATERAL (
       SELECT position, in_ote, ote_low, ote_high,
              dynamic_ote_low, dynamic_ote_high, dynamic_ote_mid,
              dynamic_ote_source, dynamic_ote_quality, premium_discount_score FROM features_pricing
       WHERE symbol = $2 AND tf = $3 AND ts <= b.as_of AND ts >= b.as_of - interval '${BATCH_FEATURE_LOOKBACK}'
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC LIMIT 1
     ) f ON true`,
    [asOfs, symbol, tf]
  );
  const map = new Map<string, EvaluationContext["pricing"]>();
  for (const r of rows) {
    const key = asOfKey(new Date(r.as_of));
    if (!r.position) {
      map.set(key, null);
      continue;
    }
    map.set(key, {
      position: r.position,
      inOte: r.in_ote === true,
      oteLow: r.ote_low != null ? Number(r.ote_low) : undefined,
      oteHigh: r.ote_high != null ? Number(r.ote_high) : undefined,
      dynamicOteLow: r.dynamic_ote_low != null ? Number(r.dynamic_ote_low) : undefined,
      dynamicOteHigh: r.dynamic_ote_high != null ? Number(r.dynamic_ote_high) : undefined,
      dynamicOteMid: r.dynamic_ote_mid != null ? Number(r.dynamic_ote_mid) : undefined,
      dynamicOteSource: r.dynamic_ote_source ?? undefined,
      dynamicOteQuality: r.dynamic_ote_quality != null ? Number(r.dynamic_ote_quality) : undefined,
      premiumDiscountScore: r.premium_discount_score != null ? Number(r.premium_discount_score) : undefined,
    });
  }
  return map;
}

async function batchFetchZones(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOfs: Date[]
): Promise<Map<string, ZoneFeature[]>> {
  if (!asOfs.length) return new Map();
  const maxAgeDays = getLevelMaxAgeDays("zone", tf);
  const { rows } = await pool.query(
    `WITH buckets AS (SELECT UNNEST($1::timestamptz[]) AS as_of)
     SELECT b.as_of, z.zone_kind, z.direction, z.top, z.bottom, z.fill_pct, z.tapped,
            z.first_touch_at, z.mitigated_at, z.invalidated_at, z.touch_count, z.retest_count
     FROM buckets b
     LEFT JOIN LATERAL (
       SELECT zone_kind, direction, top, bottom, fill_pct, tapped,
              first_touch_at, mitigated_at, invalidated_at, touch_count, retest_count
       FROM public.canonical_zones_as_of($2, $3, b.as_of, make_interval(days => $4))
       WHERE (mitigated_at IS NULL OR mitigated_at > b.as_of)
       ORDER BY ts DESC
       LIMIT ${BATCH_ZONE_LIMIT}
     ) z ON true`,
    [asOfs, symbol, tf, maxAgeDays ?? 30]
  );
  const grouped = groupRowsByAsOf(rows);
  const map = new Map<string, ZoneFeature[]>();
  for (const [key, group] of grouped) {
    map.set(
      key,
      group
        .filter((g: any) => g.zone_kind != null)
        .map((r: any) => ({
          id: `${r.zone_kind}-${r.direction ?? ""}-${r.top}-${r.bottom}`,
          type: r.zone_kind,
          top: Number(r.top),
          bottom: Number(r.bottom),
          fillPct: r.fill_pct != null ? Number(r.fill_pct) : 0,
          tapped: r.tapped === true,
          direction: r.direction ? biasToSetup(r.direction) : zoneKindToDirection(r.zone_kind),
          firstTouchAt: r.first_touch_at ?? null,
          mitigatedAt: r.mitigated_at ?? null,
          invalidatedAt: r.invalidated_at ?? null,
          touchCount: r.touch_count ?? 0,
          retestCount: r.retest_count ?? 0,
        }))
    );
  }
  return map;
}

async function batchFetchStructure(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOfs: Date[]
): Promise<Map<string, StructureFeature[]>> {
  if (!asOfs.length) return new Map();
  const { rows } = await pool.query(
    `WITH buckets AS (SELECT UNNEST($1::timestamptz[]) AS as_of)
     SELECT b.as_of, s.event_type, s.direction, s.level, s.ts
     FROM buckets b
     LEFT JOIN LATERAL (
       SELECT event_type, direction, level, ts FROM features_structure
       WHERE symbol = $2 AND tf = $3 AND ts <= b.as_of AND ts >= b.as_of - interval '${BATCH_FEATURE_LOOKBACK}'
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC
       LIMIT ${BATCH_STRUCTURE_LIMIT}
     ) s ON true`,
    [asOfs, symbol, tf]
  );
  const grouped = groupRowsByAsOf(rows);
  const map = new Map<string, StructureFeature[]>();
  for (const [key, group] of grouped) {
    map.set(
      key,
      group
        .filter((g: any) => g.event_type != null)
        .map((r: any) => ({
          eventType: r.event_type,
          direction: biasToSetup(r.direction),
          level: Number(r.level),
          ts: r.ts,
        }))
    );
  }
  return map;
}

async function batchFetchAtr(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOfs: Date[]
): Promise<Map<string, { value: number; period: number } | null>> {
  if (!asOfs.length) return new Map();
  const { rows } = await pool.query(
    `WITH buckets AS (SELECT UNNEST($1::timestamptz[]) AS as_of)
     SELECT b.as_of, a.value, a.period
     FROM buckets b
     LEFT JOIN LATERAL (
       SELECT value, period FROM features_atr
       WHERE symbol = $2 AND tf = $3 AND ts <= b.as_of AND ts >= b.as_of - interval '${BATCH_FEATURE_LOOKBACK}'
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC, period DESC LIMIT 1
     ) a ON true`,
    [asOfs, symbol, tf]
  );
  const map = new Map<string, { value: number; period: number } | null>();
  for (const r of rows) {
    const key = asOfKey(new Date(r.as_of));
    if (r.value == null) {
      map.set(key, null);
      continue;
    }
    map.set(key, { value: Number(r.value), period: Number(r.period) });
  }
  return map;
}

async function batchFetchSession(
  pool: Queryable,
  symbol: string,
  asOfs: Date[]
): Promise<Map<string, { session: string } | null>> {
  if (!asOfs.length) return new Map();
  const { rows } = await pool.query(
    `WITH buckets AS (SELECT UNNEST($1::timestamptz[]) AS as_of)
     SELECT b.as_of, s.session
     FROM buckets b
     LEFT JOIN LATERAL (
       SELECT session FROM features_session
       WHERE symbol = $2 AND ts <= b.as_of AND ts >= b.as_of - interval '${BATCH_FEATURE_LOOKBACK}'
         AND lineage_state = 'trusted_current'
       ORDER BY ts DESC LIMIT 1
     ) s ON true`,
    [asOfs, symbol]
  );
  const map = new Map<string, { session: string } | null>();
  for (const r of rows) {
    const key = asOfKey(new Date(r.as_of));
    map.set(key, r.session ? { session: r.session } : null);
  }
  return map;
}

export interface BuildContextBatchOptions {
  /** Per-input direction overrides. Same length as asOfs. Falls back to LTF bias when omitted. */
  directions?: SetupDirection[];
  /** Optional per-input minimum R:R. Same length as asOfs. */
  minRRs?: number[];
  /** Optional per-input setup family. Same length as asOfs. */
  setupFamilies?: EvaluationInput["setupFamily"][];
  strategyIds?: Array<string | undefined>;
  familyIds?: Array<string | undefined>;
  signalSources?: Array<EvaluationInput["signalSource"] | undefined>;
  /** Per-input compiler-identified signal zone. Same length as asOfs. */
  signalZones?: Array<EvaluationInput["signalZone"] | undefined>;
  /** Per-input environment (live/pit). Same length as asOfs. */
  evaluationEnvironments?: Array<EvaluationInput["evaluationEnvironment"] | undefined>;
  /** Per-input strategy spec version. Same length as asOfs. */
  strategySpecVersions?: Array<string | undefined>;
  /** Per-input PIT signal context hash. Same length as asOfs. */
  signalContextHashes?: Array<string | undefined>;
  /** Shared backtest overrides applied to every input. */
  backtest?: EvaluationInput["backtest"];
}

/**
 * Build setup-evaluation contexts for many as-of timestamps in a single pass
 * over the feature tables. This is the long-term fix for backtest setup-engine
 * performance: instead of ~9 queries per signal, it runs ~9 queries per
 * (symbol, tf) group and assigns the nearest as-of row per timestamp.
 */
export async function buildContextBatch(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOfs: Date[],
  opts: BuildContextBatchOptions = {}
): Promise<EvaluationContext[]> {
  const sym = symbol.toUpperCase();
  if (!asOfs.length) return [];

  const backtest = opts.backtest;
  const pair = getPairCharacteristics(sym);
  const useStaticSpread = backtest?.spreadPips != null;
  const useStaticSession = backtest?.sessionName != null;
  const staticPositionCount = backtest?.activePositionCount;

  const [candles, biasMap, htfMap, pricingMap, zonesMap, structureMap, atrMap, sessionMap] =
    await Promise.all([
      batchFetchLatestCandles(pool, sym, tf, asOfs),
      batchFetchBias(pool, sym, tf, asOfs),
      batchFetchHtfBias(pool, sym, tf, asOfs),
      batchFetchPricing(pool, sym, tf, asOfs),
      batchFetchZones(pool, sym, tf, asOfs),
      batchFetchStructure(pool, sym, tf, asOfs),
      batchFetchAtr(pool, sym, tf, asOfs),
      useStaticSession ? Promise.resolve(new Map()) : batchFetchSession(pool, sym, asOfs),
    ]);

  const contexts: EvaluationContext[] = [];
  for (let i = 0; i < asOfs.length; i++) {
    const asOf = asOfs[i];
    const key = asOfKey(asOf);
    const bias = biasMap.get(key) ?? null;
    const direction = opts.directions?.[i] ?? bias?.direction ?? "neutral";
    const latestCandle = candles.get(key) ?? null;
    const htfBias = htfMap.get(key) ?? null;
    const pricing = pricingMap.get(key) ?? null;
    const zones = zonesMap.get(key) ?? [];
    const structure = structureMap.get(key) ?? [];
    const atrRow = atrMap.get(key) ?? null;
    const sessionRow = useStaticSession ? { session: backtest!.sessionName! } : sessionMap.get(key) ?? null;

    const spreadPips = useStaticSpread ? backtest!.spreadPips! : pair.baseSpreadPips;
    const atrPrice = atrRow?.value ?? 0;
    const pipSize = getRegistryPipSize(sym);
    const atrPips = pipSize > 0 ? atrPrice / pipSize : 0;
    const volatilityRegime = classifyVolatility(atrPips, latestCandle?.c ?? 0, pair.volLowAtrPct, pair.volHighAtrPct);
    const sessionName = sessionRow?.session ?? "UNKNOWN";
    const sessionIsKillzone = /KILLZONE|LONDON|NY|OVERLAP/i.test(sessionName);
    const maxAllowedSpreadPips = getGateMaxSpreadPips(sym);
    const maxStopPips = atrPips > 0 ? Math.max(15, atrPips * 1.5) : 50;
    const entryZone = deriveEntryZone(zones, direction, atrPrice, latestCandle?.c, opts.signalZones?.[i]);

    const featuresUsed: string[] = [];
    if (bias) featuresUsed.push("features_bias");
    if (htfBias) featuresUsed.push("features_htf_bias");
    if (pricing) featuresUsed.push("features_pricing");
    if (zones.length) featuresUsed.push("features_zone");
    if (structure.length) featuresUsed.push("features_structure");
    if (atrRow) featuresUsed.push("features_atr");
    if (useStaticSpread) featuresUsed.push("features_spread");
    if (sessionRow) featuresUsed.push("features_session");

    contexts.push({
      pool,
      symbol: sym,
      tf,
      asOf,
      setupFamily: opts.setupFamilies?.[i] ?? "zone_reversal",
      strategyId: opts.strategyIds?.[i],
      familyId: opts.familyIds?.[i],
      signalSource: opts.signalSources?.[i],
      evaluationEnvironment: opts.evaluationEnvironments?.[i],
      strategySpecVersion: opts.strategySpecVersions?.[i],
      signalContextHash: opts.signalContextHashes?.[i],
      direction,
      minRR: opts.minRRs?.[i] ?? 2,
      latestCandle,
      bias,
      htfBias,
      pricing,
      zones,
      structure,
      pivots: [],
      atr: atrPrice,
      spreadPips,
      maxAllowedSpreadPips,
      maxStopPips,
      volatility: { regime: volatilityRegime, atrPips },
      sessionProfile: sessionRow ? { name: sessionName, killzone: sessionIsKillzone } : null,
      activePositionCount: staticPositionCount ?? 0,
      maxPositionsPerSymbol: 2,
      evidence: [],
      warnings: [],
      featuresUsed,
      entryZone,
    });
  }

  return contexts;
}
