import { createPublicKey, verify, createHash } from "node:crypto";
import { z } from "zod";

export type PluginTrustTier = "curated_operator" | "community_reviewed" | "untrusted_marketplace";

export interface PluginPublisher {
  readonly id: string;
  readonly name: string;
  readonly verified: boolean;
  readonly url?: string | undefined;
}

export interface PluginCatalogCompatibility {
  readonly minVibressApiVersion: string;
  readonly maxVibressApiVersion: string;
  readonly sdkAbiVersion: string;
}

export interface PluginSecurityAdvisory {
  readonly id: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly summary: string;
  readonly fixedInVersion?: string | undefined;
}

export interface PluginCatalogEntry {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string | null;
  readonly publisher: PluginPublisher;
  readonly releaseDigest: string;
  readonly archiveSha256: string;
  readonly sourceArchiveUrl: string;
  readonly compatibility: PluginCatalogCompatibility;
  readonly declaredCapabilities: readonly string[];
  readonly trustTier: PluginTrustTier;
  readonly isRevoked: boolean;
  readonly revocationReason?: string | undefined;
  readonly securityAdvisories?: readonly PluginSecurityAdvisory[] | undefined;
}

export interface SignedPluginCatalogFeed {
  readonly schemaVersion: 1;
  readonly catalogId: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly signerKeyId: string;
  readonly plugins: readonly PluginCatalogEntry[];
  readonly signature: string;
}

export class PluginCatalogError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PluginCatalogError";
  }
}

const sha256Hex = /^[a-f0-9]{64}$/;
const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;

export const PluginCatalogEntrySchema = z.object({
  id: z.string().min(1).max(100),
  version: z.string().regex(semverRegex),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).nullable(),
  publisher: z.object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    verified: z.boolean(),
    url: z.string().url().optional(),
  }),
  releaseDigest: z.string().min(8).max(128),
  archiveSha256: z.string().regex(sha256Hex),
  sourceArchiveUrl: z.string().min(1).max(500),
  compatibility: z.object({
    minVibressApiVersion: z.string().regex(semverRegex),
    maxVibressApiVersion: z.string().regex(semverRegex),
    sdkAbiVersion: z.string().regex(semverRegex),
  }),
  declaredCapabilities: z.array(z.string().min(1).max(100)),
  trustTier: z.enum(["curated_operator", "community_reviewed", "untrusted_marketplace"]),
  isRevoked: z.boolean(),
  revocationReason: z.string().max(500).optional(),
  securityAdvisories: z.array(
    z.object({
      id: z.string().min(1).max(100),
      severity: z.enum(["low", "medium", "high", "critical"]),
      summary: z.string().min(1).max(500),
      fixedInVersion: z.string().regex(semverRegex).optional(),
    }),
  ).optional(),
}).strict();

export const SignedPluginCatalogFeedSchema = z.object({
  schemaVersion: z.literal(1),
  catalogId: z.string().min(1).max(100),
  generatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  signerKeyId: z.string().min(1).max(100),
  plugins: z.array(PluginCatalogEntrySchema),
  signature: z.string().min(1),
}).strict();

/**
 * Computes canonical bytes for catalog feed signing.
 */
export function getCanonicalCatalogBytes(
  feed: Omit<SignedPluginCatalogFeed, "signature">,
): Buffer {
  const canonicalPayload = {
    schemaVersion: feed.schemaVersion,
    catalogId: feed.catalogId,
    generatedAt: feed.generatedAt,
    expiresAt: feed.expiresAt,
    signerKeyId: feed.signerKeyId,
    plugins: feed.plugins,
  };
  return Buffer.from(JSON.stringify(canonicalPayload), "utf8");
}

export interface VerifyCatalogOptions {
  readonly publicKeyPem?: string | undefined;
  readonly now?: Date | undefined;
  readonly revokedKeyIds?: readonly string[] | undefined;
}

/**
 * Validates feed schema, expiration, signer revocation, and cryptographic signature.
 */
