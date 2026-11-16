import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
  type webcrypto,
} from "node:crypto";
import {
  asApplicationId,
  asPrincipalId,
  type ApplicationId,
  type PrincipalKind,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";

/**
 * Offline half of the W1-T07 production identity adapter.
 *
 * This verifier is deliberately not wired into the serving process: no IdP
 * tenant, issuer, client or revocation decision has been approved. It accepts a
 * static JWKS snapshot so the verification contract and its deny matrix can be
 * exercised without network access. Wiring it, fetching/rotating keys and
 * choosing revocation semantics require the IdP administrator and security
 * owner sign-off recorded in W1-T07-IDENTITY-PROVIDER-REQUEST.md.
 *
 * The adapter never trusts caller-supplied identity: the principal id is derived
 * from the verified `sub`, and tenant, role and permission lists are left empty
 * for the server-side membership resolver and policy engine.
 */

export type OidcAlgorithm = "RS256" | "ES256";

export const DEFAULT_OIDC_ALGORITHMS: readonly OidcAlgorithm[] = Object.freeze([
  "RS256",
  "ES256",
]);

export interface OidcJwk {
  readonly kty?: unknown;
  readonly kid?: unknown;
  readonly alg?: unknown;
  readonly use?: unknown;
  readonly n?: unknown;
  readonly e?: unknown;
  readonly crv?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
}

export interface OidcJwks {
  readonly keys: readonly OidcJwk[];
}

export interface OidcPrincipalVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly applicationId: ApplicationId | string;
  readonly installationId: string;
  /** Resolved server-side; a token cannot choose its own principal kind. */
  readonly principalKind?: PrincipalKind;
  readonly algorithms?: readonly OidcAlgorithm[];
  readonly clockSkewSeconds?: number;
  /** Seconds since the epoch. Injectable for deterministic tests. */
  readonly now?: () => number;
}

export type OidcTokenViolationCode =
  | "malformed_token"
  | "unsupported_algorithm"
  | "unknown_key"
  | "ambiguous_key"
  | "invalid_signature"
  | "wrong_issuer"
  | "wrong_audience"
  | "token_expired"
  | "token_not_yet_valid"
  | "issued_in_future"
  | "missing_subject"
  | "application_binding_mismatch"
  | "installation_binding_mismatch";

export class InvalidOidcTokenError extends Error {
  readonly code: OidcTokenViolationCode;

  constructor(code: OidcTokenViolationCode, reason: string) {
    super(`Invalid OIDC token: ${reason}`);
    this.name = "InvalidOidcTokenError";
    this.code = code;
  }
}

export class InvalidOidcJwkSetError extends Error {
  constructor(reason: string) {
    super(`Invalid OIDC JWKS: ${reason}`);
    this.name = "InvalidOidcJwkSetError";
  }
}

export const OIDC_APPLICATION_CLAIM = "vib_application_id";
export const OIDC_INSTALLATION_CLAIM = "vib_installation_id";

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const DEFAULT_SKEW_SECONDS = 30;

interface ParsedKey {
  readonly kid: string;
  readonly alg: string | null;
  readonly key: KeyObject;
}

