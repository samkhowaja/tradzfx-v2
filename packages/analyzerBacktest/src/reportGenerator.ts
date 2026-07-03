import type { BacktestTrade } from "./runBacktest";

export interface GradeMetrics {
  grade: string;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalR: number;
}

export interface SessionMetrics {
  session: string;
  count: number;
  winRate: number;
  avgR: number;
  totalR: number;
}

export interface HtfStateMetrics {
  htfState: string;
  count: number;
  winRate: number;
  avgR: number;
  totalR: number;
}

export interface DirectionMetrics {
  direction: string;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalR: number;
}

export interface StreakMetrics {
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number;
  currentStreakType: "win" | "loss" | "none";
}

export interface WinRateConfidence {
  /** Observed win rate (0-1) */
  winRate: number;
  /** Lower bound of the Clopper-Pearson / Wilson interval */
  lower: number;
  /** Upper bound of the Clopper-Pearson / Wilson interval */
  upper: number;
  /** Z-score for the hypothesis that true win rate > 0.5 */
  zScore: number;
  /** Two-tailed p-value for win rate != 0.5 */
  pValue: number;
}

export interface RiskReturnMetrics {
  /** Average R per completed trade */
  avgR: number;
  /** Total R accumulated */
  totalR: number;
  /** Gross profit / gross loss (absolute R) */
  profitFactor: number;
  /** Expectancy = (winRate * avgWinR) - (lossRate * |avgLossR|) */
  expectancy: number;
  /** Payoff ratio = avgWinR / |avgLossR| */
  payoffRatio: number;
  /** Average win R */
  avgWinR: number;
  /** Average loss R (negative) */
  avgLossR: number;
  /** Largest single winning trade R */
  largestWinR: number;
  /** Largest single losing trade R */
  largestLossR: number;
  /** Maximum peak-to-trough drawdown in R */
  maxDrawdownR: number;
  /** Maximum drawdown as percentage of peak equity */
  maxDrawdownPct: number;
  /** Sharpe ratio assuming R multiples as returns and zero risk-free rate */
  sharpeRatio: number;
  /** Sortino ratio using downside deviation below zero */
  sortinoRatio: number;
  /** Calmar ratio = annualized return / max drawdown (simplified using totalR / |maxDrawdownR|) */
  calmarRatio: number;
  /** Standard deviation of trade R */
  stdDevR: number;
  /** Cumulative equity curve in R */
  equityCurve: number[];
  /** Win/loss streak statistics */
  streaks: StreakMetrics;
  /** Statistical confidence around the win rate */
  winRateConfidence: WinRateConfidence;
}

export interface BacktestReport {
  totalTrades: number;
  winRate: number;
  avgR: number;
  totalR: number;
  riskReturn: RiskReturnMetrics;
  byGrade: GradeMetrics[];
  bySession: SessionMetrics[];
  byHtfState: HtfStateMetrics[];
  byDirection: DirectionMetrics[];
}

function completedTrades(trades: BacktestTrade[]): BacktestTrade[] {
  return trades.filter((t) => t.outcome === "win" || t.outcome === "loss");
}

