/**
 * Content-addressed feature cache.
 * Checks TimescaleDB feature_cache table and in-memory LRU.
 */

import type { Pool } from "@tm/shared";
import type { CacheEntry } from "@tm/shared";

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

export class FeatureCache {
  constructor(private pool: Pool) {}

  async get(featureName: string, inputHash: string): Promise<unknown | null> {
    const memKey = `${featureName}:${inputHash}`;
    const mem = memoryCache.get(memKey);
    if (mem !== undefined) return mem;

    const { rows } = await this.pool.query(
      `SELECT output_hash FROM feature_cache WHERE feature_name = $1 AND input_hash = $2`,
      [featureName, inputHash]
    );

    if (rows.length === 0) return null;

    // For now, we only cache the hit/miss. Full output caching would need a KV store.
    // The DB schema stores output_hash for integrity, not the full output.
    return null; // Cache miss — recompute
  }

  async set(
    featureName: string,
    inputHash: string,
    outputHash: string
  ): Promise<void> {
    const memKey = `${featureName}:${inputHash}`;
    memoryCache.set(memKey, true);

    await this.pool.query(
      `INSERT INTO feature_cache (feature_name, input_hash, output_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (feature_name, input_hash) DO UPDATE SET
         output_hash = EXCLUDED.output_hash,
         created_at = NOW()`,
      [featureName, inputHash, outputHash]
    );
  }
}
