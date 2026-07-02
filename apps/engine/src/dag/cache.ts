/**
 * Content-addressed hybrid feature cache.
 *
 * Tiering (fast → slow):
 *   1. In-process LRU
 *   2. Redis (optional)
 *   3. PostgreSQL feature_cache.output_jsonb
 *
 * Redis is fail-open: if it is unavailable, the cache falls back to PostgreSQL.
 */

import type { Pool } from "@tm/shared";
import type { CacheEntry } from "@tm/shared";
import { getRedisClient } from "@tm/shared";

const DEFAULT_REDIS_TTL_SECONDS = 86_400; // 24h

function getRedisTtlSeconds(): number {
  const env = process.env.TM_FEATURE_CACHE_TTL_SECONDS;
  if (!env) return DEFAULT_REDIS_TTL_SECONDS;
  const n = parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REDIS_TTL_SECONDS;
}

/** In-memory LRU for hot features */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const v = this.cache.get(key);
    if (v !== undefined) {
      // Touch
      this.cache.delete(key);
      this.cache.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, value);
  }
}

const memoryCache = new LRUCache<string, unknown>(10_000);

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return { __type: "Date", iso: value.toISOString() };
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).__type === "Date" &&
    typeof (value as Record<string, unknown>).iso === "string"
  ) {
    return new Date((value as Record<string, unknown>).iso as string);
  }
  return value;
}

function serializeOutput(output: unknown): string {
  return JSON.stringify(output, replacer);
}

function deserializeOutput(raw: string): unknown {
  return JSON.parse(raw, reviver);
}

export class FeatureCache {
  constructor(private pool: Pool) {}

  async get(featureName: string, inputHash: string): Promise<unknown | null> {
    const memKey = `${featureName}:${inputHash}`;
    const mem = memoryCache.get(memKey);
    if (mem !== undefined) return mem;

    // Try Redis
    const redis = await getRedisClient();
    const redisKey = `tm:feature:${featureName}:${inputHash}`;
    if (redis) {
      try {
        const raw = await redis.get(redisKey);
        if (raw) {
          const parsed = deserializeOutput(raw);
          memoryCache.set(memKey, parsed);
          return parsed;
        }
      } catch (err: any) {
        console.warn(`[FeatureCache] Redis get failed for ${featureName}:`, err.message);
      }
    }

    // Try PostgreSQL as durable backing store
    try {
      const { rows } = await this.pool.query<CacheEntry & { output_jsonb: unknown }>(
        `SELECT output_jsonb, output_hash FROM feature_cache
         WHERE feature_name = $1 AND input_hash = $2 AND output_jsonb IS NOT NULL`,
        [featureName, inputHash]
      );
      if (rows.length > 0 && rows[0].output_jsonb != null) {
        const output = rows[0].output_jsonb;
        memoryCache.set(memKey, output);
        // Backfill Redis if it is available
        if (redis) {
          try {
            await redis.setEx(redisKey, getRedisTtlSeconds(), serializeOutput(output));
          } catch (err: any) {
            console.warn(`[FeatureCache] Redis set failed for ${featureName}:`, err.message);
          }
        }
        return output;
      }
    } catch (err: any) {
      console.warn(`[FeatureCache] DB lookup failed for ${featureName}:`, err.message);
    }

    return null;
  }

  async set(
    featureName: string,
    inputHash: string,
    output: unknown,
    outputHash: string
  ): Promise<void> {
    const memKey = `${featureName}:${inputHash}`;
    memoryCache.set(memKey, output);

    const redis = await getRedisClient();
    const redisKey = `tm:feature:${featureName}:${inputHash}`;
    if (redis) {
      try {
        await redis.setEx(redisKey, getRedisTtlSeconds(), serializeOutput(output));
      } catch (err: any) {
        console.warn(`[FeatureCache] Redis set failed for ${featureName}:`, err.message);
      }
    }

    try {
      await this.pool.query(
        `INSERT INTO feature_cache (feature_name, input_hash, output_hash, output_jsonb)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (feature_name, input_hash) DO UPDATE SET
           output_hash = EXCLUDED.output_hash,
           output_jsonb = EXCLUDED.output_jsonb,
           created_at = NOW()`,
        [featureName, inputHash, outputHash, JSON.stringify(output)]
      );
    } catch (err: any) {
      console.warn(`[FeatureCache] DB write failed for ${featureName}:`, err.message);
    }
  }
}
