import type { BacktestTrade } from "./runBacktest";

export interface MonteCarloOptions {
  /** Number of simulated equity curves to generate. Default 10,000. */
  iterations?: number;
  /** Confidence level for intervals, e.g. 0.95. */
  confidence?: number;
  /** Optional block size for circular bootstrap (default 1 = independent reshuffle). */
  blockSize?: number;
  /** Starting equity in R (default 0). */
  startingEquity?: number;
}

export interface MonteCarloResult {
  iterations: number;
  confidence: number;
  /** Final equity distribution percentiles */
  finalEquity: {
    median: number;
    lower: number;
    upper: number;
    mean: number;
    stdDev: number;
  };
  /** Max drawdown distribution percentiles (positive numbers) */
  maxDrawdown: {
    median: number;
    lower: number;
    upper: number;
    mean: number;
    worst: number;
  };
  /** Probability of being profitable at the end */
  probProfit: number;
  /** Probability of reaching a new equity high at any point */
  probNewHigh: number;
  /** Average simulated equity curve */
  averageCurve: number[];
  /** Lower percentile curve */
  lowerCurve: number[];
  /** Upper percentile curve */
  upperCurve: number[];
}

function computeDrawdown(equity: number[]): { maxDrawdown: number; maxDrawdownPct: number } {
  let peak = -Infinity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const eq of equity) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      if (peak !== 0) {
        maxDrawdownPct = (dd / Math.abs(peak)) * 100;
      }
    }
  }
  return { maxDrawdown, maxDrawdownPct };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function shuffle<T>(array: T[]): T[] {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function blockBootstrap(rs: number[], blockSize: number): number[] {
  if (blockSize <= 1 || rs.length <= blockSize) return shuffle(rs);
  const result: number[] = [];
  while (result.length < rs.length) {
    const start = Math.floor(Math.random() * (rs.length - blockSize + 1));
    for (let i = 0; i < blockSize && result.length < rs.length; i++) {
      result.push(rs[start + i]);
    }
  }
  return result;
}

/**
 * Run a Monte Carlo simulation on completed backtest trades.
 * Reshuffles the sequence of R returns to estimate the distribution of
 * possible equity curves and drawdowns, helping to assess robustness and
 * sequence risk.
 */
export function runMonteCarlo(
  trades: BacktestTrade[],
  options: MonteCarloOptions = {}
): MonteCarloResult {
  const {
    iterations = 10_000,
    confidence = 0.95,
    blockSize = 1,
    startingEquity = 0,
  } = options;

  const completed = trades.filter((t) => t.outcome === "win" || t.outcome === "loss");
  const rs = completed.map((t) => t.outcomeR);

  if (rs.length === 0) {
    return {
      iterations,
      confidence,
      finalEquity: { median: 0, lower: 0, upper: 0, mean: 0, stdDev: 0 },
      maxDrawdown: { median: 0, lower: 0, upper: 0, mean: 0, worst: 0 },
      probProfit: 0,
      probNewHigh: 0,
      averageCurve: [],
      lowerCurve: [],
      upperCurve: [],
    };
  }

  const finalEquities: number[] = [];
  const maxDrawdowns: number[] = [];
  const curves: number[][] = [];
  let profitableCount = 0;
  let newHighCount = 0;

  for (let i = 0; i < iterations; i++) {
    const sampled = blockBootstrap(rs, blockSize);
    const equity: number[] = [startingEquity];
    for (let j = 0; j < sampled.length; j++) {
      equity.push(equity[j] + sampled[j]);
    }

    const final = equity[equity.length - 1];
    finalEquities.push(final);
    if (final > startingEquity) profitableCount++;

    const { maxDrawdown } = computeDrawdown(equity);
    maxDrawdowns.push(maxDrawdown);
    if (maxDrawdown === 0) newHighCount++;

    curves.push(equity);
  }

  finalEquities.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  const alpha = 1 - confidence;
  const lowerP = alpha / 2;
  const upperP = 1 - alpha / 2;

  const meanFinal = finalEquities.reduce((a, b) => a + b, 0) / finalEquities.length;
  const stdDevFinal = Math.sqrt(
    finalEquities.reduce((sum, v) => sum + (v - meanFinal) ** 2, 0) / finalEquities.length
  );

  const meanDD = maxDrawdowns.reduce((a, b) => a + b, 0) / maxDrawdowns.length;

  // Build average/percentile curves by step.
  const curveLength = rs.length + 1;
  const averageCurve: number[] = new Array(curveLength).fill(0);
  const lowerCurve: number[] = new Array(curveLength).fill(0);
  const upperCurve: number[] = new Array(curveLength).fill(0);

  for (let step = 0; step < curveLength; step++) {
    const stepValues: number[] = [];
    for (const curve of curves) {
      stepValues.push(curve[step] ?? startingEquity);
    }
    stepValues.sort((a, b) => a - b);
    averageCurve[step] = stepValues.reduce((a, b) => a + b, 0) / stepValues.length;
    lowerCurve[step] = percentile(stepValues, lowerP);
    upperCurve[step] = percentile(stepValues, upperP);
  }

  return {
    iterations,
    confidence,
    finalEquity: {
      median: percentile(finalEquities, 0.5),
      lower: percentile(finalEquities, lowerP),
      upper: percentile(finalEquities, upperP),
      mean: meanFinal,
      stdDev: stdDevFinal,
    },
    maxDrawdown: {
      median: percentile(maxDrawdowns, 0.5),
      lower: percentile(maxDrawdowns, lowerP),
      upper: percentile(maxDrawdowns, upperP),
      mean: meanDD,
      worst: maxDrawdowns[maxDrawdowns.length - 1],
    },
    probProfit: profitableCount / iterations,
    probNewHigh: newHighCount / iterations,
    averageCurve,
    lowerCurve,
    upperCurve,
  };
}

/**
 * Quick Monte Carlo report suitable for console logging.
 */
export function formatMonteCarloResult(result: MonteCarloResult): string {
  return [
    `Monte Carlo (${result.iterations.toLocaleString()} iterations, ${(result.confidence * 100).toFixed(
      0
    )}% confidence):`,
    `  Final equity: median=${result.finalEquity.median.toFixed(2)}R mean=${result.finalEquity.mean.toFixed(
      2
    )}R range=[${result.finalEquity.lower.toFixed(2)}, ${result.finalEquity.upper.toFixed(2)}]`,
    `  Max drawdown: median=${result.maxDrawdown.median.toFixed(
      2
    )}R worst=${result.maxDrawdown.worst.toFixed(2)}R`,
    `  P(profit)=${(result.probProfit * 100).toFixed(1)}%  P(no drawdown)=${(
      result.probNewHigh * 100
    ).toFixed(1)}%`,
  ].join("\n");
}
