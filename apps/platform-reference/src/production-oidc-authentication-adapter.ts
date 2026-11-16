import { createHash } from "node:crypto";
import {
  asApplicationId, asInstallationId, asTenantId,
  type ApplicationId, type InstallationId, type PrincipalId,
  type TenantId, type VerifiedPrincipal,
} from "@vibress/platform-kernel";
import type { ScopeResolver } from "@vibress/tenancy";
import {
  InvalidOidcTokenError, OidcPrincipalVerifier,
  type OidcJwks, type OidcPrincipalVerifierConfig,
} from "./oidc-principal-verifier";

/**
 * W1-T07 non-activated, provider-independent production identity candidate.
 * The caller must supply an APPROVED pinned JWKS source, revocation authority
 * and the platform membership reader. No serving process imports this module.
 */
export interface ApprovedJwksSource { load(): Promise<OidcJwks> }
export interface RevocationAuthority {
  /** Authoritative per-attempt decision. Throw on outage; never log the raw token. */
  isActive(input: { token: string; tokenDigest: string; principalId: PrincipalId }): Promise<boolean>;
}
export type IdentityDenialCode =
  | "invalid_token_profile" | "wrong_client" | "token_lifetime_exceeded"
  | "wrong_context" | "revoked_token" | "revocation_unavailable"
  | "tenant_denied" | "membership_unavailable" | "jwks_unavailable";
export class IdentityDeniedError extends Error {
  constructor(readonly code: IdentityDenialCode) {
    super("Identity denied: " + code);
    this.name = "IdentityDeniedError";
  }
}
export interface ProductionOidcConfig {
  issuer: string;
  audience: string;
  clientId: string;
  applicationId: ApplicationId | string;
  installationId: InstallationId | string;
  jwksSource: ApprovedJwksSource;
  revocation: RevocationAuthority;
  membership: ScopeResolver;
  now?: () => number;
  jwksTtlSeconds?: number;
  maxTokenLifetimeSeconds?: number;
  clockSkewSeconds?: number;
}

