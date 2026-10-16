import { getRedisClient, buildSystemCacheKey } from "@vibress/cache";
import { appLogger } from "../observability";

export type ThrottleScope =
  | "staff_login"
  | "member_request"
  | "member_verify";

export interface ThrottleCheckOptions {
  maxAttempts?: number;
  failClosed?: boolean;
}

export interface ThrottleRecordOptions {
  maxAttempts?: number;
  windowSeconds?: number;
  lockoutTtlSeconds?: number;
}

export interface ThrottleCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class AccountThrottleUnavailableError extends Error {
  code = "SERVICE_UNAVAILABLE";
  statusCode = 503;

  constructor(
    message = "Authentication service temporarily unavailable. Please try again later.",
  ) {
    super(message);
    this.name = "AccountThrottleUnavailableError";
  }
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_SECONDS = 900; // 15 minutes window
const DEFAULT_LOCKOUT_SECONDS = 900; // 15 minutes temporary lockout

function resolveThrottleKey(scope: ThrottleScope, identifier: string): string {
  const normalized = identifier.trim().toLowerCase();
  return buildSystemCacheKey("auth_throttle", `${scope}:${normalized}`);
}

/**
 * Checks whether an account-level identifier has exceeded its failure threshold.
 * If failClosed is true and Redis is unreachable, throws AccountThrottleUnavailableError.
 */
export async function checkAccountThrottle(
  scope: ThrottleScope,
  identifier: string,
  options?: ThrottleCheckOptions,
): Promise<ThrottleCheckResult> {
  if (!identifier || !identifier.trim()) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const failClosed = options?.failClosed ?? false;
  const key = resolveThrottleKey(scope, identifier);

  try {
    const redis = getRedisClient();
    const rawVal = await redis.get(key);
    if (!rawVal) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const count = Number.parseInt(rawVal, 10);
    if (count >= maxAttempts) {
      const ttl = await redis.ttl(key);
      const retryAfterSeconds = Math.max(ttl, 1);
      return { allowed: false, retryAfterSeconds };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  } catch (err: unknown) {
    appLogger.error(
      "Account throttle check failed: Redis cache store is unavailable",
      {
        scope,
        identifier: identifier.trim().toLowerCase(),
        failClosed,
      },
      err instanceof Error ? err : undefined,
    );

    if (failClosed) {
      throw new AccountThrottleUnavailableError();
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Records a failed attempt for the identifier. Increments failure counter and
 * establishes the rolling window or triggers lockout TTL.
 */
export async function recordAccountFailure(
  scope: ThrottleScope,
  identifier: string,
  options?: ThrottleRecordOptions,
): Promise<number> {
  if (!identifier || !identifier.trim()) {
    return 0;
  }

  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowSeconds = options?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const lockoutTtlSeconds =
    options?.lockoutTtlSeconds ?? DEFAULT_LOCKOUT_SECONDS;
  const key = resolveThrottleKey(scope, identifier);

  try {
    const redis = getRedisClient();
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, windowSeconds);
    } else if (count >= maxAttempts) {
      // Exponential or temporary lockout: enforce lockout TTL
      await redis.expire(key, lockoutTtlSeconds);
    }

    return count;
  } catch (err: unknown) {
    appLogger.warn(
      "Failed to record account failure in Redis",
      {
        scope,
        identifier: identifier.trim().toLowerCase(),
      },
      err instanceof Error ? err : undefined,
    );
    return 0;
  }
}

/**
 * Resets the failure counter on successful authentication.
 */
export async function resetAccountThrottle(
  scope: ThrottleScope,
  identifier: string,
): Promise<void> {
  if (!identifier || !identifier.trim()) {
    return;
  }

  const key = resolveThrottleKey(scope, identifier);

  try {
    const redis = getRedisClient();
    await redis.del(key);
  } catch (err: unknown) {
    appLogger.warn(
      "Failed to reset account throttle in Redis",
      {
        scope,
        identifier: identifier.trim().toLowerCase(),
      },
      err instanceof Error ? err : undefined,
    );
  }
}
