import fs from "fs";
import path from "path";

export interface PITResult {
  spec: string;
  symbol: string;
  days: number;
  rawSignals: number;
  executed: number;
  skipped: number;
  gateSkips: Record<string, number>;
  wins: number;
  losses: number;
  timeouts: number;
  noFills: number;
  winRate: number;
  netR: number;
  avgWinR: number;
  avgLossR: number;
  longCount: number;
  shortCount: number;
  avgHoldBars: number;
}

export interface WalkforwardResult extends PITResult {
  end: string;
}

export interface PortfolioSimulation {
  accepted: number;
  dropped: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  netR: number;
  maxConcurrent: number;
  droppedBySpec: Record<string, number>;
  acceptedBySpec: Record<string, number>;
}

function findRepoRoot(): string {
  let dir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function seedDir(): string {
  return path.join(findRepoRoot(), "data", "backtest-seed");
}

function readJSON<T>(...segments: string[]): T | null {
  const file = path.join(seedDir(), ...segments);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function aggregateResults(rows: PITResult[]) {
  const totalWins = rows.reduce((s, r) => s + r.wins, 0);
  const totalLosses = rows.reduce((s, r) => s + r.losses, 0);
  const totalTimeouts = rows.reduce((s, r) => s + r.timeouts, 0);
  const totalExecuted = rows.reduce((s, r) => s + r.executed, 0);
  const totalNetR = rows.reduce((s, r) => s + r.netR, 0);
  const longCount = rows.reduce((s, r) => s + r.longCount, 0);
  const shortCount = rows.reduce((s, r) => s + r.shortCount, 0);

  const avgWinR =
    totalWins > 0
      ? rows.reduce((s, r) => s + r.avgWinR * r.wins, 0) / totalWins
      : 0;
  const avgLossR =
    totalLosses > 0
      ? rows.reduce((s, r) => s + r.avgLossR * r.losses, 0) / totalLosses
      : 0;

  const gateSkips: Record<string, number> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.gateSkips ?? {})) {
      gateSkips[k] = (gateSkips[k] ?? 0) + v;
    }
  }

  return {
    totalExecuted,
    totalWins,
    totalLosses,
    totalTimeouts,
    totalNetR,
    winRate: totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0,
    profitFactor:
      totalLosses > 0 && avgLossR !== 0
        ? (avgWinR * totalWins) / Math.abs(avgLossR * totalLosses)
        : totalWins > 0
          ? Infinity
          : 0,
    avgWinR,
    avgLossR,
    longCount,
    shortCount,
    avgHoldBars:
      totalExecuted > 0
        ? rows.reduce((s, r) => s + r.avgHoldBars * r.executed, 0) / totalExecuted
        : 0,
    gateSkips,
  };
}

export function loadHistoricalPIT(specId: string) {
  const rows = readJSON<PITResult[]>("historical-pit-90d", "raw-results.json") ?? [];
  const filtered = rows.filter((r) => r.spec === specId);
  const aggregate = aggregateResults(filtered);

  const perSymbol = filtered.map((r) => ({
    symbol: r.symbol,
    executed: r.executed,
    wins: r.wins,
    losses: r.losses,
    netR: r.netR,
    winRate: r.winRate,
    avgHoldBars: r.avgHoldBars,
  }));

  return { aggregate, perSymbol };
}

export function loadWalkforward(specId: string) {
  const rows = readJSON<WalkforwardResult[]>("walkforward-30d-15d", "raw-results.json") ?? [];
  const filtered = rows.filter((r) => r.spec === specId);

  const byWindow = new Map<string, WalkforwardResult[]>();
  for (const r of filtered) {
    const list = byWindow.get(r.end) ?? [];
    list.push(r);
    byWindow.set(r.end, list);
  }

  const windows = Array.from(byWindow.entries())
    .map(([end, rs]) => {
      const agg = aggregateResults(rs);
      return { end, ...agg };
    })
    .sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime());

  const aggregate = aggregateResults(filtered);
  return { aggregate, windows };
}

export function loadPortfolioOverlap(specId: string): PortfolioSimulation | null {
  const sim = readJSON<PortfolioSimulation>("portfolio-overlap-90d", "simulation.json");
  if (!sim) return null;
  if (!sim.acceptedBySpec[specId]) return null;
  return sim;
}
