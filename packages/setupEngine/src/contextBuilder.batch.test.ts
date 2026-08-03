import { describe, it, expect } from "vitest";
import { buildContextBatch } from "./contextBuilder";
import type { Queryable } from "@tm/shared";

/**
 * Regression tests for the batched setup-engine context builder used by the
 * PIT backtest. The strong fix (Phase 3) replaced ~9 per-signal queries with
 * ~9 per-(symbol,tf) queries keyed by as-of buckets. These tests pin the
 * contract with a fake pool so the batch path cannot silently drift back to
 * per-signal behaviour or lose the canonical 1m price fallback.
 */

function makeFakePool(asOfs: Date[]): Queryable {
  return {
    async query(sql: string, params: unknown[]) {
      const buckets = (params[0] as Date[]) ?? asOfs;
      const perBucket = (row: (as_of: Date) => Record<string, unknown>) =>
        buckets.map((as_of) => ({ as_of, ...row(as_of) }));

      let rows: Record<string, unknown>[] = [];
      if (sql.includes("FROM market.candles_1m_canonical")) {
        // Governed dense 1m price series. Close = 2000 for every bucket;
        // missing broker policy fails closed instead of mixing raw sources.
        rows = perBucket((as_of) => ({
          ts: as_of,
          o: 1999,
          h: 2001,
          l: 1998,
          c: 2000,
          v: 100,
        }));
      } else if (sql.includes("FROM features_htf_bias")) {
        rows = perBucket(() => ({
          direction: "bullish",
          confidence: 0.7,
          state: "OK",
          score: 1,
          reason: "trend",
          by_time_frame: null,
          trading_tf: "5m",
          local_agreement: null,
        }));
      } else if (sql.includes("FROM features_bias")) {
        rows = perBucket(() => ({
          direction: "bullish",
          confidence: 0.8,
          reason: "ltf",
        }));
      } else if (sql.includes("FROM features_pricing")) {
        rows = perBucket(() => ({
          position: "discount",
          in_ote: true,
          ote_low: 1990,
          ote_high: 2010,
          dynamic_ote_low: 1992,
          dynamic_ote_high: 2008,
          dynamic_ote_mid: 2000,
          dynamic_ote_source: "swing",
          dynamic_ote_quality: 0.9,
          premium_discount_score: 0.6,
        }));
      } else if (sql.includes("FROM public.canonical_zones_as_of")) {
        // One canonical demand zone per bucket, sitting just below price
        // (within 1.5 ATR). Query must carry shared max-age parameter.
        expect(params[3]).toBeTypeOf("number");
        rows = perBucket(() => ({
          zone_kind: "demand",
          direction: "long",
          top: 1999,
          bottom: 1998,
          fill_pct: 0,
          tapped: false,
        }));
      } else if (sql.includes("FROM features_structure")) {
        rows = [];
      } else if (sql.includes("FROM features_atr")) {
        // value=1.5 price units → 15 pips on XAUUSD (pipSize 0.1).
        rows = perBucket(() => ({ value: 1.5, period: 14 }));
      } else if (sql.includes("FROM features_session")) {
        rows = perBucket(() => ({ session: "LONDON" }));
      }
      return { rows } as any;
    },
  } as unknown as Queryable;
}

describe("buildContextBatch", () => {
  it("returns one context per as-of bucket, in order", async () => {
    const asOfs = [
      new Date("2026-06-01T10:00:00Z"),
      new Date("2026-06-02T11:30:00Z"),
      new Date("2026-06-03T14:15:00Z"),
    ];
    const pool = makeFakePool(asOfs);
    const contexts = await buildContextBatch(pool, "XAUUSD", "5m", asOfs, {
      directions: ["long", "long", "long"],
    });

    expect(contexts).toHaveLength(3);
    expect(contexts.map((c) => c.asOf.toISOString())).toEqual(
      asOfs.map((d) => d.toISOString())
    );
  });

  it("resolves latest close from canonical candles_1m (PIT price fallback)", async () => {
    const asOfs = [new Date("2026-06-01T10:00:00Z")];
    const pool = makeFakePool(asOfs);
    const [ctx] = await buildContextBatch(pool, "XAUUSD", "5m", asOfs, {
      directions: ["long"],
    });

    // Regression guard: sparse HTF tables must not leave latestCandle null,
    // and raw multi-broker candles must not become a fallback.
    expect(ctx.latestCandle).not.toBeNull();
    expect(ctx.latestCandle?.c).toBe(2000);
  });

  it("derives an entry zone within 1.5 ATR of the current price", async () => {
    const asOfs = [new Date("2026-06-01T10:00:00Z")];
    const pool = makeFakePool(asOfs);
    const [ctx] = await buildContextBatch(pool, "XAUUSD", "5m", asOfs, {
      directions: ["long"],
    });

    expect(ctx.bias?.direction).toBe("long");
    expect(ctx.zones).toHaveLength(1);
    expect(ctx.entryZone).not.toBeNull();
    expect(ctx.entryZone?.zoneType).toBe("demand");
    expect(ctx.atr).toBeCloseTo(1.5);
    expect(ctx.maxAllowedSpreadPips).toBeGreaterThanOrEqual(3);
  });
});