function integerLimit(value: number | undefined, fallback: number, min: number, max: number) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error("Invalid bounded identity configuration");
  }
  return resolved;
}
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
/** Untrusted parsing is solely for rejection; never authorize without signature verification. */
function envelope(token: string) {
  if (typeof token !== "string" || token.length === 0 || token.length > 16384) {
    throw new IdentityDeniedError("invalid_token_profile");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new IdentityDeniedError("invalid_token_profile");
  try {
    const decode = (part: string) => {
      if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("invalid-base64url");
      return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    };
    const header = decode(parts[0] ?? "");
    const claims = decode(parts[1] ?? "");
    if (!isRecord(header) || !isRecord(claims)) throw new Error("invalid-json");
    return { header, claims };
  } catch {
    throw new IdentityDeniedError("invalid_token_profile");
  }
}

interface JwksCache { verifier: OidcPrincipalVerifier; expiresAt: number }
/**
 * Enforces RFC 9068 access-token typing + exact client binding.
 * Strictly NO ID-token-as-API-bearer exchange.
 * Server-side membership is checked before hydrating tenantIds; RouteExecutor
 * must independently recheck membership, permissions and policy per action.
 */
export class ProductionOidcAuthenticationAdapter {
  readonly #application: ApplicationId;
  readonly #installation: InstallationId;
  readonly #config: ProductionOidcConfig;
  readonly #now: () => number;
  readonly #ttl: number;
  readonly #maxLifetime: number;
  readonly #skew: number;
  #cache: JwksCache | null = null;
  #pending: Promise<JwksCache> | null = null;
  #lastRefresh = Number.NEGATIVE_INFINITY;

  constructor(config: ProductionOidcConfig) {
    if (!/^https:\/\/[^\s/?#]+/.test(config.issuer) ||
        config.issuer.includes("?") || config.issuer.includes("#") ||
        !config.audience?.trim() || !config.clientId?.trim()) {
      throw new Error("Approved exact HTTPS issuer, audience and client ID are required");
    }
    this.#application = asApplicationId(config.applicationId);
    this.#installation = asInstallationId(config.installationId);
    this.#config = config;
    this.#now = config.now ?? (() => Math.floor(Date.now() / 1000));
    this.#ttl = integerLimit(config.jwksTtlSeconds, 300, 1, 3600);
    this.#maxLifetime = integerLimit(config.maxTokenLifetimeSeconds, 900, 60, 3600);
    this.#skew = integerLimit(config.clockSkewSeconds, 30, 0, 120);
  }

  async authenticate(input: {
    token: string;
    tenantId: TenantId | string;
    applicationId: ApplicationId | string;
    installationId: InstallationId | string;
  }): Promise<VerifiedPrincipal> {
    if (asApplicationId(input.applicationId) !== this.#application ||
        asInstallationId(input.installationId) !== this.#installation) {
      throw new IdentityDeniedError("wrong_context");
    }
    const tenant = asTenantId(input.tenantId);
    const { header, claims } = envelope(input.token);
    // Never follow untrusted JOSE key addresses or critical extensions.
    if ((header.typ !== "at+jwt" && header.typ !== "application/at+jwt") ||
        "jku" in header || "x5u" in header || "jwk" in header ||
        "crit" in header || "b64" in header || "cty" in header) {
      throw new IdentityDeniedError("invalid_token_profile");
    }
    const principal = await this.#verify(input.token);
    // Claims are checked only after signature, issuer and application/install verification.
    if (claims.client_id !== this.#config.clientId ||
        ("azp" in claims && claims.azp !== this.#config.clientId)) {
      throw new IdentityDeniedError("wrong_client");
    }
    if (claims.aud !== this.#config.audience &&
        !(Array.isArray(claims.aud) && claims.aud.length === 1 &&
          claims.aud[0] === this.#config.audience)) {
      throw new IdentityDeniedError("invalid_token_profile");
    }
    if (typeof claims.exp !== "number" || typeof claims.iat !== "number" ||
        claims.exp <= claims.iat ||
        claims.exp - claims.iat > this.#maxLifetime) {
      throw new IdentityDeniedError("token_lifetime_exceeded");
    }
    if (principal.kind !== "end_user" || principal.applicationId !== this.#application ||
        principal.tenantIds.length !== 0 || principal.roles.length !== 0 ||
        principal.permissions.length !== 0) {
      throw new IdentityDeniedError("wrong_context");
    }
    let active: boolean;
    try {
      active = await this.#config.revocation.isActive({
        token: input.token,
        tokenDigest: createHash("sha256").update(input.token).digest("hex"),
        principalId: principal.id,
      });
    } catch {
      throw new IdentityDeniedError("revocation_unavailable");
    }
    if (active !== true) throw new IdentityDeniedError("revoked_token");

    let membership: Awaited<ReturnType<ScopeResolver["resolve"]>>;
    try {
      membership = await this.#config.membership.resolve(principal.id, this.#application, tenant);
    } catch {
      throw new IdentityDeniedError("membership_unavailable");
    }
    if (!membership || !membership.active || membership.principalId !== principal.id ||
        membership.applicationId !== this.#application || membership.tenantId !== tenant) {
      throw new IdentityDeniedError("tenant_denied");
    }
    // The only tenant claim in this returned principal is server-confirmed.
    // Do not copy membership permissions or user-supplied role claims here.
    return Object.freeze({
      ...principal, tenantIds: Object.freeze([tenant]),
      roles: Object.freeze([]), permissions: Object.freeze([]),
    });
  }

  async #verify(token: string): Promise<VerifiedPrincipal> {
    const cache = await this.#cached();
    try { return cache.verifier.verify(token); }
    catch (error) {
      if (!(error instanceof InvalidOidcTokenError) || error.code !== "unknown_key" ||
          this.#now() - this.#lastRefresh < 30) throw error;
      return (await this.#reload()).verifier.verify(token);
    }
  }

  async #cached(): Promise<JwksCache> {
    if (this.#cache && this.#now() < this.#cache.expiresAt) return this.#cache;
    return this.#reload();
  }
  async #reload(): Promise<JwksCache> {
    if (this.#pending) return this.#pending;
    this.#lastRefresh = this.#now();
    this.#pending = (async () => {
      try {
        const jwks = await this.#config.jwksSource.load();
        if (!jwks || !Array.isArray(jwks.keys) ||
            jwks.keys.length === 0 || jwks.keys.length > 32) throw new Error("jwks-size");
        const verifierConfig: OidcPrincipalVerifierConfig = {
          issuer: this.#config.issuer, audience: this.#config.audience,
          applicationId: this.#application, installationId: this.#installation,
          principalKind: "end_user", algorithms: ["RS256", "ES256"],
          clockSkewSeconds: this.#skew, now: this.#now,
        };
        const cache = {
          verifier: new OidcPrincipalVerifier(verifierConfig, jwks),
          expiresAt: this.#now() + this.#ttl,
        };
        this.#cache = cache;
        return cache;
      } catch {
        throw new IdentityDeniedError("jwks_unavailable");
      }
    })();
    try { return await this.#pending; }
    finally { this.#pending = null; }
  }
}
