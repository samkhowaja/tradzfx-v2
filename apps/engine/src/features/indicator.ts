/**
 * Technical Indicator feature.
 * Computes RSI, Stochastic, MACD, ADX, and OBV from raw candles.
 */

import type { Candle, FeatureDefinition, IndicatorOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface IndicatorInput {
  candles: Candle[];
}

function computeRSI(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;
  let gain = 0;
  let loss = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].c - candles[i - 1].c;
    if (change > 0) gain += change;
    else loss -= change;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeStochastic(candles: Candle[], kPeriod: number, dPeriod: number): { k: number; d: number } {
  if (candles.length < kPeriod + dPeriod) return { k: 50, d: 50 };
  const ks: number[] = [];
  for (let i = candles.length - kPeriod - dPeriod + 1; i <= candles.length - kPeriod; i++) {
    const slice = candles.slice(i, i + kPeriod);
    const highest = Math.max(...slice.map((c) => c.h));
    const lowest = Math.min(...slice.map((c) => c.l));
    const current = candles[i + kPeriod - 1].c;
    const k = highest !== lowest ? ((current - lowest) / (highest - lowest)) * 100 : 50;
    ks.push(k);
  }
  const k = ks[ks.length - 1];
  const d = ks.reduce((a, b) => a + b, 0) / ks.length;
  return { k, d };
}

function computeEMA(arr: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = arr[0];
  for (let i = 1; i < arr.length; i++) {
    ema = arr[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeMACD(
  candles: Candle[],
  fast: number,
  slow: number,
  signal: number
): { line: number; signal: number; histogram: number } {
  const closes = candles.map((c) => c.c);
  if (closes.length < slow) return { line: 0, signal: 0, histogram: 0 };
  const fastEma = computeEMA(closes, fast);
  const slowEma = computeEMA(closes, slow);
  const line = fastEma - slowEma;

  // Build MACD history for signal EMA
  const macdHistory: number[] = [];
  for (let i = slow; i <= closes.length; i++) {
    const f = computeEMA(closes.slice(0, i), fast);
    const s = computeEMA(closes.slice(0, i), slow);
    macdHistory.push(f - s);
  }
  const signalLine = macdHistory.length >= signal ? computeEMA(macdHistory, signal) : line;
  return { line, signal: signalLine, histogram: line - signalLine };
}

function computeADX(
  candles: Candle[],
  period: number
): { adx: number; plusDI: number; minusDI: number } {
  if (candles.length < period * 2 + 1) return { adx: 0, plusDI: 0, minusDI: 0 };
  let trSum = 0;
  let plusDMSum = 0;
  let minusDMSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(curr.h - curr.l, Math.abs(curr.h - prev.c), Math.abs(curr.l - prev.c));
    const plusDM = curr.h - prev.h > prev.l - curr.l ? Math.max(curr.h - prev.h, 0) : 0;
    const minusDM = prev.l - curr.l > curr.h - prev.h ? Math.max(prev.l - curr.l, 0) : 0;
    trSum += tr;
    plusDMSum += plusDM;
    minusDMSum += minusDM;
  }
  const plusDI = trSum > 0 ? (plusDMSum / trSum) * 100 : 0;
  const minusDI = trSum > 0 ? (minusDMSum / trSum) * 100 : 0;
  const dx = plusDI + minusDI > 0 ? (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100 : 0;
  return { adx: dx, plusDI, minusDI };
}

function computeOBV(candles: Candle[]): number {
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].v ?? 0;
    if (candles[i].c > candles[i - 1].c) obv += vol;
    else if (candles[i].c < candles[i - 1].c) obv -= vol;
  }
  return obv;
}

export const indicatorFeature: FeatureDefinition<IndicatorInput, IndicatorOutput> = {
  name: "features_indicator",
  version: "1.1.0",
  dependencies: [],

  compute(input): IndicatorOutput {
    const { candles } = input;
    const values: IndicatorOutput["values"] = [];

    if (candles.length >= 15) {
      values.push({ indicatorName: "rsi", period: 14, value: computeRSI(candles, 14) });
    }
    if (candles.length >= 21) {
      values.push({ indicatorName: "rsi", period: 20, value: computeRSI(candles, 20) });
    }
    if (candles.length >= 17) {
      const stoch = computeStochastic(candles, 14, 3);
      values.push({
        indicatorName: "stochastic_k",
        period: 14,
        value: stoch.k,
        paramsJson: { dPeriod: 3 },
      });
      values.push({ indicatorName: "stochastic_d", period: 3, value: stoch.d });
    }
    if (candles.length >= 35) {
      const macd = computeMACD(candles, 12, 26, 9);
      values.push({
        indicatorName: "macd_line",
        period: 12,
        value: macd.line,
        paramsJson: { slow: 26, signal: 9 },
      });
      values.push({ indicatorName: "macd_signal", period: 9, value: macd.signal });
      values.push({ indicatorName: "macd_histogram", period: 0, value: macd.histogram });
    }
    if (candles.length >= 29) {
      const adx = computeADX(candles, 14);
      values.push({ indicatorName: "adx", period: 14, value: adx.adx });
      values.push({ indicatorName: "adx_plus_di", period: 14, value: adx.plusDI });
      values.push({ indicatorName: "adx_minus_di", period: 14, value: adx.minusDI });
    }
    if (candles.length >= 2 && candles[0].v !== undefined) {
      values.push({ indicatorName: "obv", period: 0, value: computeOBV(candles) });
    }

    return { values };
  },

  hashInput(input): string {
    return sha256(
      input.candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}:${c.v ?? 0}`).join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.values.map((v) => `${v.indicatorName}:${v.period}=${v.value.toFixed(6)}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.values.map((v) => ({
      indicator_name: v.indicatorName,
      period: v.period,
      value: v.value,
      params_json: v.paramsJson ?? {},
    }));
  },

  deserialize(rows): IndicatorOutput {
    return {
      values: rows.map((r) => ({
        indicatorName: r.indicator_name as string,
        period: r.period as number,
        value: r.value as number,
        paramsJson: (r.params_json as Record<string, unknown>) ?? {},
      })),
    };
  },
};
