import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool, StrategySpec } from "@tm/shared";
import type { SetupEvaluation } from "@tm/setup-engine";
import { evaluateSetup } from "@tm/setup-engine";
import { runLivePipeline, type LiveRunOptions } from "./liveRunner";

vi.mock("@tm/setup-engine", () => ({
  evaluateSetup: vi.fn().mockResolvedValue({
    grade: "A",
    status: "ready",
    direction: "long",
    confidence: 70,
    entryZone: null,
    stopLoss: null,
    takeProfit: null,
    riskReward: 3,
    blockReasons: [],
    warnings: [],
    evidence: [],
    featuresUsed: [],
    symbol: "EURUSD",
    tf: "15m",
    timestamp: new Date().toISOString(),
  } satisfies SetupEvaluation),
}));

const poolRef = { pool: null as unknown as Pool };

vi.mock("@tm/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@tm/shared")>();
  return {
    ...mod,
    getPool: () => poolRef.pool,
  };
});

interface QueryHandler {
  match: RegExp;
  rows: any[];
}

function createFakePool(handlers: QueryHandler[]): Pool {
  const query = vi.fn(async (sql: string, _params?: any[]) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    if (/INSERT INTO risk_state/i.test(sql)) return { rows: [] };
    if (/SELECT .+ FROM risk_state/i.test(sql)) return { rows: [{ ok: 1 }] };
    const handler = handlers.find((h) => h.match.test(sql));
    if (!handler) {
      throw new Error(`Unexpected query in test: ${sql.slice(0, 120)}`);
    }
    return { rows: handler.rows };
  });
  const client = { query, release: vi.fn() };
  const connect = vi.fn(async () => client);
  return { query, connect } as unknown as Pool;
}

function freshnessHandlers(): QueryHandler[] {
  const now = new Date().toISOString();
  return [
    // Candles MAX(ts) is handled separately (uses CANDLE_TABLE_BY_TF, not features)
    { match: /SELECT MAX\(ts\).*FROM candles_1m/i, rows: [{ max_ts: now }] },
    // Batched feature freshness: single UNION ALL query replacing 3 separate MAX(ts).
    // Return fresh timestamps for all 3 features in one batch.
    { match: /UNION ALL/i, rows: [
      { feature_name: "features_atr", tf: "15m", max_ts: now },
      { feature_name: "features_session", tf: "1m", max_ts: now },
      { feature_name: "features_spread", tf: "1m", max_ts: now },
    ]},
    // P0-C producer-SLA cross-check reads (empty ledger => treat as fresh/unknown)
    { match: /FROM feature_producer_runs/i, rows: [] },
    { match: /FROM lifecycle_refresh_state/i, rows: [] },
  ];
}

function featureHandlers(session = "LONDON"): QueryHandler[] {
  return [
    { match: /FROM mt5_terminals/i, rows: [{ balance: 10000 }] },
    { match: /FROM market\.candles_1m_canonical/i, rows: [{ c: "1.0950" }] },
    { match: /FROM features_atr/i, rows: [{ period: 14, value: "0.0005" }] },
    { match: /FROM features_session/i, rows: [{ session, utc_hour: 8 }] },
    { match: /FROM features_spread/i, rows: [{ spread: "0.0002", samples: 10 }] },
    { match: /FROM features_pricing/i, rows: [{ position: "discount", in_ote: true, ote_low: "1.0900", ote_high: "1.0950" }] },
    { match: /FROM features_bias/i, rows: [{ direction: "bullish", confidence: 0.8, reason: "htf bullish" }] },
    { match: /FROM features_displacement/i, rows: [{ grade: "MEDIUM", direction: "bullish", body_pct: "0.65" }] },
    { match: /FROM features_structure/i, rows: [{ event_type: "bos", direction: "bullish", level: "1.0890" }] },
    { match: /FROM features_zone/i, rows: [{ zone_kind: "demand", top: "1.0905", bottom: "1.0900", fill_pct: "0.2", tapped: false }] },
    { match: /FROM features_ifvg/i, rows: [{ direction: "bullish", top: "1.0900", bottom: "1.0895", fill_pct: "0.1", tapped: false }] },
    { match: /FROM features_order_block/i, rows: [{ ob_kind: "bullish", degree: "swing", top: "1.0905", bottom: "1.0900", body_top: "1.0904", body_bottom: "1.0901", formation_ts: new Date().toISOString(), age_bars: 5, is_fresh: true, strength_score: "0.8", fill_pct: "0" }] },
  ];
}

