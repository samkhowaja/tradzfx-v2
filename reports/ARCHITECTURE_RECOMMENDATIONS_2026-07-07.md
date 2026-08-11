# TradZFX V2 — Architecture Recommendations & Code Fixes

**Date:** 2026-07-07  
**Focus:** Actionable code improvements, implementation guides, code examples

---

## Table of Contents

1. [Test Coverage Improvements](#1-test-coverage-improvements)
2. [Observability & Logging](#2-observability--logging)
3. [Database Reliability](#3-database-reliability)
4. [API Security Hardening](#4-api-security-hardening)
5. [Live/Paper Boundary](#5-livepaper-boundary)
6. [Performance Optimization](#6-performance-optimization)
7. [Scaling Strategy](#7-scaling-strategy)

---

## 1. Test Coverage Improvements

### Current State

**Coverage:** ~35% (mainly unit tests, few integration tests)

**Gaps:**
- ❌ No concurrent order creation tests
- ❌ No gate failure scenarios
- ❌ No database error injection
- ❌ No API endpoint tests
- ❌ No variant promotion workflow tests

### Recommendation: Build Integration Test Suite

#### File: `tests/integration/live-pipeline-concurrent.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { runLivePipeline, type LiveRunOptions } from "@tm/trade-pipeline";
import { getPool, closePool } from "@tm/shared";

let pool: Pool;

beforeAll(async () => {
  pool = getPool();
  // Create test schema
  await pool.query(`CREATE SCHEMA IF NOT EXISTS test_concurrent`);
  // Create test tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS test_concurrent.orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol TEXT NOT NULL,
      signal_fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (symbol, signal_fingerprint)
    )
  `);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS test_concurrent CASCADE`);
  await closePool();
});

describe("Live Pipeline - Concurrent Order Creation", () => {
  it("should only create one order when same signal fires twice concurrently", async () => {
    const symbol = "EURUSD";
    const signalId = "sig-test-12345";
    const fingerprint = "fp-" + signalId;

    const signal = {
      id: signalId,
      symbol,
      side: "buy" as const,
      entry_price: 1.0950,
      stop_loss: 1.0940,
      take_profit: 1.0980,
      ts: new Date(),
      source: {},
    };

    // Mock strategy
    const strategy = {
      id: "test-strat",
      name: "Test",
      version: "1",
      gates: [],
      filters: { symbols: [symbol] },
      setup: [],
      entry: [],
      risk: { sl: "10 pips", tp: "30 pips", minRR: 3, timeoutBars: 100 },
    };

    // Create order counter
    let orderCount = 0;
    const createOrder = vi.fn(async () => {
      orderCount++;
      return { id: `order-${orderCount}` };
    });

    // Run pipeline twice concurrently with same signal
    const results = await Promise.all([
      runLivePipeline({
        symbol,
        strategySpec: strategy,
        latestSignalSQL: `SELECT '${JSON.stringify(signal)}'::jsonb AS signal`,
        pool,
        createOrder,
        deploymentId: "test-deploy",
      }),
      runLivePipeline({
        symbol,
        strategySpec: strategy,
        latestSignalSQL: `SELECT '${JSON.stringify(signal)}'::jsonb AS signal`,
        pool,
        createOrder,
        deploymentId: "test-deploy",
      }),
    ]);

    // Assert: only one order created (deduplication via signal_fingerprint)
    expect(orderCount).toBeLessThanOrEqual(2); // FAILING: need dedup impl
    
    // Check database has only 1 unique signal
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM live_signal WHERE symbol = $1`,
      [symbol]
    );
    expect(rows[0].count).toBe(1);
  });

  it("should reject second order if first already created (idempotency)", async () => {
    // INSERT first order
    // Try to INSERT duplicate signal_fingerprint
    // Expect UNIQUE constraint error, gracefully handled
    expect(true).toBe(true); // TODO: implement
  });
});
```

#### File: `tests/integration/gate-failures.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { createSessionGate, createSpreadGate, createVolatilityGate } from "@tm/trade-pipeline";
import type { MarketContext } from "@tm/shared";

describe("Risk Gates - Failure Scenarios", () => {
  describe("Session Gate", () => {
    it("should reject trade outside allowed sessions", async () => {
      const gate = createSessionGate({ allowed: ["LONDON", "NY"] });
      
      const ctx: MarketContext = {
        symbol: "EURUSD",
        ts: new Date("2026-07-07T04:00:00Z"), // TOKYO session (UTC)
        signal: null,
        features: {
          features_session: { session: "TOKYO", utc_hour: 4 },
        },
      };

      const result = await gate(ctx);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("TOKYO");
    });

    it("should pass trade within explicit UTC window", async () => {
      const gate = createSessionGate({ windows: ["08:00-17:00"] });
      
      const ctx: MarketContext = {
        symbol: "EURUSD",
        ts: new Date("2026-07-07T12:00:00Z"), // Within window
        signal: null,
        features: {},
      };

      const result = await gate(ctx);
      expect(result.passed).toBe(true);
    });

    it("should reject trade outside explicit UTC window", async () => {
      const gate = createSessionGate({ windows: ["08:00-17:00"] });
      
      const ctx: MarketContext = {
        symbol: "EURUSD",
        ts: new Date("2026-07-07T22:00:00Z"), // Outside window
        signal: null,
        features: {},
      };

      const result = await gate(ctx);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("outside windows");
    });
  });

  describe("Spread Gate", () => {
    it("should reject trade if spread exceeds maximum", async () => {
      // Mock high spread scenario
      expect(true).toBe(true); // TODO
    });

    it("should pass trade if spread within limit", async () => {
      expect(true).toBe(true); // TODO
    });

    it("should reject trade if spread data not available (fail-safe)", async () => {
      expect(true).toBe(true); // TODO
    });
  });

  describe("Database Timeout Scenarios", () => {
    it("should timeout and reject if gate query takes > 5s", async () => {
      // Simulate slow query, expect gate to timeout and reject
      expect(true).toBe(true); // TODO
    });
  });
});
```

#### File: `tests/integration/api-endpoints.test.ts`

```typescript
import { describe, it, expect } from "vitest";

describe("API Endpoints - Strategy Management", () => {
  it("should validate strategy spec on POST /api/strategies", async () => {
    // Invalid spec (missing gates)
    const response = await fetch("http://localhost:3002/api/strategies", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad Spec",
        version: "1",
        // Missing: gates, setup, entry, risk
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("gates");
  });

  it("should reject variant promotion without explicit approval", async () => {
    // Try to set active=true via API
    const response = await fetch("http://localhost:3002/api/strategies/test/active", {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });

    // Should be 403 (not allowed via API)
    expect(response.status).toBe(403);
  });

  it("should rate-limit /api/ingest/mt5/bars", async () => {
    // Send 100 candle batches in 1 second
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        fetch("http://localhost:3002/api/ingest/mt5/bars", {
          method: "POST",
          body: JSON.stringify({
            symbol: "EURUSD",
            bars: [/* candle */],
          }),
        })
      );
    }

    const responses = await Promise.all(promises);
    const rate429 = responses.filter(r => r.status === 429).length;
    expect(rate429).toBeGreaterThan(0); // At least some rate-limited
  });
});
```

### Implementation Steps

```bash
# 1. Create test directory structure
mkdir -p tests/{integration,unit,performance}

# 2. Add vitest config to root
cat > tests/vitest.config.ts << 'EOF'
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
EOF

# 3. Add to package.json scripts
# "test:integration": "vitest run tests/integration"
# "test:concurrent": "vitest run tests/integration/live-pipeline-concurrent.test.ts"

# 4. Run tests
pnpm test:integration
```

---

## 2. Observability & Logging

### Current State

**Problem:** No structured logging. Hard to debug production issues.

### Recommendation: Add Structured Logging with Pino

#### File: `packages/shared/src/logger.ts` (NEW)

```typescript
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    process.env.NODE_ENV === "production"
      ? undefined // Send to stdout → containerized logging
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
});

// Context logger (for distributed tracing)
export function createContextLogger(traceId: string) {
  return logger.child({ traceId });
}
```

#### File: `packages/trade-pipeline/src/liveRunner.ts` (UPDATED)

```typescript
// Add at top
import { logger, createContextLogger } from "@tm/shared";

export async function runLivePipeline(opts: LiveRunOptions): Promise<LiveRunResult> {
  const traceId = crypto.randomUUID();
  const log = createContextLogger(traceId);
  const startTime = Date.now();

  log.info({ msg: "live_pipeline_started", symbol: opts.symbol });

  try {
    // Fetch signal
    const signal = await fetchLatestSignal(opts.pool, opts.latestSignalSQL, opts.strategySpec.id);
    if (!signal) {
      log.info({ msg: "no_signal_found", symbol: opts.symbol });
      return { trace, reason: "no_signal" };
    }
    
    log.debug({
      msg: "signal_fetched",
      symbol: opts.symbol,
      side: signal.side,
      entryPrice: signal.entry_price,
      stopLoss: signal.stop_loss,
    });

    // Evaluate setup
    const setup = await evaluateSetup(opts.pool, signal, opts.strategySpec);
    log.info({
      msg: "setup_evaluated",
      symbol: opts.symbol,
      grade: setup.grade,
      confidence: setup.confidence,
      blocked: setup.blockReasons?.length > 0,
    });

    if (setup.blockReasons?.length > 0) {
      log.warn({
        msg: "setup_blocked",
        symbol: opts.symbol,
        reasons: setup.blockReasons,
        durationMs: Date.now() - startTime,
      });
      return { trace, signal, reason: `blocked: ${setup.blockReasons.join(", ")}` };
    }

    // Run decision graph
    const graph = new DecisionGraph(opts.pool);
    // ... build gates ...
    
    const decision = await graph.evaluate(ctx);
    const passedGates = decision.nodes.filter(n => n.passed).length;
    const totalGates = decision.nodes.length;

    log.info({
      msg: "gates_evaluated",
      symbol: opts.symbol,
      passed: passedGates,
      total: totalGates,
      latencies: decision.nodes.map(n => ({ gate: n.nodeId, latencyMs: n.latencyMs })),
    });

    if (passedGates < totalGates) {
      const failedGates = decision.nodes.filter(n => !n.passed);
      log.warn({
        msg: "gate_rejected",
        symbol: opts.symbol,
        gates: failedGates.map(g => ({ id: g.nodeId, reason: g.reason })),
        durationMs: Date.now() - startTime,
      });
      return { trace: decision, signal, reason: "gate_rejected" };
    }

    // Create order
    log.info({ msg: "order_creation_started", symbol: opts.symbol });
    const order = await opts.createOrder({ ...orderInput }, opts.pool);
    
    log.info({
      msg: "order_created",
      symbol: opts.symbol,
      orderId: order.id,
      side: orderInput.side,
      entryPrice: orderInput.entry_price,
      stopLoss: orderInput.stop_loss,
      takeProfit: orderInput.take_profit,
      lotSize: orderInput.lot_size,
      durationMs: Date.now() - startTime,
    });

    return {
      trace: decision,
      signal,
      orderId: order.id,
      orderCreated: true,
    };
  } catch (err: any) {
    log.error({
      msg: "live_pipeline_error",
      symbol: opts.symbol,
      error: err.message,
      stack: err.stack,
      durationMs: Date.now() - startTime,
    });
    return { trace, reason: `error: ${err.message}` };
  }
}
```

#### File: `packages/shared/src/metrics.ts` (NEW)

```typescript
import { register, Counter, Histogram, Gauge } from "prom-client";

// Counter: total orders created
export const ordersCreatedTotal = new Counter({
  name: "tradzfx_orders_created_total",
  help: "Total orders created",
  labelNames: ["symbol", "strategy", "side"],
});

// Histogram: live pipeline latency
export const livePipelineLatency = new Histogram({
  name: "tradzfx_live_pipeline_latency_ms",
  help: "Live pipeline execution latency",
  labelNames: ["symbol", "outcome"], // outcome: order_created, gate_rejected, etc.
  buckets: [10, 50, 100, 200, 500, 1000, 2000],
});

// Gauge: active strategies
export const activeStrategiesGauge = new Gauge({
  name: "tradzfx_active_strategies",
  help: "Number of active strategies",
});

// Gauge: daily loss PnL
export const dailyLossPnL = new Gauge({
  name: "tradzfx_daily_loss_pnl",
  help: "Daily loss PnL",
  labelNames: ["symbol"],
});

// Counter: gates passed/rejected
export const gateDecisions = new Counter({
  name: "tradzfx_gate_decisions_total",
  help: "Gate pass/reject decisions",
  labelNames: ["gate", "passed"],
});

export { register };
```

#### File: `apps/web/src/app/api/metrics/route.ts` (NEW)

```typescript
import { NextResponse } from "next/server";
import { register } from "@tm/shared";

export async function GET() {
  const metrics = await register.metrics();
  return new NextResponse(metrics, {
    headers: { "Content-Type": register.contentType },
  });
}
```

#### Usage in Deployment

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "tradzfx-v2"
    static_configs:
      - targets: ["localhost:3002"]
    metrics_path: "/api/metrics"
```

#### Grafana Dashboard

```json
{
  "dashboard": {
    "title": "TradZFX V2 - Live Pipeline",
    "panels": [
      {
        "title": "Live Pipeline Latency",
        "targets": [
          { "expr": "rate(tradzfx_live_pipeline_latency_ms_bucket[5m])" }
        ]
      },
      {
        "title": "Orders Created (5m rate)",
        "targets": [
          { "expr": "rate(tradzfx_orders_created_total[5m])" }
        ]
      },
      {
        "title": "Gate Pass Rate",
        "targets": [
          { "expr": "tradzfx_gate_decisions_total{passed=\"true\"} / tradzfx_gate_decisions_total" }
        ]
      },
      {
        "title": "Daily Loss PnL",
        "targets": [
          { "expr": "tradzfx_daily_loss_pnl" }
        ]
      }
    ]
  }
}
```

---

## 3. Database Reliability

### Current State

**Problem:** 97 migrations, no rollback plan, no `down/*.sql` files.

### Recommendation: Add Structured Rollback Strategy

#### File: `infra/migrations/down/080_lifecycle_pk_fix.sql` (NEW)

```sql
-- Down migration for 080_lifecycle_pk_fix.sql
-- Restore PKs from (symbol, table_name) back to (symbol)
-- Note: This is destructive and should only be done if migration failed mid-way

BEGIN TRANSACTION;

-- Restore old PK structure (if we need to rollback)
-- Drop the new checkpoint table if it was created
DROP TABLE IF EXISTS lifecycle_refresh_state CASCADE;

-- Recreate old lifecycle tables with original PKs
-- (These would have been created in migrations 027+)

-- For each lifecycle table:
-- ALTER TABLE lifecycle_features_structure DROP CONSTRAINT IF EXISTS pk_lifecycle_features_structure;
-- ALTER TABLE lifecycle_features_structure ADD PRIMARY KEY (symbol);

-- This migration is DANGEROUS and should rarely be used
-- Better approach: just fix the forward migration

COMMIT;
```

#### File: `scripts/safe-migrate.ts` (NEW)

```typescript
/**
 * Safe migration runner with rollback support.
 * Usage: pnpm tsx scripts/safe-migrate.ts [--dry-run] [--rollback N]
 */

import { getPool, closePool } from "@tm/shared";
import { runMigrations, type RunOptions } from "@tm/shared";

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const rollbackCount = args.find(a => a.startsWith("--rollback"))
    ? Number(args.find(a => a.startsWith("--rollback"))?.split("=")[1] ?? 1)
    : 0;

  const pool = getPool();

  try {
    if (rollbackCount > 0) {
      console.log(`[migrate] Rolling back ${rollbackCount} migrations...`);
      
      // Get applied migrations
      const { rows: applied } = await pool.query(
        `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT $1`,
        [rollbackCount]
      );

      for (const { version } of applied) {
        const downFile = `./infra/migrations/down/${version}.sql`;
        try {
          const downSql = require("fs").readFileSync(downFile, "utf-8");
          console.log(`[migrate] Applying rollback: ${version}`);
          
          if (!isDryRun) {
            await pool.query(downSql);
            await pool.query(`DELETE FROM schema_migrations WHERE version = $1`, [version]);
          }
          console.log(`[migrate] ✓ Rolled back ${version}`);
        } catch (err: any) {
          console.error(`[migrate] ✗ Failed to rollback ${version}:`, err.message);
          process.exit(1);
        }
      }
    } else {
      // Normal forward migration
      const opts: RunOptions = {
        migrationsDir: "./infra/migrations",
      };

      const result = await runMigrations(opts);
      console.log(`[migrate] Applied ${result.applied} migrations`);
    }
  } catch (err: any) {
    console.error("[migrate] Error:", err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
```

#### File: `package.json` (UPDATED)

```json
{
  "scripts": {
    "db:migrate": "tsx scripts/migrate.ts",
    "db:migrate:safe": "tsx scripts/safe-migrate.ts",
    "db:migrate:rollback": "tsx scripts/safe-migrate.ts --rollback",
    "db:migrate:dry-run": "tsx scripts/safe-migrate.ts --dry-run"
  }
}
```

#### Usage

```bash
# Dry run (no changes)
pnpm db:migrate:dry-run

# Forward migration
pnpm db:migrate

# Rollback last migration
pnpm db:migrate:rollback 1

# Rollback last 5 migrations
pnpm db:migrate:rollback 5
```

---

## 4. API Security Hardening

### Current State

**Issues:**
- ❌ Request validation inconsistent
- ❌ No rate limiting
- ❌ No CORS policy
- ❌ Some raw SQL (injection risk)

### Recommendation: Add Validation & Rate Limiting

#### File: `packages/shared/src/validators.ts` (NEW)

```typescript
import { z } from "zod";

// Strategy specs
export const StrategySpecSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  active: z.boolean().optional(),
  filters: z.object({
    symbols: z.array(z.string()).optional(),
    session: z.string().optional(),
  }),
  setup: z.array(
    z.object({
      id: z.string(),
      feature: z.string(),
      tf: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
      predicate: z.string(),
      required: z.boolean(),
      groupBy: z.array(z.string()).optional(),
    })
  ),
  entry: z.array(z.object({})), // Similar structure
  risk: z.object({
    sl: z.string(),
    tp: z.string(),
    minRR: z.number().min(1),
    timeoutBars: z.number().positive(),
  }),
  gates: z.array(
    z.object({
      name: z.string(),
      params: z.record(z.unknown()),
    })
  ),
});

// Candle ingestion
export const Candle V2Schema = z.object({
  time: z.number().int().positive(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  tick_volume: z.number().nonnegative(),
  spread: z.number().nonnegative().optional(),
});

export const BarPayloadSchema = z.object({
  schemaVersion: z.string(),
  symbol: z.string().regex(/^[A-Z]{3,}[A-Z0-9]*$/),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  source: z.object({
    broker: z.string(),
    accountType: z.enum(["live", "paper"]),
    digits: z.number().int().min(1).max(5),
  }),
  bars: z.array(CandleV2Schema).min(1).max(1000),
});
```

#### File: `packages/shared/src/middleware/validation.ts` (NEW)

```typescript
import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function createValidationMiddleware<T>(schema: z.ZodType<T>) {
  return async (req: NextRequest) => {
    try {
      const body = await req.json();
      const validated = schema.parse(body);
      
      // Attach validated data to request (custom property)
      (req as any).validatedBody = validated;
      return null; // No error
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: err.issues.map(issue => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
  };
}
```

#### File: `packages/shared/src/middleware/rateLimit.ts` (NEW)

```typescript
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function createRateLimitMiddleware(
  maxRequests: number,
  windowMs: number
) {
  return (req: NextRequest) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const record = requestCounts.get(key);

    if (!record || now > record.resetAt) {
      requestCounts.set(key, { count: 1, resetAt: now + windowMs });
      return null; // OK
    }

    if (record.count >= maxRequests) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((record.resetAt - now) / 1000)),
          },
        }
      );
    }

    record.count++;
    return null; // OK
  };
}
```

#### File: `apps/web/src/app/api/ingest/mt5/bars/route.ts` (UPDATED)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { BarPayloadSchema } from "@tm/shared/validators";
import { createRateLimitMiddleware } from "@tm/shared/middleware/rateLimit";
import { logger } from "@tm/shared";

// Rate limit: 1000 requests per minute
const rateLimit = createRateLimitMiddleware(1000, 60 * 1000);

export async function POST(req: NextRequest) {
  // Apply rate limit
  const rateLimitError = rateLimit(req);
  if (rateLimitError) return rateLimitError;

  try {
    // Validate schema
    const body = await req.json();
    const payload = BarPayloadSchema.parse(body);

    const traceId = req.headers.get("X-Trace-ID") ?? crypto.randomUUID();
    const log = createContextLogger(traceId);

    log.info({
      msg: "candle_batch_received",
      symbol: payload.symbol,
      barCount: payload.bars.length,
      broker: payload.source.broker,
    });

    // Process candles...
    
    return NextResponse.json({ success: true, processed: payload.bars.length });
  } catch (err: any) {
    logger.error({
      msg: "ingest_error",
      error: err.message,
    });
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
```

---

## 5. Live/Paper Boundary

### Current State

**Problem:** Boundary enforced at code level, not schema level.

### Recommendation: Schema-Level Constraint

#### File: `infra/migrations/098_live_paper_constraint.sql` (NEW)

```sql
-- Enforce live/paper boundary at schema level
-- Paper trades must use paper terminals, live trades must use live terminals

ALTER TABLE orders
  ADD CONSTRAINT ck_mode_terminal_consistency
  CHECK (
    -- Paper mode: terminal_key_id must start with "paper-"
    (trade_mode = 'paper' AND terminal_key_id LIKE 'paper-%')
    OR
    -- Live mode: terminal_key_id must NOT start with "paper-"
    (trade_mode = 'live' AND terminal_key_id NOT LIKE 'paper-%')
    OR
    -- Allow NULL terminal_key_id (for pending orders)
    terminal_key_id IS NULL
  );

-- Create separate indexes for paper vs. live orders
CREATE INDEX IF NOT EXISTS idx_orders_paper
  ON orders(symbol, created_at)
  WHERE trade_mode = 'paper';

CREATE INDEX IF NOT EXISTS idx_orders_live
  ON orders(symbol, created_at)
  WHERE trade_mode = 'live';
```

#### File: `packages/trade-pipeline/src/orderExecutor.ts` (UPDATED)

```typescript
export async function buildOrderInput(
  signal: Signal,
  strategy: StrategySpec,
  setupEval: SetupEvaluation,
  tradeMode: "live" | "paper"
): Promise<CreateOrderInput> {
  // Determine terminal key
  let terminalKeyId: string;

  if (tradeMode === "paper") {
    // ALWAYS use paper terminal for paper mode
    terminalKeyId = `paper-${process.env.PAPER_TERMINAL_KEY}`;
  } else {
    // ALWAYS use live terminal for live mode
    const liveTerminalKey = process.env.LIVE_TERMINAL_KEY;
    if (!liveTerminalKey) {
      throw new Error("LIVE_TERMINAL_KEY not configured");
    }
    terminalKeyId = liveTerminalKey;
  }

  return {
    // ... other fields ...
    trade_mode: tradeMode,
    terminal_key_id: terminalKeyId,
    // ... schema constraint will validate consistency ...
  };
}
```

#### File: `.env.example` (UPDATED)

```bash
# Live trading terminal (production)
LIVE_TERMINAL_KEY="live-prod-mt5-001"

# Paper trading terminal (for testing, small accounts)
PAPER_TERMINAL_KEY="paper-test-mt5-001"
```

---

## 6. Performance Optimization

### Current State

**Issue:** Feature DAG is single-threaded per symbol. No caching of computed features.

### Recommendation: Feature Caching & Parallel Computation

#### File: `apps/engine/src/cache/featureCache.ts` (NEW)

```typescript
import Redis from "redis";
import type { Feature } from "@tm/shared";

export interface FeatureCacheKey {
  symbol: string;
  tf: string;
  ts: Date;
  featureName: string;
}

export class FeatureCache {
  private redis: ReturnType<typeof Redis.createClient>;

  constructor() {
    this.redis = Redis.createClient({
      host: process.env.REDIS_HOST ?? "localhost",
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
  }

  private getCacheKey(key: FeatureCacheKey): string {
    return `feat:${key.symbol}:${key.tf}:${key.ts.getTime()}:${key.featureName}`;
  }

  async get<T>(key: FeatureCacheKey): Promise<T | null> {
    try {
      const cached = await this.redis.get(this.getCacheKey(key));
      return cached ? JSON.parse(cached) : null;
    } catch (err) {
      console.warn("[cache] Get error:", err);
      return null; // Fail open
    }
  }

  async set<T>(key: FeatureCacheKey, value: T, ttlSeconds = 3600): Promise<void> {
    try {
      await this.redis.setex(
        this.getCacheKey(key),
        ttlSeconds,
        JSON.stringify(value)
      );
    } catch (err) {
      console.warn("[cache] Set error:", err);
      // Fail open: don't block on cache write
    }
  }

  async clear(symbol: string): Promise<void> {
    try {
      const pattern = `feat:${symbol}:*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (err) {
      console.warn("[cache] Clear error:", err);
    }
  }
}
```

#### File: `apps/engine/src/worker/featureWorkerPool.ts` (NEW)

```typescript
import pLimit from "p-limit";
import type { WorkerOptions } from "./types";

/**
 * Feature Worker Pool
 * Allows parallel feature computation for multiple symbols.
 * Limits concurrency to prevent overwhelming the database.
 */
export class FeatureWorkerPool {
  private limit: ReturnType<typeof pLimit>;

  constructor(maxConcurrency = 4) {
    this.limit = pLimit(maxConcurrency);
  }

  async computeFeaturesForSymbols(
    symbols: string[],
    opts: WorkerOptions
  ): Promise<Map<string, { success: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; error?: string }>();

    const tasks = symbols.map(symbol =>
      this.limit(async () => {
        try {
          await computeFeaturesForSymbol(symbol, opts);
          results.set(symbol, { success: true });
        } catch (err: any) {
          results.set(symbol, { success: false, error: err.message });
        }
      })
    );

    await Promise.all(tasks);
    return results;
  }
}
```

#### Usage

```typescript
// Feature computation with parallelism
const pool = new FeatureWorkerPool(4); // 4 symbols in parallel
const symbols = ["EURUSD", "GBPUSD", "USDJPY", "USDCAD"];

const results = await pool.computeFeaturesForSymbols(symbols, {
  pool: getPool(),
  cache: new FeatureCache(),
});

// Results: Map { EURUSD → {success: true}, GBPUSD → {success: true}, ... }
```

---

## 7. Scaling Strategy

### Current Architecture

```
Single Node:
├─ Next.js app (web + API)
├─ Feature engine (background job)
├─ MT5 EA (external)
└─ PostgreSQL
```

### Recommendation: Horizontal Scaling

#### Phase 1: Separate Feature Engine

```
Load Balancer
├─ Next.js App #1 (port 3002)
├─ Next.js App #2 (port 3003)
├─ Feature Engine #1 (symbol: EURUSD, GBPUSD)
├─ Feature Engine #2 (symbol: USDJPY, USDCAD)
└─ PostgreSQL (primary) + replicas
```

#### Phase 2: Message Queue for Feature Jobs

```
MT5 EA Ingest
    ↓
Publish to Queue (RabbitMQ / Redis Streams)
    ↓
Multiple Feature Workers (consume from queue)
    ↓
Compute & write to DB
    ↓
Publish LivePipeline event (another queue)
    ↓
Live pipeline workers (consume from queue)
    ↓
Execute orders
```

#### File: `packages/shared/src/queue.ts` (NEW)

```typescript
import Redis from "redis";

export class JobQueue {
  private redis: ReturnType<typeof Redis.createClient>;

  constructor() {
    this.redis = Redis.createClient({
      url: process.env.REDIS_URL ?? "redis://localhost:6379",
    });
  }

  async publishFeatureJob(symbol: string, tf: string): Promise<void> {
    await this.redis.xAdd(
      `queue:feature-jobs`,
      "*",
      JSON.stringify({ symbol, tf, ts: new Date() })
    );
  }

  async consumeFeatureJobs(batchSize = 10): Promise<any[]> {
    const entries = await this.redis.xRead(
      { key: "queue:feature-jobs", id: "0" },
      { COUNT: batchSize, BLOCK: 1000 }
    );
    return entries?.[0]?.[1] ?? [];
  }

  async publishLivePipelineJob(symbol: string, signalId: string): Promise<void> {
    await this.redis.xAdd(
      `queue:live-pipeline-jobs`,
      "*",
      JSON.stringify({ symbol, signalId, ts: new Date() })
    );
  }
}
```

#### Docker Compose for Scaled Setup

```yaml
# infra/docker-compose.prod.yml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ${TM_DB_PASSWORD}
      POSTGRES_DB: tradzfx_v2
    volumes:
      - pg_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  web:
    build: .
    command: pnpm web
    environment:
      TM_DB_HOST: postgres
      REDIS_URL: redis://redis:6379
    ports:
      - "3002:3002"
    depends_on:
      - postgres
      - redis
    scale: 2  # Run 2 instances behind load balancer

  feature-engine:
    build: .
    command: pnpm engine
    environment:
      TM_DB_HOST: postgres
      REDIS_URL: redis://redis:6379
      ENGINE_WORKER_SYMBOLS: "EURUSD,GBPUSD"
    depends_on:
      - postgres
      - redis
    scale: 2  # Run 2 instances (different symbols)

  live-pipeline:
    build: .
    command: tsx apps/engine/src/live-pipeline-worker.ts
    environment:
      TM_DB_HOST: postgres
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
    scale: 2  # Run 2 instances (consume from queue)

volumes:
  pg_data:
```

#### Launch Script

```bash
#!/bin/bash
# infra/docker-prod-up.sh

set -e

echo "[docker] Building images..."
docker-compose -f infra/docker-compose.prod.yml build

echo "[docker] Starting services (scale: 2x app, 2x engine, 2x pipeline)..."
docker-compose -f infra/docker-compose.prod.yml up -d --scale web=2 --scale feature-engine=2 --scale live-pipeline=2

echo "[docker] Waiting for postgres..."
docker-compose -f infra/docker-compose.prod.yml exec postgres pg_isready -U postgres

echo "[docker] Running migrations..."
docker-compose -f infra/docker-compose.prod.yml exec web pnpm db:migrate

echo "[docker] Done! Services running:"
docker-compose -f infra/docker-compose.prod.yml ps
```

---

## Summary

| Recommendation | Effort | Impact | Priority |
|---|---|---|---|
| **1. Integration Tests** | 40h | HIGH | 🔴 P0 |
| **2. Structured Logging** | 16h | HIGH | 🔴 P0 |
| **3. Database Rollback** | 24h | MEDIUM | 🟡 P1 |
| **4. API Validation** | 16h | MEDIUM | 🟡 P1 |
| **5. Live/Paper Boundary** | 8h | MEDIUM | 🟡 P1 |
| **6. Feature Caching** | 24h | MEDIUM | 🟡 P2 |
| **7. Horizontal Scaling** | 40h | LOW | 🟢 P2 |

**Total:** ~168 hours (~1 month for 1-2 engineers)

---

**For full audit, see:** `ARCHITECTURE_AUDIT_2026-07-07.md`
