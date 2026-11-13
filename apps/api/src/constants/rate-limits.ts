import { getConfig } from "@vibress/config";

/**
 * Route rate limit used by expensive or abuse-prone staff endpoints.
 * Production enforces the real budget; other environments raise it so suites
 * that exercise the endpoint repeatedly are not throttled.
 */
export const rateLimitConfig = (productionMax: number) => ({
  rateLimit: {
    max: getConfig().isProduction ? productionMax : 1000,
    timeWindow: "1 minute",
  },
});
