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

export interface BacktestReport {
  totalTrades: number;
  winRate: number;
  avgR: number;
  totalR: number;
  byGrade: GradeMetrics[];
  bySession: SessionMetrics[];
  byHtfState: HtfStateMetrics[];
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

export function generateReport(trades: BacktestTrade[]): BacktestReport {
  const completed = completedTrades(trades);
  const wins = completed.filter((t) => t.outcome === "win").length;
  const totalR = completed.reduce((sum, t) => sum + t.outcomeR, 0);

  return {
    totalTrades: completed.length,
    winRate: completed.length > 0 ? wins / completed.length : 0,
    avgR: completed.length > 0 ? totalR / completed.length : 0,
    totalR,
    byGrade: computeGradeMetrics(trades),
    bySession: computeSessionMetrics(trades),
    byHtfState: computeHtfStateMetrics(trades),
  };
}
