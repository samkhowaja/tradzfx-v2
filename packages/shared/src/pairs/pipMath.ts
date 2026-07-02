/**
 * Symbol-aware pip/point math.
 *
 * MT5 reports spread as integer "points" (the smallest price increment).
 * For a 5-digit broker, 1 pip = 10 points. For a 3-digit JPY pair, 1 pip = 10 points.
 * For XAUUSD (typically 2 digits), 1 pip = 10 points (i.e. $0.10).
 *
 * This module centralizes conversions so the analyzer and live pipeline agree.
 */

export interface PipInfo {
  digits: number;
  pointSize: number; // smallest price increment, e.g. 0.00001 for 5-digit EURUSD
  pipSize: number;   // 10 points for FX, commodities, indices
  pipValuePerLot: number; // approximate USD value per pip for 1.0 lot
}

/**
 * Derive the number of decimal digits from a point size or broker digits value.
 */
export function getDigitsFromPointSize(pointSize: number): number {
  if (pointSize <= 0 || !Number.isFinite(pointSize)) return 5;
  return Math.max(0, -Math.log10(pointSize));
}

/**
 * Compute point size from broker digits.
 * digits=5 → 0.00001, digits=3 → 0.001, digits=2 → 0.01
 */
export function getPointSize(digits: number): number {
  return Math.pow(10, -Math.max(0, digits));
}

/**
 * Pip size is always 10 points for standard FX/commodity/CFD quoting.
 * This matches the industry convention used by MT5.
 */
export function getPipSize(digits: number): number {
  return getPointSize(digits) * 10;
}

/**
 * Convert MT5 spread points to pips.
 * spreadPoints is the integer from MqlRates.spread.
 */
export function pointsToPips(spreadPoints: number, digits: number): number {
  if (!Number.isFinite(spreadPoints)) return 0;
  const pointSize = getPointSize(digits);
  const pipSize = getPipSize(digits);
  return (spreadPoints * pointSize) / pipSize;
}

/**
 * Convert a price distance to pips.
 */
export function priceToPips(distance: number, digits: number): number {
  const pipSize = getPipSize(digits);
  return pipSize > 0 ? distance / pipSize : 0;
}

/**
 * Convert pips to price distance.
 */
export function pipsToPrice(pips: number, digits: number): number {
  return pips * getPipSize(digits);
}

const STANDARD_FX_LOT = 100000;
const STANDARD_XAU_LOT = 100; // ounces
const STANDARD_CRYPTO_LOT = 1;

function getBaseQuote(symbol: string): { base: string; quote: string } | null {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Standard 6-character FX pairs: EURUSD
  if (/^[A-Z]{6}$/.test(s)) {
    return { base: s.slice(0, 3), quote: s.slice(3, 6) };
  }
  // XAUUSD, XAUEUR, XAGUSD, etc.
  if (/^(XAU|XAG)[A-Z]{3}$/.test(s)) {
    return { base: s.slice(0, 3), quote: s.slice(3, 6) };
  }
  return null;
}

function getStandardContractSize(symbol: string): number | null {
  const s = symbol.toUpperCase();
  if (s.includes("XAU") || s.includes("GOLD") || s.includes("XAG")) return STANDARD_XAU_LOT;
  if (/^(BTC|ETH)/i.test(s)) return STANDARD_CRYPTO_LOT;
  // Indices have broker-specific contract sizes; fall back to hardcoded value.
  if (/^(NAS100|NDX|US30|DJI|DE40|DAX|UK100|FTSE)/i.test(s)) return null;
  if (/^[A-Z]{6}$/.test(s.replace(/[^A-Z]/g, ""))) return STANDARD_FX_LOT;
  return null;
}

/**
 * Compute pip value per lot from a current price and account currency.
 * Falls back to symbol-specific hardcoded estimates when contract size is unknown.
 */
export function computePipValuePerLot(
  symbol: string,
  price: number,
  accountCurrency = "USD"
): number {
  const info = getPipInfo(symbol);
  const pair = getBaseQuote(symbol);
  const contractSize = getStandardContractSize(symbol);

  if (!pair || !contractSize || !Number.isFinite(price) || price <= 0) {
    return info.pipValuePerLot;
  }

  const pipValueInQuote = info.pipSize * contractSize;
  const { base, quote } = pair;

  if (quote === accountCurrency) {
    return pipValueInQuote;
  }
  if (base === accountCurrency) {
    // e.g. USDJPY with USD account: pip value = JPY/value / price
    return pipValueInQuote / price;
  }

  // Cross pair without conversion data: keep hardcoded estimate.
  return info.pipValuePerLot;
}

/**
 * Best-effort pip info for a symbol.
 * Uses explicit symbol classification when digits are unknown.
 * If `price` and `accountCurrency` are supplied, pipValuePerLot is computed from
 * the current market price instead of hardcoded assumptions.
 */
export function getPipInfo(
  symbol: string,
  digits?: number,
  price?: number,
  accountCurrency?: string
): PipInfo {
  const s = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  let resolvedDigits = digits;

  if (resolvedDigits == null) {
    if (s.includes("JPY") || s.includes("XAU") || s.includes("GOLD")) {
      resolvedDigits = 3;
    } else if (/^(NAS100|NDX|US30|DJI|DE40|DAX|UK100|FTSE)/i.test(s)) {
      resolvedDigits = 1;
    } else if (/^(BTC|ETH)/i.test(s)) {
      resolvedDigits = 2;
    } else {
      resolvedDigits = 5;
    }
  }

  const pointSize = getPointSize(resolvedDigits);
  const pipSize = getPipSize(resolvedDigits);

  // Approximate USD pip value per 1.0 lot.
  // Standard contract sizes: FX 100k, XAU 100 oz, indices vary.
  let pipValuePerLot = 10.0;
  if (s.includes("JPY")) pipValuePerLot = 10.0;
  else if (s.includes("XAU") || s.includes("GOLD")) pipValuePerLot = 1.0;
  else if (/^(NAS100|NDX)/i.test(s)) pipValuePerLot = 100.0;
  else if (/^(US30|DJI)/i.test(s)) pipValuePerLot = 10.0;
  else if (/^(DE40|DAX|UK100|FTSE)/i.test(s)) pipValuePerLot = 10.0;

  if (price != null && accountCurrency != null) {
    pipValuePerLot = computePipValuePerLot(symbol, price, accountCurrency);
  }

  return {
    digits: resolvedDigits,
    pointSize,
    pipSize,
    pipValuePerLot,
  };
}

/**
 * Backward-compatible wrapper for code that still calls getPipSize(symbol).
 */
export function getPipSizeForSymbol(symbol: string, digits?: number): number {
  return getPipInfo(symbol, digits).pipSize;
}

/**
 * Backward-compatible wrapper for pip value per lot.
 */
export function getPipValuePerLotForSymbol(
  symbol: string,
  digits?: number,
  price?: number,
  accountCurrency?: string
): number {
  return getPipInfo(symbol, digits, price, accountCurrency).pipValuePerLot;
}
