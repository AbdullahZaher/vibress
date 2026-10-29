import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import JSZip from "jszip";

import {
  type SignedPluginCatalogFeed,
  type PluginCatalogEntry,
  verifyCatalogFeed,
  filterCatalogEntries,
  checkPluginAdmissibility,
  getCanonicalCatalogBytes,
  PluginCatalogError,
} from "../src/application/plugin-catalog";
import {
  extractPluginArchiveToStaging,
  sanitizePluginEntryPath,
  ArchiveExtractionError,
} from "../src/application/plugin-archive-extractor";
import {
  MarketplaceService,
  MarketplaceError,
} from "../src/application/marketplace-service";
import {
  cliInit,
  cliValidate,
  cliPackage,
  cliSign,
  cliVerify,
  cliGenerateKeypair,
} from "@vibress/plugin-sdk";

describe("Trusted Catalog, Developer Tooling, and Marketplace Foundations (M5 & M6)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vibress-catalog-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("Signed Plugin Catalog Metadata (CAT-01)", () => {
    const keypair = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const sampleEntry: PluginCatalogEntry = {
      id: "com.vendor.forms",
      version: "1.2.0",
      name: "Custom Forms Builder",
      description: "Drag-and-drop form builder for members",
      publisher: {
        id: "vendor_forms_inc",
        name: "Forms Inc",
        verified: true,
        url: "https://example.com",
      },
      releaseDigest: "sha256:d8a2301982301928301928301928301928301928301928301928301928301928",
      archiveSha256: "a".repeat(64),
      sourceArchiveUrl: "https://cdn.example.com/forms-1.2.0.zip",
      compatibility: {
        minVibressApiVersion: "1.0.0",
        maxVibressApiVersion: "1.5.0",
        sdkAbiVersion: "1.0.0",
      },
      declaredCapabilities: ["admin.navigation", "extension.storage.read"],
      trustTier: "curated_operator",
      isRevoked: false,
    };

    function createSignedFeed(overrides?: Partial<SignedPluginCatalogFeed>): SignedPluginCatalogFeed {
      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 3600_000);

      const unsigned = {
        schemaVersion: 1 as const,
        catalogId: "curated-catalog-v1",
        generatedAt: now.toISOString(),
        expiresAt: oneHourLater.toISOString(),
        signerKeyId: "key-ed25519-primary",
        plugins: [sampleEntry],
        ...overrides,
      };

      const canonicalBytes = getCanonicalCatalogBytes(unsigned);
      const signature = cliSign(canonicalBytes, keypair.privateKey);

      return {
        ...unsigned,
        signature,
      };
    }

    it("verifies a valid signed catalog feed with Ed25519 signature", () => {
      const feed = createSignedFeed();
      const verified = verifyCatalogFeed(feed, { publicKeyPem: keypair.publicKey });
      expect(verified.catalogId).toBe("curated-catalog-v1");
      expect(verified.plugins).toHaveLength(1);
    });

    it("rejects an expired catalog feed fail-closed", () => {
      const expiredTime = new Date(Date.now() - 60_000).toISOString();
      const feed = createSignedFeed({ expiresAt: expiredTime });

      expect(() =>
        verifyCatalogFeed(feed, { publicKeyPem: keypair.publicKey })
      ).toThrowError(/expired/i);
    });

    it("rejects a feed from a revoked signer key ID", () => {
      const feed = createSignedFeed({ signerKeyId: "compromised-key-99" });

      expect(() =>
        verifyCatalogFeed(feed, {
          publicKeyPem: keypair.publicKey,
          revokedKeyIds: ["compromised-key-99"],
        })
      ).toThrowError(/signer key 'compromised-key-99' is revoked/i);
    });

    it("filters catalog entries by capability, query, and API version", () => {
      const entries: PluginCatalogEntry[] = [
        sampleEntry,
        {
          ...sampleEntry,
          id: "com.vendor.newsletter",
          name: "Email Newsletters",
          description: "Mail campaigns",
          declaredCapabilities: ["extension.mail.send"],
          trustTier: "untrusted_marketplace",
          compatibility: {
            minVibressApiVersion: "2.0.0",
            maxVibressApiVersion: "3.0.0",
            sdkAbiVersion: "1.0.0",
          },
        },
      ];

      // Query filter
      const searchRes = filterCatalogEntries(entries, { query: "builder" });
      expect(searchRes).toHaveLength(1);
      expect(searchRes[0]?.id).toBe("com.vendor.forms");

      // API version compatibility filter (1.2.0 is compatible with forms, but not newsletter which requires 2.0.0+)
      const versionRes = filterCatalogEntries(entries, { currentApiVersion: "1.2.0" });
      expect(versionRes).toHaveLength(1);
      expect(versionRes[0]?.id).toBe("com.vendor.forms");

      // Capability filter
      const capRes = filterCatalogEntries(entries, { capability: "extension.mail.send" });
      expect(capRes).toHaveLength(1);
      expect(capRes[0]?.id).toBe("com.vendor.newsletter");
    });

    it("evaluates plugin admissibility against API versions, revocations, and advisories", () => {
      // 1. Success case
      const res1 = checkPluginAdmissibility(sampleEntry, "1.2.0");
      expect(res1.admissible).toBe(true);

      // 2. Incompatible API version
      const res2 = checkPluginAdmissibility(sampleEntry, "0.9.0");
      expect(res2.admissible).toBe(false);
      expect(res2.reason).toContain("is lower than required minimum");

      // 3. Revoked plugin
      const res3 = checkPluginAdmissibility({ ...sampleEntry, isRevoked: true, revocationReason: "Compromised build" }, "1.2.0");
      expect(res3.admissible).toBe(false);
      expect(res3.reason).toContain("Compromised build");

      // 4. Critical security advisory
      const res4 = checkPluginAdmissibility({
        ...sampleEntry,
        securityAdvisories: [{ id: "SEC-001", severity: "critical", summary: "Remote code execution in v1.2.0" }],
      }, "1.2.0");
      expect(res4.admissible).toBe(false);
      expect(res4.reason).toContain("critical security advisory SEC-001");
    });
  });

  describe("Safe Bounded Archive Extraction Staging (CAT-02)", () => {
    async function createZipBuffer(files: Record<string, string | Buffer>): Promise<Buffer> {
      const zip = new JSZip();
      for (const [filePath, content] of Object.entries(files)) {
        zip.file(filePath, content);
      }
      return zip.generateAsync({ type: "nodebuffer" });
    }

    it("successfully extracts valid plugin archive to staging directory", async () => {
      const zipBuf = await createZipBuffer({
        "manifest.json": JSON.stringify({ id: "valid.plugin", version: "1.0.0", name: "Valid" }),
        "dist/index.js": "export default {};",
        "assets/styles.css": "body { color: red; }",
      });

      const stagingDir = path.join(tempDir, "staged-plugin-1");
      const result = await extractPluginArchiveToStaging(zipBuf, stagingDir);

      expect(result.totalFiles).toBe(3);
      expect(result.stagingPath).toBe(stagingDir);
      expect(result.manifestContent).toContain("valid.plugin");
      expect(result.archiveSha256).toBeDefined();
    });

    it("detects and rejects zip slip attacks and path traversal", () => {
      expect(() => sanitizePluginEntryPath("../evil.js")).toThrowError(ArchiveExtractionError);
      expect(() => sanitizePluginEntryPath("dir/../../evil.js")).toThrowError(ArchiveExtractionError);
      expect(() => sanitizePluginEntryPath("/absolute/evil.js")).toThrowError(ArchiveExtractionError);
      expect(() => sanitizePluginEntryPath("C:/windows/evil.js")).toThrowError(ArchiveExtractionError);
      expect(() => sanitizePluginEntryPath("dir/null\0byte.js")).toThrowError(ArchiveExtractionError);
    });

    it("rejects archives with forbidden executable binaries (.exe, .sh)", async () => {
      const zipBuf = await createZipBuffer({
        "manifest.json": "{}",
        "bin/exploit.sh": "#!/bin/sh\nrm -rf /",
      });

      const stagingDir = path.join(tempDir, "evil-exec");
      await expect(
        extractPluginArchiveToStaging(zipBuf, stagingDir)
      ).rejects.toThrowError(/forbidden executable/i);
    });

    it("rejects archives missing root manifest.json or plugin.json", async () => {
      const zipBuf = await createZipBuffer({
        "readme.txt": "Just a readme",
        "src/code.js": "console.log('hi');",
      });

      const stagingDir = path.join(tempDir, "missing-manifest");
      await expect(
        extractPluginArchiveToStaging(zipBuf, stagingDir)
      ).rejects.toThrowError(/must contain a root 'manifest.json'/i);
    });

    it("rejects decompression bombs exceeding uncompressed size limits", async () => {
      const hugeBuffer = Buffer.alloc(100_000, "X");
      const zipBuf = await createZipBuffer({
        "manifest.json": "{}",
        "data.txt": hugeBuffer,
      });

      const stagingDir = path.join(tempDir, "decompression-bomb");
      await expect(
        extractPluginArchiveToStaging(zipBuf, stagingDir, {
          maxUncompressedTotalBytes: 50_000, // lower limit to trigger check
        })
      ).rejects.toThrowError(/exceeds limit/i);
    });
  });

  describe("Third-Party Marketplace Foundations (M6)", () => {
    it("handles publisher lifecycle: register, verify, suspend", () => {
      const service = new MarketplaceService();

      const pub = service.registerPublisher({
        id: "pub_01",
        name: "Acme Extensions",
        contactEmail: "security@acme.com",
      });
      expect(pub.status).toBe("pending");
      expect(pub.verified).toBe(false);

      const verified = service.verifyPublisher("pub_01");
      expect(verified.status).toBe("verified");
      expect(verified.verified).toBe(true);

      const suspended = service.suspendPublisher("pub_01", "Terms violation");
      expect(suspended.status).toBe("suspended");
      expect(suspended.suspensionReason).toBe("Terms violation");
    });

    it("automatically revokes listings when a publisher is suspended", () => {
      const service = new MarketplaceService();
      service.registerPublisher({ id: "pub_rogue", name: "Rogue", contactEmail: "rogue@evil.com" });

      const listing: any = {
        id: "rogue.plugin",
        version: "1.0.0",
        name: "Rogue Plugin",
        description: "Suspicious",
        publisher: { id: "pub_rogue", name: "Rogue", verified: false },
        releaseDigest: "sha256:d8a2301982301928301928301928301928301928301928301928301928301928",
        archiveSha256: "b".repeat(64),
        sourceArchiveUrl: "https://example.com/archive.zip",
        compatibility: { minVibressApiVersion: "1.0.0", maxVibressApiVersion: "1.0.0", sdkAbiVersion: "1.0.0" },
        declaredCapabilities: [],
        trustTier: "untrusted_marketplace",
        isRevoked: false,
        downloadsCount: 10,
        rating: 4,
        featured: false,
        publishedAt: new Date().toISOString(),
      };

      service.addOrUpdateListing(listing);
      expect(service.searchListings({})).toHaveLength(1);

      // Suspend publisher
      service.suspendPublisher("pub_rogue", "Malicious activity");

      // Verify listing is revoked
      const listings = service.searchListings({ includeRevoked: true });
      expect(listings[0]?.isRevoked).toBe(true);
      expect(listings[0]?.revocationReason).toContain("Publisher suspended");
    });

    it("enforces fail-closed isolation gate for untrusted marketplace installations", () => {
      const service = new MarketplaceService();
      const digest = "sha256:1111222233334444555566667777888899990000111122223333444455556666";

      const untrustedListing: any = {
        id: "community.counter",
        version: "1.0.0",
        name: "Community Counter",
        description: null,
        publisher: { id: "pub_dev", name: "Dev", verified: false },
        releaseDigest: digest,
        archiveSha256: "c".repeat(64),
        sourceArchiveUrl: "https://example.com/counter.zip",
        compatibility: { minVibressApiVersion: "1.0.0", maxVibressApiVersion: "1.0.0", sdkAbiVersion: "1.0.0" },
        declaredCapabilities: [],
        trustTier: "untrusted_marketplace",
        isRevoked: false,
        downloadsCount: 5,
        rating: 5,
        featured: false,
        publishedAt: new Date().toISOString(),
      };

      service.addOrUpdateListing(untrustedListing);

      // 1. In-host installation without Tier 2 isolation is DENIED
      const inHostAuth = service.authorizeMarketplaceInstall(
        {
          pluginId: "community.counter",
          releaseDigest: digest,
          publicationId: "pub_main",
          operatorId: "op_01",
          requireTier2Isolation: false, // NOT isolated
        },
        "1.0.0",
      );
      expect(inHostAuth.authorized).toBe(false);
      expect(inHostAuth.reason).toContain("Tier 2");

      // 2. Installation WITH Tier 2 isolation is AUTHORIZED
      const isolatedAuth = service.authorizeMarketplaceInstall(
        {
          pluginId: "community.counter",
          releaseDigest: digest,
          publicationId: "pub_main",
          operatorId: "op_01",
          requireTier2Isolation: true, // Isolated
        },
        "1.0.0",
      );
      expect(isolatedAuth.authorized).toBe(true);
    });
  });

  describe("Developer CLI Tooling (TOOL-01)", () => {
    it("scaffolds, validates, packages, and signs a plugin project", () => {
      const pluginDir = path.join(tempDir, "scaffolded-plugin");

      // 1. Init
      cliInit(pluginDir, {
        id: "com.example.hello-cli",
        name: "Hello CLI Plugin",
      });

      // 2. Validate
      const manifestPath = path.join(pluginDir, "manifest.json");
      const validation = cliValidate(manifestPath);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // 3. Package
      const pkg = cliPackage(pluginDir);
      expect(pkg.pluginId).toBe("com.example.hello-cli");
      expect(pkg.version).toBe("1.0.0");
      expect(pkg.releaseDigest).toHaveLength(64);

      // 4. Keygen & Sign
      const { publicKeyPem, privateKeyPem } = cliGenerateKeypair();
      const signature = cliSign(pkg.manifestJson, privateKeyPem);
      expect(signature).toBeDefined();

      // 5. Verify
      const isValid = cliVerify(pkg.manifestJson, signature, publicKeyPem);
      expect(isValid).toBe(true);

      // 6. Tamper check
      const isTamperedValid = cliVerify(pkg.manifestJson + "tampered", signature, publicKeyPem);
      expect(isTamperedValid).toBe(false);
    });
  });
});
