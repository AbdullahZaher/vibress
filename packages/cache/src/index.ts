import Redis, { type RedisOptions } from "ioredis";
import { getConfig } from "@vibress/config";

let redisClient: Redis | null = null;
let bullMqClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    const redisUrl = getConfig().redis.url;

    const options: RedisOptions = {
      retryStrategy(times) {
        // Linear backoff maxing at 2s
        return Math.min(times * 100, 2000);
      },
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: false,
    };

    redisClient = new Redis(redisUrl, options);

    redisClient.on("error", (err) => {
      console.error("Redis Client Error:", err.message);
    });
  }
  return redisClient;
};

/**
 * Redis connection for BullMQ. BullMQ requires maxRetriesPerRequest: null
 * and its own dedicated connection.
 */
export const getBullMqRedisConnection = (): Redis => {
  if (!bullMqClient) {
    const redisUrl = getConfig().redis.url;

    const options: RedisOptions = {
      retryStrategy(times) {
        return Math.min(times * 100, 2000);
      },
      maxRetriesPerRequest: null,
      connectTimeout: 5000,
      lazyConnect: false,
    };

    bullMqClient = new Redis(redisUrl, options);

    bullMqClient.on("error", (err) => {
      console.error("BullMQ Redis Client Error:", err.message);
    });
  }
  return bullMqClient;
};

export const closeRedisClient = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  if (bullMqClient) {
    await bullMqClient.quit();
    bullMqClient = null;
  }
};

/**
 * Generates a strictly publication-isolated cache key.
 * Pattern: `pub:${publicationId}:${domain}:${key}`
 * Throws if publicationId is missing or empty to prevent cross-tenant key pollution.
 */
export function buildPublicationCacheKey(
  publicationId: string,
  domain: string,
  key: string,
): string {
  if (!publicationId || !publicationId.trim()) {
    throw new Error("Cannot build publication cache key without a valid publicationId");
  }
  return `pub:${publicationId}:${domain}:${key}`;
}

/**
 * Generates a system-scoped cache key.
 * Pattern: `sys:${domain}:${key}`
 */
export function buildSystemCacheKey(domain: string, key: string): string {
  return `sys:${domain}:${key}`;
}
