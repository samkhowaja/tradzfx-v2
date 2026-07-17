/**
 * Position Monitor.
 * Server-side fallback for tracking open positions.
 * - Detects timeout-based closes (max hold time exceeded)
 * - Detects SL/TP hits using latest candle prices (paper mode fallback)
 * - Detects stale filled orders (EA missed reporting close)
 *
 * Paper close detection now accounts for:
 *   - gap opens (if the 1m open is beyond SL/TP, it is used as the fill)
 *   - broker spread from features_spread
 *   - an ATR-based slippage estimate
 *   - pip value per lot derived from the current price and account currency
 */

import { getPool, getRegistryPipSize, getPipValuePerLotForSymbol } from "@tm/shared";
import { markOrderClosed } from "./orderService";

export interface MonitorOptions {
  /** Max minutes an order can stay 'filled' without a close report before marked STALE */
  maxStaleMinutes?: number;
  /** Paper mode: check SL/TP against latest candle prices */
  enablePaperCloseDetection?: boolean;
  /** Account currency used for pip-value calculations. */
  accountCurrency?: string;
  /** ATR fraction used as a slippage estimate (default 5%). */
  slippageAtrFraction?: number;
}

export interface MonitorResult {
  checked: number;
  timedOut: number;
  slHit: number;
  tpHit: number;
  stale: number;
}

interface MarketData {
  o: number;
  h: number;
  l: number;
  c: number;
  ts: Date;
  spreadPips: number | null;
  atr: number | null;
}

/**
 * Fetch the latest 1m candle plus spread/ATR for each symbol.
 */
async function fetchLatestMarketData(
  pool: ReturnType<typeof getPool>,
  symbols: string[]
): Promise<Map<string, MarketData>> {
  const map = new Map<string, MarketData>();
  if (symbols.length === 0) return map;

  const { rows: candles } = await pool.query(
    `SELECT DISTINCT ON (symbol) symbol, o, h, l, c, ts
     FROM market.candles_1m_canonical
     WHERE symbol = ANY($1)
     ORDER BY symbol, ts DESC`,
    [symbols]
  );

  const { rows: spreads } = await pool.query(
    `SELECT DISTINCT ON (symbol) symbol, spread
     FROM features_spread
     WHERE symbol = ANY($1) AND tf = '1m'
     ORDER BY symbol, ts DESC`,
    [symbols]
  );

  const { rows: atrs } = await pool.query(
    `SELECT DISTINCT ON (symbol) symbol, value
     FROM features_atr
     WHERE symbol = ANY($1) AND tf = '1m'
     ORDER BY symbol, ts DESC`,
    [symbols]
  );

  const spreadBySymbol = new Map<string, number | null>();
  for (const r of spreads) spreadBySymbol.set(r.symbol, r.spread == null ? null : parseFloat(r.spread));

  const atrBySymbol = new Map<string, number | null>();
  for (const r of atrs) atrBySymbol.set(r.symbol, r.value == null ? null : parseFloat(r.value));

  for (const r of candles) {
    map.set(r.symbol, {
      o: parseFloat(r.o),
      h: parseFloat(r.h),
      l: parseFloat(r.l),
      c: parseFloat(r.c),
      ts: r.ts,
      spreadPips: spreadBySymbol.get(r.symbol) ?? null,
      atr: atrBySymbol.get(r.symbol) ?? null,
    });
  }

  return map;
}

/**
 * Check all open (filled) orders and close any that:
 * 1. Exceeded max hold time
 * 2. Hit SL/TP (paper mode only — uses latest candle prices with spread + slippage)
 * 3. Are stale (EA never reported back)
 */
export async function monitorPositions(
  opts: MonitorOptions = {}
): Promise<MonitorResult> {
  const pool = getPool();
  const {
    maxStaleMinutes = 240,
    enablePaperCloseDetection = true,
    accountCurrency = "USD",
    slippageAtrFraction = 0.05,
  } = opts;

  const result: MonitorResult = { checked: 0, timedOut: 0, slHit: 0, tpHit: 0, stale: 0 };

  const { rows: openOrders } = await pool.query(
    `SELECT id, symbol, side, entry_price, stop_loss, take_profit, fill_price, filled_at, trade_mode
     FROM orders
     WHERE status = 'filled'
       AND closed_at IS NULL`
  );

  result.checked = openOrders.length;
  if (openOrders.length === 0) return result;

  const symbols = [...new Set(openOrders.map((o) => o.symbol as string))];
  const marketData = await fetchLatestMarketData(pool, symbols);

  const now = Date.now();

  for (const order of openOrders) {
    const filledAt = order.filled_at ? new Date(order.filled_at).getTime() : 0;
    const minutesOpen = (now - filledAt) / 60000;

    if (minutesOpen > maxStaleMinutes) {
      const { success } = await markOrderClosed(
        order.id,
        parseFloat(order.fill_price ?? order.entry_price),
        "MANUAL",
        0
      );
      if (success) {
        result.stale++;
      }
      continue;
    }

    if (!enablePaperCloseDetection || order.trade_mode !== "paper") continue;

    const md = marketData.get(order.symbol);
    if (!md) continue;

    const sl = parseFloat(order.stop_loss);
    const tp = parseFloat(order.take_profit);
    const pipSize = getRegistryPipSize(order.symbol);
    const spreadPrice = (md.spreadPips ?? 0) * pipSize;
    const slippagePrice = (md.atr ?? 0) * slippageAtrFraction;
    const halfSpread = spreadPrice / 2;

    const isBuy = order.side === "buy";
    let closePrice: number | null = null;
    let outcome: string | null = null;

    if (isBuy) {
      const worstPrice = Math.min(md.o, md.l);
      if (worstPrice <= sl) {
        closePrice = Math.min(sl, worstPrice) - halfSpread - slippagePrice;
        outcome = "SL_HIT";
      } else {
        const bestPrice = Math.max(md.o, md.h);
        if (bestPrice >= tp) {
          closePrice = Math.max(tp, bestPrice) - halfSpread - slippagePrice;
          outcome = "TP_HIT";
        }
      }
    } else {
      // sell
      const worstPrice = Math.max(md.o, md.h);
      if (worstPrice >= sl) {
        closePrice = Math.max(sl, worstPrice) + halfSpread + slippagePrice;
        outcome = "SL_HIT";
      } else {
        const bestPrice = Math.min(md.o, md.l);
        if (bestPrice <= tp) {
          closePrice = Math.min(tp, bestPrice) + halfSpread + slippagePrice;
          outcome = "TP_HIT";
        }
      }
    }

    if (closePrice != null && outcome != null) {
      const realizedPnl = computePaperPnl(order, closePrice, md.c, accountCurrency);
      const { success } = await markOrderClosed(order.id, closePrice, outcome, realizedPnl);
      if (success) {
        if (outcome === "SL_HIT") result.slHit++;
        else result.tpHit++;
      }
    }
  }

  return result;
}

function computePaperPnl(order: any, closePrice: number, referencePrice: number, accountCurrency: string): number {
  const entry = parseFloat(order.fill_price ?? order.entry_price);
  const lotSize = parseFloat(order.lot_size ?? 0.01);
  const direction = order.side === "buy" ? 1 : -1;
  const priceMove = (closePrice - entry) * direction;

  const pipSize = getRegistryPipSize(order.symbol);
  const pipValuePerLot = getPipValuePerLotForSymbol(order.symbol, undefined, referencePrice, accountCurrency);
  const pips = pipSize > 0 ? priceMove / pipSize : 0;
  return parseFloat((pips * pipValuePerLot * lotSize).toFixed(2));
}
