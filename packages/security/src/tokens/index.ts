import crypto from "node:crypto";

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const SITE_AUTH_COOKIE_NAME = "vb_site_auth";
export const SITE_AUTH_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function signSiteAuthPayload(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function encodeSiteAuthScope(publicationId: string): string {
  return Buffer.from(publicationId, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function isValidTimestamp(timestampStr: string, ttlMs: number): boolean {
  const timestamp = parseInt(timestampStr, 10);
  if (Number.isNaN(timestamp) || !/^\d+$/.test(timestampStr)) return false;

  const now = Date.now();
  return timestamp <= now + 300_000 && now - timestamp <= ttlMs;
}

function isValidHexSignature(signature: string | undefined): signature is string {
  return typeof signature === "string" && /^[a-f0-9]{64}$/i.test(signature);
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Generates a tamper-proof HMAC-signed token for unlocking private sites.
 *
 * v2 binds the token to an authoritative publication id:
 *   v2.<timestamp>.<base64url(publicationId)>.<hmacSha256(v2:<timestamp>:<scope>, secret)>
 *
 * The publication binding prevents a valid private-site cookie for one site
 * from unlocking another publication served by the same installation.
 */
export function signSiteAuthToken(secret: string): string;
export function signSiteAuthToken(secret: string, publicationId: string): string;
export function signSiteAuthToken(secret: string, publicationId?: string): string {
  const timestamp = Date.now().toString();
  const normalizedPublicationId = publicationId?.trim();

  if (normalizedPublicationId) {
    const scope = encodeSiteAuthScope(normalizedPublicationId);
    const payload = `v2:${timestamp}:${scope}`;
    const hmac = signSiteAuthPayload(secret, payload);
    return `v2.${timestamp}.${scope}.${hmac}`;
  }

  // Legacy fallback kept for older callers that do not pass publicationId.
  // Publication-scoped verification rejects v1 tokens.
  const hmac = signSiteAuthPayload(secret, `v1:${timestamp}`);
  return `v1.${timestamp}.${hmac}`;
}

/**
 * Validates the HMAC signature and expiration of a site privacy authentication token.
 * When publicationId is provided, only v2 publication-bound tokens are accepted.
 */
export function verifySiteAuthToken(
  token: string | undefined | null,
  secret: string,
  publicationId: string,
  ttlMs?: number,
): boolean;
export function verifySiteAuthToken(
  token: string | undefined | null,
  secret: string,
  ttlMs?: number,
): boolean;
export function verifySiteAuthToken(
  token: string | undefined | null,
  secret: string,
  publicationIdOrTtlMs: string | number = SITE_AUTH_DEFAULT_TTL_MS,
  ttlMs: number = SITE_AUTH_DEFAULT_TTL_MS,
): boolean {
  if (!token || typeof token !== "string") return false;

  const scopedPublicationId =
    typeof publicationIdOrTtlMs === "string" ? publicationIdOrTtlMs.trim() : undefined;
  const effectiveTtlMs =
    typeof publicationIdOrTtlMs === "number" ? publicationIdOrTtlMs : ttlMs;

  const parts = token.split(".");
  const version = parts[0];

  if (version === "v2") {
    if (!scopedPublicationId || parts.length !== 4) return false;

    const timestampStr = parts[1];
    const scope = parts[2];
    const signature = parts[3];
    if (!timestampStr || !scope || !isValidHexSignature(signature)) return false;
    if (!isValidTimestamp(timestampStr, effectiveTtlMs)) return false;

    const expectedScope = encodeSiteAuthScope(scopedPublicationId);
    if (scope !== expectedScope) return false;

    const expectedHmac = signSiteAuthPayload(
      secret,
      `v2:${timestampStr}:${scope}`,
    );
    return timingSafeHexEqual(signature, expectedHmac);
  }

  if (version === "v1") {
    // v1 tokens are timestamp-only and must not satisfy publication-scoped checks.
    if (scopedPublicationId || parts.length !== 3) return false;

    const timestampStr = parts[1];
    const signature = parts[2];
    if (!timestampStr || !isValidHexSignature(signature)) return false;
    if (!isValidTimestamp(timestampStr, effectiveTtlMs)) return false;

    const expectedHmac = signSiteAuthPayload(secret, `v1:${timestampStr}`);
    return timingSafeHexEqual(signature, expectedHmac);
  }

  return false;
}
