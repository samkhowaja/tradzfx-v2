export interface LiveStats {
  isActive: boolean;
  mode: "paper" | "live";
  totalTrades: number;
  wins: number;
  losses: number;
  openPositions: number;
  winRate: number;
}

export interface StrategySpecDetail {
  id: string;
  name: string;
  version: string;
  description?: string;
  family: string;
  setup?: any[];
  entry?: any[];
  risk?: any;
  gates?: any[];
  live?: any;
  filters?: {
    symbols?: string[];
    session?: string;
    timeWindow?: { utcStart: string; utcEnd: string };
  };
}

export interface AggregateResult {
  totalExecuted: number;
  totalWins: number;
  totalLosses: number;
  totalTimeouts: number;
  totalNetR: number;
  winRate: number;
  profitFactor: number;
  avgWinR: number;
  avgLossR: number;
  longCount: number;
  shortCount: number;
  avgHoldBars: number;
  gateSkips: Record<string, number>;
}

export interface SymbolResult {
  symbol: string;
  executed: number;
  wins: number;
  losses: number;
  netR: number;
  winRate: number;
  avgHoldBars: number;
}

export interface WindowResult extends AggregateResult {
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

export interface StrategyDetail {
  spec: StrategySpecDetail;
  live: LiveStats;
  historicalPIT: {
    aggregate: AggregateResult;
    perSymbol: SymbolResult[];
  };
  walkforward: {
    aggregate: AggregateResult;
    windows: WindowResult[];
  };
  portfolioOverlap: PortfolioSimulation | null;
}