interface ParsedToken {
  readonly signingInput: string;
  readonly header: Record<string, unknown>;
  readonly claims: Record<string, unknown>;
  readonly signature: Buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeSegment(segment: string): unknown {
  if (!BASE64URL.test(segment)) {
    throw new InvalidOidcTokenError("malformed_token", "segments must be base64url");
  }
  let text: string;
  try {
    text = Buffer.from(segment, "base64url").toString("utf8");
  } catch {
    throw new InvalidOidcTokenError("malformed_token", "segment is not base64url");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidOidcTokenError("malformed_token", "segment is not JSON");
  }
}

function parseToken(token: string): ParsedToken {
  if (typeof token !== "string" || token.length === 0 || token.length > 16_384) {
    throw new InvalidOidcTokenError("malformed_token", "token is empty or too large");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new InvalidOidcTokenError("malformed_token", "token must have three segments");
  }
  const [encodedHeader, encodedClaims, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  if (encodedSignature === "") {
    throw new InvalidOidcTokenError("malformed_token", "signature is missing");
  }
  const header = decodeSegment(encodedHeader);
  const claims = decodeSegment(encodedClaims);
  if (!isRecord(header) || !isRecord(claims)) {
    throw new InvalidOidcTokenError("malformed_token", "header and claims must be objects");
  }
  if (!BASE64URL.test(encodedSignature)) {
    throw new InvalidOidcTokenError("malformed_token", "signature must be base64url");
  }
  return {
    signingInput: `${encodedHeader}.${encodedClaims}`,
    header,
    claims,
    signature: Buffer.from(encodedSignature, "base64url"),
  };
}

function algorithmMatchesKey(algorithm: string, key: ParsedKey): boolean {
  if (key.alg !== null && key.alg !== algorithm) return false;
  return algorithm === "RS256"
    ? key.key.asymmetricKeyType === "rsa"
    : key.key.asymmetricKeyType === "ec";
}

function importKey(raw: OidcJwk): ParsedKey {
  if (typeof raw.kid !== "string" || raw.kid.trim() === "") {
    throw new InvalidOidcJwkSetError("every key requires a non-empty kid");
  }
  if (raw.use !== undefined && raw.use !== "sig") {
    throw new InvalidOidcJwkSetError(`key '${raw.kid}' is not a signing key`);
  }
  if (raw.alg !== undefined && raw.alg !== "RS256" && raw.alg !== "ES256") {
    throw new InvalidOidcJwkSetError(
      `key '${raw.kid}' uses an unsupported algorithm`,
    );
  }
  if (raw.kty === "RSA") {
    if (typeof raw.n !== "string" || typeof raw.e !== "string") {
      throw new InvalidOidcJwkSetError(`RSA key '${raw.kid}' is missing n/e`);
    }
  } else if (raw.kty === "EC") {
    if (
      raw.crv !== "P-256" ||
      typeof raw.x !== "string" ||
      typeof raw.y !== "string"
    ) {
      throw new InvalidOidcJwkSetError(
        `EC key '${raw.kid}' must be P-256 with x/y`,
      );
    }
  } else {
    throw new InvalidOidcJwkSetError(
      `key '${raw.kid}' must be an RSA or EC public key`,
    );
  }
  let key: KeyObject;
  try {
    key = createPublicKey({
      key: raw as unknown as webcrypto.JsonWebKey,
      format: "jwk",
    });
  } catch {
    throw new InvalidOidcJwkSetError(`key '${raw.kid}' could not be imported`);
  }
  return {
    kid: raw.kid,
    alg: typeof raw.alg === "string" ? raw.alg : null,
    key,
  };
}

/**
 * Deterministic, collision-resistant mapping from a verified `(issuer, sub)`
 * pair to the platform's lowercase principal-id format. The raw `sub` is not
 * used as an identifier because IdP subject values are not constrained to the
 * platform's identifier grammar.
 */
export function deriveOidcPrincipalId(issuer: string, subject: string): string {
  return `p_${createHash("sha256")
    .update(issuer, "utf8")
    .update("\u0000", "utf8")
    .update(subject, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function numericDate(
  claims: Record<string, unknown>,
  name: "exp" | "nbf" | "iat",
  required: boolean,
): number | null {
  const value = claims[name];
  if (value === undefined && !required) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidOidcTokenError("malformed_token", `${name} must be a number`);
  }
  return value;
}

function audienceContains(audience: unknown, expected: string): boolean {
  if (typeof audience === "string") return audience === expected;
  return (
    Array.isArray(audience) &&
    audience.length > 0 &&
    audience.every((entry) => typeof entry === "string") &&
    audience.includes(expected)
  );
}

export class OidcPrincipalVerifier {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #applicationId: ApplicationId;
  readonly #installationId: string;
  readonly #principalKind: PrincipalKind;
  readonly #algorithms: readonly string[];
  readonly #clockSkewSeconds: number;
  readonly #now: () => number;
  readonly #keys: readonly ParsedKey[];

  constructor(config: OidcPrincipalVerifierConfig, jwks: OidcJwks) {
    if (!config.issuer.trim()) {
      throw new InvalidOidcJwkSetError("issuer must not be empty");
    }
    if (!config.audience.trim()) {
      throw new InvalidOidcJwkSetError("audience must not be empty");
    }
    if (!config.installationId.trim()) {
      throw new InvalidOidcJwkSetError("installationId must not be empty");
    }
    const algorithms = config.algorithms ?? DEFAULT_OIDC_ALGORITHMS;
    if (
      algorithms.length === 0 ||
      algorithms.some((algorithm) => !DEFAULT_OIDC_ALGORITHMS.includes(algorithm))
    ) {
      throw new InvalidOidcJwkSetError("algorithms must be a non-empty RS256/ES256 subset");
    }
    if (
      config.clockSkewSeconds !== undefined &&
      (!Number.isFinite(config.clockSkewSeconds) || config.clockSkewSeconds < 0)
    ) {
      throw new InvalidOidcJwkSetError("clockSkewSeconds must be a non-negative number");
    }
    if (!isRecord(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new InvalidOidcJwkSetError("keys must be a non-empty array");
    }

    this.#issuer = config.issuer;
    this.#audience = config.audience;
    this.#applicationId = asApplicationId(config.applicationId);
    this.#installationId = config.installationId;
    this.#principalKind = config.principalKind ?? "end_user";
    this.#algorithms = Object.freeze([...algorithms]);
    this.#clockSkewSeconds =
      config.clockSkewSeconds ?? DEFAULT_SKEW_SECONDS;
    this.#now = config.now ?? (() => Math.floor(Date.now() / 1000));
    this.#keys = Object.freeze(jwks.keys.map(importKey));
  }

  verify(token: string): VerifiedPrincipal {
    const parsed = parseToken(token);
    const algorithm = parsed.header.alg;
    if (typeof algorithm !== "string" || !this.#algorithms.includes(algorithm)) {
      throw new InvalidOidcTokenError(
        "unsupported_algorithm",
        "the token algorithm is not in the configured allowlist",
      );
    }
    const kid = parsed.header.kid;
    if (typeof kid !== "string" || kid.trim() === "") {
      throw new InvalidOidcTokenError("unknown_key", "the token has no key id");
    }
    const candidates = this.#keys.filter(
      (key) => key.kid === kid && algorithmMatchesKey(algorithm, key),
    );
    if (candidates.length === 0) {
      throw new InvalidOidcTokenError(
        "unknown_key",
        "no configured signing key matches the token key id",
      );
    }
    if (candidates.length > 1) {
      throw new InvalidOidcTokenError(
        "ambiguous_key",
        "more than one configured key matches the token key id",
      );
    }
    const signingKey = candidates[0];
    if (!signingKey) {
      throw new InvalidOidcTokenError("unknown_key", "no configured signing key");
    }

    let valid: boolean;
    try {
      valid =
        algorithm === "ES256"
          ? verifySignature(
              "sha256",
              Buffer.from(parsed.signingInput, "utf8"),
              { key: signingKey.key, dsaEncoding: "ieee-p1363" },
              parsed.signature,
            )
          : verifySignature(
              "sha256",
              Buffer.from(parsed.signingInput, "utf8"),
              signingKey.key,
              parsed.signature,
            );
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new InvalidOidcTokenError(
        "invalid_signature",
        "the token signature is not valid",
      );
    }

    const claims = parsed.claims;
    if (claims.iss !== this.#issuer) {
      throw new InvalidOidcTokenError("wrong_issuer", "issuer does not match");
    }
    if (!audienceContains(claims.aud, this.#audience)) {
      throw new InvalidOidcTokenError("wrong_audience", "audience does not match");
    }

    const now = this.#now();
    const skew = this.#clockSkewSeconds;
    const expiresAt = numericDate(claims, "exp", true);
    const notBefore = numericDate(claims, "nbf", false);
    const issuedAt = numericDate(claims, "iat", true);
    if (expiresAt === null || issuedAt === null) {
      throw new InvalidOidcTokenError("malformed_token", "exp and iat are required");
    }
    if (now > expiresAt + skew) {
      throw new InvalidOidcTokenError("token_expired", "the token has expired");
    }
    if (notBefore !== null && notBefore > now + skew) {
      throw new InvalidOidcTokenError("token_not_yet_valid", "nbf is in the future");
    }
    if (issuedAt > now + skew) {
      throw new InvalidOidcTokenError("issued_in_future", "iat is in the future");
    }

    const subject = claims.sub;
    if (typeof subject !== "string" || subject.trim() === "") {
      throw new InvalidOidcTokenError("missing_subject", "sub is required");
    }
    if (claims[OIDC_APPLICATION_CLAIM] !== this.#applicationId) {
      throw new InvalidOidcTokenError(
        "application_binding_mismatch",
        "application binding claim does not match",
      );
    }
    if (claims[OIDC_INSTALLATION_CLAIM] !== this.#installationId) {
      throw new InvalidOidcTokenError(
        "installation_binding_mismatch",
        "installation binding claim does not match",
      );
    }

    return Object.freeze({
      id: asPrincipalId(deriveOidcPrincipalId(this.#issuer, subject)),
      kind: this.#principalKind,
      applicationId: this.#applicationId,
      tenantIds: Object.freeze([]),
      roles: Object.freeze([]),
      permissions: Object.freeze([]),
    });
  }
}
