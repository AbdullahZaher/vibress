import net from "node:net";
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

/**
 * Fully expands an IPv6 address string into 8 padded 4-character hex hextets.
 */
export function expandIPv6(ip: string): string[] {
  const clean = ip.trim().toLowerCase();
  let hextets: string[];

  if (clean.includes("::")) {
    const [left, right] = clean.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const missing = 8 - (leftParts.length + rightParts.length);
    const middle = Array(Math.max(missing, 0)).fill("0");
    hextets = [...leftParts, ...middle, ...rightParts];
  } else {
    hextets = clean.split(":");
  }

  // Ensure exactly 8 hextets, each padded to 4 lowercase hex characters
  return hextets.slice(0, 8).map((h) => h.padStart(4, "0"));
}

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

  // IPv6 (/64 subnet prefix across expanded first 4 hextets)
  if (net.isIPv6(cleanIp) || cleanIp.includes(":")) {
    const hextets = expandIPv6(cleanIp);
    const prefix = hextets.slice(0, 4).join(":");
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

const RECORD_FAILURE_LUA = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
local window = tonumber(ARGV[1])
local maxAttempts = tonumber(ARGV[2])
local lockoutTtl = tonumber(ARGV[3])

if current >= maxAttempts then
    redis.call('EXPIRE', KEYS[1], lockoutTtl)
elseif current == 1 or ttl < 0 then
    redis.call('EXPIRE', KEYS[1], window)
end
return current
`;

const RECORD_GLOBAL_FAILURE_LUA = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
local window = tonumber(ARGV[1])

if current == 1 or ttl < 0 then
    redis.call('EXPIRE', KEYS[1], window)
end
return current
`;

const SCOPE_DEFAULTS: Record<
  ThrottleScope,
  { windowSeconds: number; lockoutTtlSeconds: number }
> = {
  staff_login: { windowSeconds: 900, lockoutTtlSeconds: 900 },
  staff_login_global: { windowSeconds: 900, lockoutTtlSeconds: 900 },
  member_request: { windowSeconds: 600, lockoutTtlSeconds: 600 },
  member_verify: { windowSeconds: 900, lockoutTtlSeconds: 900 },
};

/**
 * Records a failed attempt for the identifier. Atomically increments failure counter
 * and establishes rolling window or lockout TTL via Lua script.
 */
export async function recordAccountFailure(
  scope: ThrottleScope,
  identifier: string,
  options?: ThrottleRecordOptions,
): Promise<number> {
  if (!identifier || !identifier.trim()) {
    return 0;
  }

  const defaultWindow =
    SCOPE_DEFAULTS[scope]?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const defaultLockout =
    SCOPE_DEFAULTS[scope]?.lockoutTtlSeconds ?? DEFAULT_LOCKOUT_SECONDS;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowSeconds = options?.windowSeconds ?? defaultWindow;
  const lockoutTtlSeconds = options?.lockoutTtlSeconds ?? defaultLockout;
  const clientIp = options?.clientIp;

  const key = resolveThrottleKey(scope, identifier, clientIp);

  try {
    const redis = getRedisClient();
    const rawResult = await redis.eval(
      RECORD_FAILURE_LUA,
      1,
      key,
      String(windowSeconds),
      String(maxAttempts),
      String(lockoutTtlSeconds),
    );
    const count =
      typeof rawResult === "number"
        ? rawResult
        : Number.parseInt(String(rawResult), 10);

    // Also record against global per-email counter if clientIp was provided
    if (scope === "staff_login" && clientIp) {
      const globalKey = buildSystemCacheKey(
        "auth_throttle",
        `staff_login_global:${identifier.trim().toLowerCase()}`,
      );
      await redis.eval(
        RECORD_GLOBAL_FAILURE_LUA,
        1,
        globalKey,
        String(windowSeconds),
      );
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
