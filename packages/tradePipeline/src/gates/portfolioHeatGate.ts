/**
 * Correlation-aware Portfolio Heat Gate (v2).
 * 
 * Replaces raw position-count caps with correlation-weighted effective heat:
 *   effective_heat = Σ (positionSize * correlationWeight)
 * 
 * Two symbols with ρ=0.9 count almost double; two with ρ=0.15 barely count.
 * Prevents over-concentration in correlated pairs while allowing uncorrelated
 * diversification. (Audit item #7)
 */

import type { MarketContext, Pool } from "@tm/shared";

export interface PortfolioHeatConfig {
  /** Max effective heat before gate blocks. Default 3.0 (≈3 uncorrelated positions). */
  maxEffectiveHeat?: number;
  /** Lookback TFs for correlation query. Lower tf = faster reaction. */
  correlationTf?: "1h" | "4h" | "1d";
  /** Column name in features_correlation for the chosen TF. */
  correlationColumn?: string;
  /** Legacy: ignored when correlation data available. */
  maxConcurrentPerSymbol?: number;
  /** Legacy: ignored when correlation data available. */
  maxConcurrentTotal?: number;
}

const DEFAULT_CONFIG: Required<PortfolioHeatConfig> = {
  maxEffectiveHeat: 3.0,
  correlationTf: "1h",
  correlationColumn: "correlation1h",
  maxConcurrentPerSymbol: 3,
  maxConcurrentTotal: 6,
};

const TF_TO_COLUMN: Record<string, string> = {
  "1h": "correlation1h",
  "4h": "correlation4h",
  "1d": "correlation1d",
};

/**
 * Cache: (symbolA, symbolB) → { value, expiresAt }.
 * TTL prevents a transient DB error from poisoning the cache forever:
 * a failed query stores 0 for the rest of the pipeline tick, but on the
 * *next* tick the entry is evicted and the query is re-attempted.
 * The upstream caller (pipelineTrigger) already hoists pool creation
 * per tick, so the TTL clock resets naturally between ticks.
 */
interface CacheEntry {
  value: number;
  expiresAt: number;
}

const corrCache = new Map<string, CacheEntry>();
const CORR_CACHE_TTL_MS = 300_000; // 5 min — well below a pipeline tick's lifetime

function cacheKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

async function queryCorrelation(
  pool: Pool,
  symbolA: string,
  symbolB: string,
  column: string
): Promise<number | null> {
  const key = cacheKey(symbolA, symbolB);
  const cached = corrCache.get(key);
  if (cached !== undefined && Date.now() < cached.expiresAt) return cached.value;

  try {
    const { rows } = await pool.query(
      `SELECT ${column} AS corr
       FROM features_correlation
       WHERE symbol = $1 AND reference_symbol = $2
         AND ts = (SELECT MAX(ts) FROM features_correlation WHERE symbol = $1)
       LIMIT 1`,
      [symbolA, symbolB]
    );
    const val = rows.length > 0 ? (rows[0].corr as number) : null;
    corrCache.set(key, { value: val ?? 0, expiresAt: Date.now() + CORR_CACHE_TTL_MS });
    return val;
  } catch {
    return null; // table may not exist
  }
}

export function createPortfolioHeatGate(config?: PortfolioHeatConfig) {
  const cfg: Required<PortfolioHeatConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
    correlationColumn: TF_TO_COLUMN[config?.correlationTf ?? "1h"],
  };

  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const active = ctx.activeOrders ?? [];
    if (active.length === 0) return { passed: true };

    // Legacy fallback when no pool in context — use count-based caps
    const pool = (ctx as any).pool as Pool | undefined;
    if (!pool) {
      const symbolActive = active.filter((o) => o.symbol === ctx.symbol).length;
      if (symbolActive >= cfg.maxConcurrentPerSymbol) {
        return {
          passed: false,
          reason: `${symbolActive} active on ${ctx.symbol} > ${cfg.maxConcurrentPerSymbol} (no corr data)`,
        };
      }
      if (active.length >= cfg.maxConcurrentTotal) {
        return {
          passed: false,
          reason: `${active.length} total > ${cfg.maxConcurrentTotal} (no corr data)`,
        };
      }
      return { passed: true };
    }

    // Group active orders by symbol
    const symbolCounts = new Map<string, number>();
    for (const order of active) {
      symbolCounts.set(order.symbol, (symbolCounts.get(order.symbol) ?? 0) + 1);
    }

    const targetSymbol = ctx.symbol;
    let effectiveHeat = 0;

    // Self-contribution: each position in the target symbol counts as full unit (ρ=1)
    effectiveHeat += symbolCounts.get(targetSymbol) ?? 0;

    // Cross-symbol: weight = correlation coefficient (clamped to [0, 1])
    for (const [sym, count] of symbolCounts) {
      if (sym === targetSymbol) continue;
      const corr = await queryCorrelation(pool, targetSymbol, sym, cfg.correlationColumn);
      const weight = corr !== null ? Math.max(0, Math.min(1, corr)) : 0;
      effectiveHeat += count * weight;
    }

    if (effectiveHeat > cfg.maxEffectiveHeat) {
      return {
        passed: false,
        reason: `Effective heat ${effectiveHeat.toFixed(2)} > ${cfg.maxEffectiveHeat} ` +
          `(${active.length} orders across ${symbolCounts.size} symbols)`,
      };
    }

    return { passed: true };
  };
}

/** Call at start of each pipeline tick to clear per-tick correlation cache. */
export function clearCorrelationCache(): void {
  corrCache.clear();
}