function computeGradeMetrics(trades: BacktestTrade[]): GradeMetrics[] {
  const groups = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const arr = groups.get(t.grade) ?? [];
    arr.push(t);
    groups.set(t.grade, arr);
  }
  return Array.from(groups.entries())
    .map(([grade, arr]) => {
      const completed = completedTrades(arr);
      const wins = completed.filter((t) => t.outcome === "win").length;
      const losses = completed.filter((t) => t.outcome === "loss").length;
      const totalR = completed.reduce((sum, t) => sum + t.outcomeR, 0);
      return {
        grade,
        count: completed.length,
        wins,
        losses,
        winRate: completed.length > 0 ? wins / completed.length : 0,
        avgR: completed.length > 0 ? totalR / completed.length : 0,
        totalR,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function computeSessionMetrics(trades: BacktestTrade[]): SessionMetrics[] {
  const groups = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const key = t.sessionName ?? "unknown";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  return Array.from(groups.entries())
    .map(([session, arr]) => {
      const completed = completedTrades(arr);
      const wins = completed.filter((t) => t.outcome === "win").length;
      const totalR = completed.reduce((sum, t) => sum + t.outcomeR, 0);
      return {
        session,
        count: completed.length,
        winRate: completed.length > 0 ? wins / completed.length : 0,
        avgR: completed.length > 0 ? totalR / completed.length : 0,
        totalR,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function computeHtfStateMetrics(trades: BacktestTrade[]): HtfStateMetrics[] {
  const groups = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const key = t.htfState ?? "unknown";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  return Array.from(groups.entries())
    .map(([htfState, arr]) => {
      const completed = completedTrades(arr);
      const wins = completed.filter((t) => t.outcome === "win").length;
      const totalR = completed.reduce((sum, t) => sum + t.outcomeR, 0);
      return {
        htfState,
        count: completed.length,
        winRate: completed.length > 0 ? wins / completed.length : 0,
        avgR: completed.length > 0 ? totalR / completed.length : 0,
        totalR,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function computeDirectionMetrics(trades: BacktestTrade[]): DirectionMetrics[] {
  const groups = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const key = t.direction ?? "unknown";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  return Array.from(groups.entries())
    .map(([direction, arr]) => {
      const completed = completedTrades(arr);
      const wins = completed.filter((t) => t.outcome === "win").length;
      const losses = completed.filter((t) => t.outcome === "loss").length;
      const totalR = completed.reduce((sum, t) => sum + t.outcomeR, 0);
      return {
        direction,
        count: completed.length,
        wins,
        losses,
        winRate: completed.length > 0 ? wins / completed.length : 0,
        avgR: completed.length > 0 ? totalR / completed.length : 0,
        totalR,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function computeEquityCurve(rs: number[]): number[] {
  let sum = 0;
  return rs.map((r) => {
    sum += r;
    return sum;
  });
}

function computeDrawdown(equityCurve: number[]): { maxDrawdownR: number; maxDrawdownPct: number } {
  let peak = -Infinity;
  let maxDrawdownR = 0;
  let maxDrawdownPct = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = eq - peak;
    if (dd < maxDrawdownR) {
      maxDrawdownR = dd;
      if (peak > 0) {
        maxDrawdownPct = Math.min(0, (dd / peak) * 100);
      }
    }
  }
  return { maxDrawdownR, maxDrawdownPct };
}

function computeStreaks(rs: number[]): StreakMetrics {
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWin = 0;
  let currentLoss = 0;

  for (const r of rs) {
    if (r > 0) {
      currentWin++;
      currentLoss = 0;
      if (currentWin > maxWinStreak) maxWinStreak = currentWin;
    } else if (r < 0) {
      currentLoss++;
      currentWin = 0;
      if (currentLoss > maxLossStreak) maxLossStreak = currentLoss;
    }
  }

  let currentStreak = 0;
  let currentStreakType: "win" | "loss" | "none" = "none";
  if (currentWin > 0) {
    currentStreak = currentWin;
    currentStreakType = "win";
  } else if (currentLoss > 0) {
    currentStreak = currentLoss;
    currentStreakType = "loss";
  }

  return { maxWinStreak, maxLossStreak, currentStreak, currentStreakType };
}

/**
 * Wilson score interval for a binomial proportion.
 * Returns a conservative confidence interval for the true win rate.
 */
function wilsonInterval(wins: number, n: number, confidence = 0.95): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 0 };
  const z = confidence === 0.95 ? 1.96 : 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const width = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)) / denom;
  return {
    lower: Math.max(0, centre - width),
    upper: Math.min(1, centre + width),
  };
}

function computeWinRateConfidence(wins: number, losses: number): WinRateConfidence {
  const n = wins + losses;
  const winRate = n > 0 ? wins / n : 0;
  const { lower, upper } = wilsonInterval(wins, n);

  // Z-test for win rate > 0.5
  const p0 = 0.5;
  const se = n > 0 ? Math.sqrt((p0 * (1 - p0)) / n) : 0;
  const zScore = se > 0 ? (winRate - p0) / se : 0;

  // Two-tailed p-value using normal approximation
  const pValue = n > 0 ? 2 * (1 - normalCdf(Math.abs(zScore))) : 1;

  return { winRate, lower, upper, zScore, pValue };
}

function normalCdf(x: number): number {
  // Approximation of the standard normal CDF (Abramowitz & Stegun)
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;

  if (x >= 0) {
    const t = 1 / (1 + p * x);
    return 1 - c * Math.exp(-x * x / 2) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
  } else {
    return 1 - normalCdf(-x);
  }
}

function computeRiskReturn(trades: BacktestTrade[]): RiskReturnMetrics {
  const completed = completedTrades(trades);
  const rs = completed.map((t) => t.outcomeR);

  const wins = completed.filter((t) => t.outcome === "win");
  const losses = completed.filter((t) => t.outcome === "loss");

  const winRs = wins.map((t) => t.outcomeR);
  const lossRs = losses.map((t) => t.outcomeR);

  const grossProfit = winRs.reduce((sum, r) => sum + r, 0);
  const grossLoss = Math.abs(lossRs.reduce((sum, r) => sum + r, 0));

  const avgWinR = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLossR = losses.length > 0 ? grossLoss / losses.length * -1 : 0;

  const totalR = grossProfit - grossLoss;
  const avgR = completed.length > 0 ? totalR / completed.length : 0;

  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const payoffRatio = avgLossR !== 0 ? Math.abs(avgWinR / avgLossR) : 0;

  const winRate = completed.length > 0 ? wins.length / completed.length : 0;
  const lossRate = 1 - winRate;
  const expectancy = winRate * avgWinR - lossRate * Math.abs(avgLossR);

  const equityCurve = computeEquityCurve(rs);
  const { maxDrawdownR, maxDrawdownPct } = computeDrawdown(equityCurve);

  const mean = avgR;
  const variance = completed.length > 0
    ? rs.reduce((sum, r) => sum + (r - mean) ** 2, 0) / completed.length
    : 0;
  const stdDevR = Math.sqrt(variance);

  const downsideVariance = completed.length > 0
    ? rs.filter((r) => r < 0).reduce((sum, r) => sum + r * r, 0) / completed.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance);

  const sharpeRatio = stdDevR > 0 ? (avgR / stdDevR) * Math.sqrt(completed.length) : 0;
  const sortinoRatio = downsideDeviation > 0 ? (avgR / downsideDeviation) * Math.sqrt(completed.length) : 0;
  const calmarRatio = maxDrawdownR !== 0 ? totalR / Math.abs(maxDrawdownR) : 0;

  return {
    avgR,
    totalR,
    profitFactor,
    expectancy,
    payoffRatio,
    avgWinR,
    avgLossR,
    largestWinR: winRs.length > 0 ? Math.max(...winRs) : 0,
    largestLossR: lossRs.length > 0 ? Math.min(...lossRs) : 0,
    maxDrawdownR,
    maxDrawdownPct,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    stdDevR,
    equityCurve,
    streaks: computeStreaks(rs),
    winRateConfidence: computeWinRateConfidence(wins.length, losses.length),
  };
}

export function generateReport(trades: BacktestTrade[]): BacktestReport {
  const completed = completedTrades(trades);
  const wins = completed.filter((t) => t.outcome === "win").length;
  const totalR = completed.reduce((sum, t) => sum + t.outcomeR, 0);

  return {
    totalTrades: completed.length,
    winRate: completed.length > 0 ? wins / completed.length : 0,
    avgR: completed.length > 0 ? totalR / completed.length : 0,
    totalR,
    riskReturn: computeRiskReturn(trades),
    byGrade: computeGradeMetrics(trades),
    bySession: computeSessionMetrics(trades),
    byHtfState: computeHtfStateMetrics(trades),
    byDirection: computeDirectionMetrics(trades),
  };
}