function baseSignalRow() {
  return {
    symbol: "EURUSD",
    strategy_id: "test-strat",
    side: "buy",
    entry_price: "1.0950",
    stop_loss: "1.0940",
    take_profit: "1.0980",
    ts: new Date().toISOString(),
  };
}

function baseStrategy(gates: StrategySpec["gates"] = []): StrategySpec {
  return {
    id: "test-strat",
    name: "Test Strategy",
    version: "1",
    signalSource: "zone",
    filters: { symbols: ["EURUSD"] },
    setup: [],
    entry: [],
    risk: {
      sl: "0.001",
      tp: "0.003",
      minRR: 3,
      timeoutBars: 10,
    },
    live: {
      mode: "paper",
      lotSize: 0.01,
      riskPerTradePct: 1,
      accountBalance: 10000,
      accountCurrency: "USD",
      signalTtlMinutes: 15,
      maxSpreadPips: 3,
      maxSlippagePoints: 20,
      entryZonePips: 2,
      maxPositionsPerSymbol: 1,
      maxPositionsTotal: 6,
      cooldownMinutes: 30,
    },
    gates,
  };
}

function orderHandlers(): QueryHandler[] {
  return [
    { match: /FROM orders/i, rows: [] },
    { match: /INSERT INTO live_signal/i, rows: [{ signal_id: "live-signal-1" }] },
    { match: /UPDATE live_signal SET gate_trace_run_id/i, rows: [] },
    { match: /INSERT INTO live_order/i, rows: [{ order_id: "live-order-1" }] },
    { match: /INSERT INTO decision_trace/i, rows: [] },
    { match: /INSERT INTO live_signal_rejection/i, rows: [] },
  ];
}

