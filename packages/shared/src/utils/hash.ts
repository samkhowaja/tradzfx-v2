/**
 * Content-addressed hashing for feature cache.
 * Uses SHA-256 for deterministic, collision-resistant hashes.
 */

import { createHash } from "crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

/** Hash a sorted object for consistent cache keys */
export function hashObject(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
  return sha256(JSON.stringify(sorted));
}
