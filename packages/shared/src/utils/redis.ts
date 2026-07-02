/**
 * Redis client wrapper.
 *
 * Redis is treated as an optional performance layer: if TM_REDIS_URL is not set
 * or the server is unreachable, callers fall back to PostgreSQL. This keeps the
 * platform usable in local/test environments without Redis.
 */

import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connecting: Promise<RedisClient | null> | null = null;
let connectFailed = false;

export function getRedisUrl(): string | undefined {
  return process.env.TM_REDIS_URL;
}

/**
 * Return a connected Redis client, or null if Redis is not configured/available.
 * The first call connects lazily; subsequent calls reuse the same client.
 */
export async function getRedisClient(): Promise<RedisClient | null> {
  const url = getRedisUrl();
  if (!url) {
    return null;
  }

  if (client?.isOpen) {
    return client;
  }

  if (connectFailed) {
    return null;
  }

  if (connecting) {
    return connecting;
  }

  connecting = (async () => {
    try {
      const c = createClient({ url });
      c.on("error", (err) => {
        // Suppress repeated error noise; callers will fallback to DB.
        if (!connectFailed) {
          console.warn("[redis] client error:", err.message);
        }
      });
      await c.connect();
      client = c;
      return c;
    } catch (err: any) {
      console.warn("[redis] unable to connect:", err.message);
      connectFailed = true;
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/**
 * Close the Redis connection. Useful for graceful shutdown in tests/cli tools.
 */
export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
  connectFailed = false;
  connecting = null;
}