describe("runLivePipeline", () => {
  let fakePool: Pool;
  const mockCreateOrder = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrder.mockResolvedValue({ id: "order-1" });
  });

  it("returns no_signal and writes nothing when the strategy SQL returns no rows", async () => {
    fakePool = createFakePool([
      ...freshnessHandlers(),
      { match: /SELECT \* FROM signal_view/i, rows: [] },
      { match: /INSERT INTO live_signal_rejection/i, rows: [] },
    ]);
    poolRef.pool = fakePool;

    const result = await runLivePipeline({
      symbol: "EURUSD",
      strategySpec: baseStrategy(),
      latestSignalSQL: "SELECT * FROM signal_view",
      pool: fakePool,
      deploymentId: "deployment-1",
      createOrder: mockCreateOrder,
    });

    expect(result.reason).toBe("no_signal");
    expect(result.orderCreated).toBeUndefined();
    // 5 base queries (candle MAX, 1x batched feature freshness, 3x producer SLA)
    // + 1 signal SELECT + 1 rejection INSERT = 7 total (no transaction on early return).
    expect(fakePool.query).toHaveBeenCalledTimes(7);
  });

  it("writes live_signal and live_order when gates pass and deploymentId is provided", async () => {
    fakePool = createFakePool([
      ...freshnessHandlers(),
      { match: /SELECT \* FROM signal_view/i, rows: [baseSignalRow()] },
      ...featureHandlers("LONDON"),
      ...orderHandlers(),
    ]);
    poolRef.pool = fakePool;

    const result = await runLivePipeline({
      symbol: "EURUSD",
      strategySpec: baseStrategy(),
      latestSignalSQL: "SELECT * FROM signal_view",
      pool: fakePool,
      deploymentId: "deployment-1",
      createOrder: mockCreateOrder,
    });

    expect(result.orderCreated).toBe(true);
    expect(result.orderId).toBe("order-1");
    expect(result.liveSignalId).toBe("live-signal-1");
    expect(result.liveOrderId).toBe("live-order-1");
    expect(mockCreateOrder).toHaveBeenCalledTimes(1);

    const insertSignal = fakePool.query.mock.calls.find((c) => /INSERT INTO live_signal/i.test(c[0] as string));
    expect(insertSignal).toBeDefined();
    const insertOrder = fakePool.query.mock.calls.find((c) => /INSERT INTO live_order/i.test(c[0] as string));
    expect(insertOrder).toBeDefined();
  });

  it("does not write live_signal or live_order when deploymentId is omitted", async () => {
    fakePool = createFakePool([
      ...freshnessHandlers(),
      { match: /SELECT \* FROM signal_view/i, rows: [baseSignalRow()] },
      ...featureHandlers("LONDON"),
      { match: /FROM orders/i, rows: [] },
      { match: /INSERT INTO decision_trace/i, rows: [] },
    ]);
    poolRef.pool = fakePool;

    const result = await runLivePipeline({
      symbol: "EURUSD",
      strategySpec: baseStrategy(),
      latestSignalSQL: "SELECT * FROM signal_view",
      pool: fakePool,
      createOrder: mockCreateOrder,
    });

    expect(result.orderCreated).toBe(true);
    expect(result.liveSignalId).toBeUndefined();
    expect(result.liveOrderId).toBeUndefined();

    const insertSignal = fakePool.query.mock.calls.find((c) => /INSERT INTO live_signal/i.test(c[0] as string));
    expect(insertSignal).toBeUndefined();
    const insertOrder = fakePool.query.mock.calls.find((c) => /INSERT INTO live_order/i.test(c[0] as string));
    expect(insertOrder).toBeUndefined();
  });

  it("writes live_signal but not live_order when a gate fails", async () => {
    fakePool = createFakePool([
      ...freshnessHandlers(),
      { match: /SELECT \* FROM signal_view/i, rows: [baseSignalRow()] },
      ...featureHandlers("LONDON"),
      { match: /FROM orders/i, rows: [] },
      { match: /INSERT INTO live_signal/i, rows: [{ signal_id: "live-signal-1" }] },
      { match: /UPDATE live_signal SET gate_trace_run_id/i, rows: [] },
      { match: /INSERT INTO decision_trace/i, rows: [] },
    ]);
    poolRef.pool = fakePool;

    const result = await runLivePipeline({
      symbol: "EURUSD",
      strategySpec: baseStrategy([
        { id: "session_gate", name: "session", params: { allowed: ["NY"] } },
      ]),
      latestSignalSQL: "SELECT * FROM signal_view",
      pool: fakePool,
      deploymentId: "deployment-1",
      createOrder: mockCreateOrder,
    });

    expect(result.orderCreated).toBe(false);
    expect(result.liveSignalId).toBe("live-signal-1");
    expect(result.liveOrderId).toBeUndefined();
    expect(mockCreateOrder).not.toHaveBeenCalled();

    const insertOrder = fakePool.query.mock.calls.find((c) => /INSERT INTO live_order/i.test(c[0] as string));
    expect(insertOrder).toBeUndefined();
  });
});


describe("setup grade guard", () => {
  it("does not create an order when setup evaluation grade is BLOCK", async () => {
    vi.mocked(evaluateSetup).mockResolvedValueOnce({
      grade: "BLOCK",
      status: "blocked",
      direction: "long",
      confidence: 0,
      entryZone: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      blockReasons: ["price not in OTE"],
      warnings: [],
      evidence: [],
      featuresUsed: [],
      symbol: "EURUSD",
      tf: "15m",
      timestamp: new Date().toISOString(),
    } as unknown as SetupEvaluation);

    const fakePool = createFakePool([
      ...freshnessHandlers(),
      { match: /SELECT \* FROM signal_view/i, rows: [baseSignalRow()] },
      ...featureHandlers("LONDON"),
      ...orderHandlers(),
    ]);
    poolRef.pool = fakePool;

    const mockCreateOrder = vi.fn().mockResolvedValue({ id: "order-1" });

    const result = await runLivePipeline({
      symbol: "EURUSD",
      strategySpec: baseStrategy(),
      latestSignalSQL: "SELECT * FROM signal_view",
      pool: fakePool,
      deploymentId: "deployment-1",
      createOrder: mockCreateOrder,
    });

    expect(result.orderCreated).toBe(false);
    expect(result.reason).toMatch(/setup_blocked/);
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });
});
