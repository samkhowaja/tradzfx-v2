import { describe, it, expect, beforeEach } from "vitest";
import type { Pool } from "@tm/shared";
import {
  buildIdempotencyKey,
  isEventProcessed,
  markEventProcessed,
} from "./eaEventIdempotency";

function createMockPool(): Pool {
  const rows: Map<string, { order_id: string; event_type: string }> = new Map();
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (/SELECT/i.test(sql)) {
        const key = params?.[0] as string;
        return { rows: rows.has(key) ? [{ key }] : [], rowCount: rows.has(key) ? 1 : 0 };
      }
      if (/INSERT/i.test(sql)) {
        const [key, orderId, eventType] = params as [string, string, string];
        if (rows.has(key)) {
          const err = new Error("duplicate key value violates unique constraint") as Error & { code: string };
          err.code = "23505";
          throw err;
        }
        rows.set(key, { order_id: orderId, event_type: eventType });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    connect: () => {
      throw new Error("not implemented");
    },
    end: () => Promise.resolve(),
    on: () => {},
    removeListener: () => {},
  } as unknown as Pool;
}

describe("eaEventIdempotency", () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createMockPool();
  });

  it("builds a deterministic key", () => {
    const key = buildIdempotencyKey("fill", "sig-1", 12345, 1.234567);
    expect(key).toBe("fill:sig-1:12345:1.234567");
  });

  it("reports unprocessed keys as not processed", async () => {
    const result = await isEventProcessed(pool, "nonexistent-key");
    expect(result).toBe(false);
  });

  it("marks a key as processed and returns true on first insert", async () => {
    const result = await markEventProcessed(pool, "key-1", "order-1", "fill");
    expect(result).toBe(true);
    expect(await isEventProcessed(pool, "key-1")).toBe(true);
  });

  it("returns false when marking a duplicate key", async () => {
    await markEventProcessed(pool, "key-dup", "order-1", "fill");
    const result = await markEventProcessed(pool, "key-dup", "order-1", "fill");
    expect(result).toBe(false);
  });

  it("keeps keys independent", async () => {
    await markEventProcessed(pool, "key-a", "order-a", "close");
    expect(await isEventProcessed(pool, "key-a")).toBe(true);
    expect(await isEventProcessed(pool, "key-b")).toBe(false);
  });
});