export function verifyCatalogFeed(
  rawFeed: unknown,
  options?: VerifyCatalogOptions,
): SignedPluginCatalogFeed {
  const parsed = SignedPluginCatalogFeedSchema.safeParse(rawFeed);
  if (!parsed.success) {
    throw new PluginCatalogError("CATALOG_SCHEMA_INVALID", `Catalog feed schema error: ${parsed.error.message}`);
  }

  const feed = parsed.data;
  const now = options?.now ?? new Date();

  // Freshness check: reject expired catalogs
  const expiresAt = new Date(feed.expiresAt);
  if (expiresAt.getTime() <= now.getTime()) {
    throw new PluginCatalogError("CATALOG_EXPIRED", `Catalog feed expired at ${feed.expiresAt}`);
  }

  // Key revocation check
  if (options?.revokedKeyIds && options.revokedKeyIds.includes(feed.signerKeyId)) {
    throw new PluginCatalogError("CATALOG_SIGNER_REVOKED", `Catalog signer key '${feed.signerKeyId}' is revoked`);
  }

  // Cryptographic signature check if public key provided
  if (options?.publicKeyPem) {
    try {
      const canonicalBytes = getCanonicalCatalogBytes(feed);
      const publicKey = createPublicKey(options.publicKeyPem);
      const isVerified = verify(
        null,
        canonicalBytes,
        publicKey,
        Buffer.from(feed.signature, "base64"),
      );
      if (!isVerified) {
        throw new PluginCatalogError("CATALOG_SIGNATURE_INVALID", "Catalog signature verification failed");
      }
    } catch (err: unknown) {
      if (err instanceof PluginCatalogError) throw err;
      throw new PluginCatalogError("CATALOG_SIGNATURE_INVALID", `Signature check failed: ${(err as Error).message}`);
    }
  }

  return feed;
}

export interface CatalogFilterOptions {
  readonly query?: string | undefined;
  readonly trustTier?: PluginTrustTier | undefined;
  readonly capability?: string | undefined;
  readonly currentApiVersion?: string | undefined;
  readonly includeRevoked?: boolean | undefined;
}

function parseSemver(v: string): [number, number, number] {
  const parts = v.split("-")[0]?.split(".").map(Number) || [0, 0, 0];
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function semverGte(a: string, b: string): boolean {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 >= b3;
}

function semverLte(a: string, b: string): boolean {
  return semverGte(b, a);
}

/**
 * Filter catalog entries by search query, trust tier, capability, and compatibility.
 */
export function filterCatalogEntries(
  entries: readonly PluginCatalogEntry[],
  options: CatalogFilterOptions,
): readonly PluginCatalogEntry[] {
  return entries.filter((entry) => {
    if (!options.includeRevoked && entry.isRevoked) {
      return false;
    }

    if (options.trustTier && entry.trustTier !== options.trustTier) {
      return false;
    }

    if (options.capability && !entry.declaredCapabilities.includes(options.capability)) {
      return false;
    }

    if (options.currentApiVersion) {
      const minOk = semverGte(options.currentApiVersion, entry.compatibility.minVibressApiVersion);
      const maxOk = semverLte(options.currentApiVersion, entry.compatibility.maxVibressApiVersion);
      if (!minOk || !maxOk) return false;
    }

    if (options.query) {
      const q = options.query.toLowerCase().trim();
      const matchId = entry.id.toLowerCase().includes(q);
      const matchName = entry.name.toLowerCase().includes(q);
      const matchDesc = entry.description ? entry.description.toLowerCase().includes(q) : false;
      const matchPublisher = entry.publisher.name.toLowerCase().includes(q);
      if (!matchId && !matchName && !matchDesc && !matchPublisher) {
        return false;
      }
    }

    return true;
  });
}

export interface AdmissibilityCheckResult {
  readonly admissible: boolean;
  readonly reason?: string | undefined;
}

/**
 * Enforces strict admission policies before staging a plugin.
 */
export function checkPluginAdmissibility(
  entry: PluginCatalogEntry,
  currentApiVersion: string,
  options?: { allowUntrustedMarketplace?: boolean },
): AdmissibilityCheckResult {
  if (entry.isRevoked) {
    return {
      admissible: false,
      reason: `Plugin release is revoked: ${entry.revocationReason || "Revoked by operator/publisher"}`,
    };
  }

  // API compatibility
  if (!semverGte(currentApiVersion, entry.compatibility.minVibressApiVersion)) {
    return {
      admissible: false,
      reason: `Incompatible: Vibress API version ${currentApiVersion} is lower than required minimum ${entry.compatibility.minVibressApiVersion}`,
    };
  }

  if (!semverLte(currentApiVersion, entry.compatibility.maxVibressApiVersion)) {
    return {
      admissible: false,
      reason: `Incompatible: Vibress API version ${currentApiVersion} exceeds supported maximum ${entry.compatibility.maxVibressApiVersion}`,
    };
  }

  // Security Advisories check: critical findings block admission
  const criticalAdvisory = entry.securityAdvisories?.find((a) => a.severity === "critical");
  if (criticalAdvisory) {
    return {
      admissible: false,
      reason: `Blocked by critical security advisory ${criticalAdvisory.id}: ${criticalAdvisory.summary}`,
    };
  }

  // Untrusted marketplace policy gating
  if (entry.trustTier === "untrusted_marketplace" && !options?.allowUntrustedMarketplace) {
    return {
      admissible: false,
      reason: "Untrusted marketplace execution is disabled until Tier 2 runtime isolation is enabled and operator approved",
    };
  }

  return { admissible: true };
}
