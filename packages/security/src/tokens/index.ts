import crypto from "node:crypto";

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const SITE_AUTH_COOKIE_NAME = "vb_site_auth";
export const SITE_AUTH_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Generates a tamper-proof HMAC-signed token for unlocking private sites.
 * Format: v1.<timestamp>.<hmacSha256(v1:<timestamp>, secret)>
 */
export function signSiteAuthToken(secret: string): string {
  const timestamp = Date.now().toString();
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(`v1:${timestamp}`)
    .digest("hex");
  return `v1.${timestamp}.${hmac}`;
}

/**
 * Validates the HMAC signature and expiration of a site privacy authentication token.
 * Prevents forged/tampered cookies and ensures timing-safe comparison.
 */
export function verifySiteAuthToken(
  token: string | undefined | null,
  secret: string,
  ttlMs: number = SITE_AUTH_DEFAULT_TTL_MS,
): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const timestampStr = parts[1];
  const signature = parts[2];
  if (!timestampStr || !signature || !/^[a-f0-9]{64}$/i.test(signature))
    return false;

  const timestamp = parseInt(timestampStr, 10);
  if (Number.isNaN(timestamp) || !/^\d+$/.test(timestampStr)) return false;

  const now = Date.now();
  // Reject future timestamps (>5 min leeway for clock skew) and expired tokens
  if (timestamp > now + 300_000 || now - timestamp > ttlMs) {
    return false;
  }

  const expectedHmac = crypto
    .createHmac("sha256", secret)
    .update(`v1:${timestampStr}`)
    .digest("hex");
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expectedHmac, "hex");

  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}
