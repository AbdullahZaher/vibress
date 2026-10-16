import { getRedisClient, buildSystemCacheKey } from "@vibress/cache";
import { appLogger } from "../observability";

export type ThrottleScope =
  | "staff_login"
  | "staff_login_global"
  | "member_request"
  | "member_verify";

export interface ThrottleCheckOptions {
  clientIp?: string;
  maxAttempts?: number;
  globalMaxAttempts?: number;
  failClosed?: boolean;
}

export interface ThrottleRecordOptions {
  clientIp?: string;
  maxAttempts?: number;
  windowSeconds?: number;
  lockoutTtlSeconds?: number;
}

export interface ThrottleResetOptions {
  clientIp?: string;
}

export interface ThrottleCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  progressiveDelayMs?: number;
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
const DEFAULT_GLOBAL_MAX_ATTEMPTS = 20;
const DEFAULT_WINDOW_SECONDS = 900; // 15 minutes window
const DEFAULT_LOCKOUT_SECONDS = 900; // 15 minutes temporary lockout

export function normalizeClientSubnet(ip: string): string {
  const cleanIp = (ip || "").trim().toLowerCase();
  if (!cleanIp) return "unknown";

  // IPv4 or IPv4-mapped IPv6 (e.g. ::ffff:192.0.2.1)
  const ipv4Match = cleanIp.match(
    /(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/,
  );
  if (ipv4Match) {
    return `${ipv4Match[1]}.0/24`;
  }

  // IPv6 (/64 subnet)
  if (cleanIp.includes(":")) {
    const parts = cleanIp.split(":");
    const prefix = parts.slice(0, 4).join(":");
    return `${prefix}::/64`;
  }

  return cleanIp;
}

function resolveThrottleKey(
  scope: ThrottleScope,
  identifier: string,
  clientIp?: string,
): string {
  const normalized = identifier.trim().toLowerCase();
  if (scope === "staff_login" && clientIp) {
    const subnet = normalizeClientSubnet(clientIp);
    return buildSystemCacheKey(
      "auth_throttle",
      `staff_login:${normalized}:${subnet}`,
    );
  }
  return buildSystemCacheKey("auth_throttle", `${scope}:${normalized}`);
}

/**
 * Checks whether an account-level identifier has exceeded its failure threshold.
 * Keys hard lockout by (email + client IP/subnet), preventing malicious lockout of legitimate users.
 * High-volume attacks from rotating IPs trigger progressive delay instead of a hard denial-of-service.
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
  const clientIp = options?.clientIp;

  try {
    const redis = getRedisClient();

    // 1. Check IP/subnet-scoped compound lockout
    const ipKey = resolveThrottleKey(scope, identifier, clientIp);
    const rawVal = await redis.get(ipKey);
    if (rawVal) {
      const count = Number.parseInt(rawVal, 10);
      if (count >= maxAttempts) {
        const ttl = await redis.ttl(ipKey);
        const retryAfterSeconds = Math.max(ttl, 1);
        return { allowed: false, retryAfterSeconds };
      }
    }

    // 2. Global per-email ceiling: progressive delay instead of hard lockout
    if (scope === "staff_login") {
      const globalKey = buildSystemCacheKey(
        "auth_throttle",
        `staff_login_global:${identifier.trim().toLowerCase()}`,
      );
      const rawGlobalVal = await redis.get(globalKey);
      if (rawGlobalVal) {
        const globalCount = Number.parseInt(rawGlobalVal, 10);
        const globalMaxAttempts =
          options?.globalMaxAttempts ?? DEFAULT_GLOBAL_MAX_ATTEMPTS;
        if (globalCount >= globalMaxAttempts) {
          const delayMultiplier = Math.min(
            globalCount - globalMaxAttempts + 1,
            10,
          );
          const progressiveDelayMs = Math.min(2000, 100 * delayMultiplier);
          if (progressiveDelayMs > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, progressiveDelayMs),
            );
          }
          return { allowed: true, retryAfterSeconds: 0, progressiveDelayMs };
        }
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  } catch (err: unknown) {
    appLogger.error(
      "Account throttle check failed: Redis cache store is unavailable",
      {
        scope,
        identifier: identifier.trim().toLowerCase(),
        clientIp,
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
  const clientIp = options?.clientIp;

  const key = resolveThrottleKey(scope, identifier, clientIp);

  try {
    const redis = getRedisClient();
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, windowSeconds);
    } else if (count >= maxAttempts) {
      await redis.expire(key, lockoutTtlSeconds);
    }

    // Also record against global per-email counter if clientIp was provided
    if (scope === "staff_login" && clientIp) {
      const globalKey = buildSystemCacheKey(
        "auth_throttle",
        `staff_login_global:${identifier.trim().toLowerCase()}`,
      );
      const globalCount = await redis.incr(globalKey);
      if (globalCount === 1) {
        await redis.expire(globalKey, windowSeconds);
      }
    }

    return count;
  } catch (err: unknown) {
    appLogger.warn(
      "Failed to record account failure in Redis",
      {
        scope,
        identifier: identifier.trim().toLowerCase(),
        clientIp,
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
  options?: ThrottleResetOptions,
): Promise<void> {
  if (!identifier || !identifier.trim()) {
    return;
  }

  const clientIp = options?.clientIp;
  const key = resolveThrottleKey(scope, identifier, clientIp);

  try {
    const redis = getRedisClient();
    await redis.del(key);

    if (scope === "staff_login") {
      const globalKey = buildSystemCacheKey(
        "auth_throttle",
        `staff_login_global:${identifier.trim().toLowerCase()}`,
      );
      await redis.del(globalKey);
    }
  } catch (err: unknown) {
    appLogger.warn(
      "Failed to reset account throttle in Redis",
      {
        scope,
        identifier: identifier.trim().toLowerCase(),
        clientIp,
      },
      err instanceof Error ? err : undefined,
    );
  }
}
