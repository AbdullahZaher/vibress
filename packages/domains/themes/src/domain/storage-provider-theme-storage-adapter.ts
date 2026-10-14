import crypto from "node:crypto";
import net from "node:net";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { StorageProvider } from "@vibress/storage-core";
import {
  ThemeStorageAdapter,
  validateStorageThemeId,
  validateStorageVersion,
  validateStoragePublicationId,
  validateThemeRelativePath,
} from "./theme-storage";

export interface ThemePackageManifest {
  format?: "v2" | undefined;
  generation?: string | undefined;
  previousGeneration?: string | undefined;
  files: string[];
  previousFiles?: string[] | undefined;
  createdAt?: string | undefined;
}

export function isPrivateOrRestrictedIP(ip: string): boolean {
  // Normalize IPv6 representation (strip brackets if any)
  let cleanIp = ip.replace(/^\[|\]$/g, "").trim().toLowerCase();

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1 or ::ffff:a9fe:a9fe)
  if (cleanIp.startsWith("::ffff:")) {
    const rest = cleanIp.slice(7);
    if (net.isIPv4(rest)) {
      cleanIp = rest;
    } else {
      // Hex format like 7f00:0001 or a9fe:a9fe
      const [h0, h1] = rest.split(":");
      if (h0 !== undefined && h1 !== undefined) {
        const p1 = parseInt(h0, 16);
        const p2 = parseInt(h1, 16);
        if (!isNaN(p1) && !isNaN(p2)) {
          cleanIp = `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
        }
      }
    }
  }

  // IPv4 checks
  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [p0, p1] = parts;
    if (p0 === undefined || p1 === undefined) {
      return true;
    }
    // 0.0.0.0/8 (Current network)
    if (p0 === 0) return true;
    // 10.0.0.0/8 (Private RFC 1918)
    if (p0 === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (p0 === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata AWS/GCP/Azure)
    if (p0 === 169 && p1 === 254) return true;
    // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 - 172.31.255.255)
    if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
    // 192.168.0.0/16 (Private RFC 1918)
    if (p0 === 192 && p1 === 168) return true;
    // 100.64.0.0/10 (Carrier-grade NAT RFC 6598)
    if (p0 === 100 && p1 >= 64 && p1 <= 127) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (p0 === 192 && p1 === 0) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (p0 === 198 && (p1 === 18 || p1 === 19)) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (p0 >= 224) return true;
    return false;
  }

  // IPv6 checks
  if (net.isIPv6(cleanIp)) {
    // ::1 (Loopback)
    if (cleanIp === "::1" || cleanIp === "0:0:0:0:0:0:0:1") return true;
    // :: (Unspecified)
    if (cleanIp === "::" || cleanIp === "0:0:0:0:0:0:0:0") return true;
    // fe80::/10 (Link-local unicast)
    if (/^fe[89ab][0-9a-f]:/i.test(cleanIp) || cleanIp.startsWith("fe80:")) return true;
    // fc00::/7 (Unique local address ULA: fc00::/8 and fd00::/8)
    if (/^f[cd][0-9a-f]{2}:/i.test(cleanIp) || cleanIp.startsWith("fc") || cleanIp.startsWith("fd")) return true;
    // ff00::/8 (Multicast)
    if (cleanIp.startsWith("ff")) return true;
    return false;
  }

  return true;
}

export function isTrustedStorageDestination(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();

  // 1. Check against explicitly configured storage endpoints in environment
  const configuredEndpoints = [
    process.env.STORAGE_S3_ENDPOINT,
    process.env.MINIO_ENDPOINT,
  ].filter((e): e is string => typeof e === "string" && e.length > 0);

  for (const endpoint of configuredEndpoints) {
    try {
      const parsedEndpoint = new URL(endpoint);
      const confHost = parsedEndpoint.hostname.toLowerCase();
      // If the endpoint matches origin exactly (protocol, hostname, port), trust it
      if (parsed.origin === parsedEndpoint.origin) {
        return true;
      }
      // For domain names, allow virtual-hosted bucket subdomains only if port and protocol match
      if (
        !net.isIP(confHost) &&
        confHost !== "localhost" &&
        parsed.port === parsedEndpoint.port &&
        parsed.protocol === parsedEndpoint.protocol &&
        host.endsWith("." + confHost)
      ) {
        return true;
      }
    } catch {
      // Ignore invalid configured endpoint URL
    }
  }

  // 2. AWS S3 host patterns
  if (
    host === "s3.amazonaws.com" ||
    /^([a-z0-9.-]+\.)?s3([.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host)
  ) {
    return true;
  }

  // 3. Cloudflare R2
  if (/^[a-z0-9.-]+\.r2\.cloudflarestorage\.com$/.test(host)) {
    return true;
  }

  // 4. Google Cloud Storage
  if (
    host === "storage.googleapis.com" ||
    /^[a-z0-9.-]+\.storage\.googleapis\.com$/.test(host)
  ) {
    return true;
  }

  // 5. Azure Blob Storage
  if (/^[a-z0-9.-]+\.blob\.core\.windows\.net$/.test(host)) {
    return true;
  }

  return false;
}

export async function fetchSignedUrlSafely(
  rawUrl: string,
  timeoutMs = 5000,
): Promise<{ buffer: Buffer | null; status: number }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid signed URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol in signed URL: ${parsed.protocol}`);
  }

  // 1. Enforce trusted storage destination
  if (!isTrustedStorageDestination(parsed)) {
    throw new Error(`Untrusted storage destination in signed URL: ${parsed.hostname}`);
  }

  // Check if this destination is an explicitly configured local endpoint
  const isExplicitConfiguredEndpoint = (() => {
    const configured = [
      process.env.STORAGE_S3_ENDPOINT,
      process.env.MINIO_ENDPOINT,
    ].filter((e): e is string => typeof e === "string" && e.length > 0);
    for (const ep of configured) {
      try {
        const epUrl = new URL(ep);
        if (parsed.origin === epUrl.origin) {
          return true;
        }
        if (
          !net.isIP(epUrl.hostname) &&
          epUrl.hostname !== "localhost" &&
          parsed.port === epUrl.port &&
          parsed.protocol === epUrl.protocol &&
          parsed.hostname.toLowerCase().endsWith("." + epUrl.hostname.toLowerCase())
        ) {
          return true;
        }
      } catch {
        // Ignore invalid configured endpoint URL
      }
    }
    return false;
  })();

  const cleanHost = parsed.hostname.replace(/^\[|\]$/g, "").trim().toLowerCase();

  // If not an explicit local development endpoint, block local/metadata hostnames
  if (!isExplicitConfiguredEndpoint) {
    if (
      cleanHost === "169.254.169.254" ||
      cleanHost.startsWith("169.254.") ||
      cleanHost === "metadata.google.internal" ||
      cleanHost === "instance-data" ||
      cleanHost === "localhost" ||
      cleanHost.endsWith(".internal") ||
      cleanHost.endsWith(".local") ||
      cleanHost.endsWith(".localhost") ||
      (net.isIP(cleanHost) && isPrivateOrRestrictedIP(cleanHost))
    ) {
      throw new Error(`Restricted hostname or IP in signed URL: ${cleanHost}`);
    }
  }

  // 2. Perform HTTP request with connection-time DNS validation (eliminating DNS rebinding TOCTOU gap)
  return new Promise<{ buffer: Buffer | null; status: number }>((resolve, reject) => {
    const client = parsed.protocol === "https:" ? https : http;

    const req = client.request(
      parsed,
      {
        method: "GET",
        headers: {
          Accept: "*/*",
        },
        lookup: (hostname, options, callback) => {
          dns.lookup(hostname, options, (err, address, family) => {
            if (err) {
              return callback(err, address, family);
            }
            if (!isExplicitConfiguredEndpoint) {
              if (Array.isArray(address)) {
                for (const item of address) {
                  if (isPrivateOrRestrictedIP(item.address)) {
                    return callback(
                      new Error(
                        `Connection-time SSRF blocked: ${hostname} resolved to restricted IP ${item.address}`,
                      ),
                      address,
                      family,
                    );
                  }
                }
              } else if (typeof address === "string") {
                if (isPrivateOrRestrictedIP(address)) {
                  return callback(
                    new Error(
                      `Connection-time SSRF blocked: ${hostname} resolved to restricted IP ${address}`,
                    ),
                    address,
                    family,
                  );
                }
              }
            }
            callback(null, address, family);
          });
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Never follow redirects on signed URLs
        if (status >= 300 && status < 400) {
          res.resume();
          return reject(new Error(`Redirects are not permitted for signed URLs (status ${status})`));
        }

        if (status === 404) {
          res.resume();
          return resolve({ buffer: null, status: 404 });
        }

        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new Error(`Storage provider returned HTTP ${status}`));
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve({ buffer: Buffer.concat(chunks), status });
        });
        res.on("error", (err) => {
          reject(err);
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Signed URL request timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.end();
  });
}

export async function isSafeSignedUrl(rawUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (!isTrustedStorageDestination(parsed)) {
      return false;
    }

    const cleanHost = parsed.hostname.replace(/^\[|\]$/g, "").trim().toLowerCase();

    // Check if this matches explicitly configured S3/storage endpoint
    const isExplicitConfiguredEndpoint = (() => {
      const configured = [
        process.env.STORAGE_S3_ENDPOINT,
        process.env.MINIO_ENDPOINT,
      ].filter((e): e is string => typeof e === "string" && e.length > 0);
      for (const ep of configured) {
        try {
          const epUrl = new URL(ep);
          if (parsed.origin === epUrl.origin) {
            return true;
          }
          if (
            !net.isIP(epUrl.hostname) &&
            epUrl.hostname !== "localhost" &&
            parsed.port === epUrl.port &&
            parsed.protocol === epUrl.protocol &&
            parsed.hostname.toLowerCase().endsWith("." + epUrl.hostname.toLowerCase())
          ) {
            return true;
          }
        } catch {
          // Ignore invalid configured endpoint URL
        }
      }
      return false;
    })();

    if (isExplicitConfiguredEndpoint) {
      return true;
    }

    // Block cloud metadata services and link-local hostnames
    if (
      cleanHost === "169.254.169.254" ||
      cleanHost.startsWith("169.254.") ||
      cleanHost === "metadata.google.internal" ||
      cleanHost === "instance-data"
    ) {
      return false;
    }

    // Block localhost and internal/local domain names
    if (
      cleanHost === "localhost" ||
      cleanHost.endsWith(".internal") ||
      cleanHost.endsWith(".local") ||
      cleanHost.endsWith(".localhost")
    ) {
      return false;
    }

    // If hostname is an IP literal or IPv4-mapped IPv6
    if (net.isIP(cleanHost) || cleanHost.startsWith("::ffff:")) {
      return !isPrivateOrRestrictedIP(cleanHost);
    }

    // Hostname is a domain: perform DNS resolution
    try {
      const addresses = await dns.promises.lookup(cleanHost, { all: true });
      if (!addresses || addresses.length === 0) {
        return false;
      }
      for (const entry of addresses) {
        if (isPrivateOrRestrictedIP(entry.address)) {
          return false;
        }
      }
    } catch {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export class StorageProviderThemeStorageAdapter implements ThemeStorageAdapter {
  constructor(
    private storageProvider: StorageProvider,
    private prefix: string = "themes",
  ) {}

  getThemeRootPath(
    themeId: string,
    version: string,
    publicationId = "pub_default",
  ): string {
    const cleanId = validateStorageThemeId(themeId);
    const cleanVersion = validateStorageVersion(version);
    const cleanPublicationId = validateStoragePublicationId(publicationId);
    if (cleanPublicationId === "pub_default") {
      return `${this.prefix}/${cleanId}/${cleanVersion}`;
    }
    return `${this.prefix}/publications/${cleanPublicationId}/${cleanId}/${cleanVersion}`;
  }

  private getLegacyThemeRootPath(themeId: string, version: string): string {
    const cleanId = validateStorageThemeId(themeId);
    const cleanVersion = validateStorageVersion(version);
    return `${this.prefix}/${cleanId}/${cleanVersion}`;
  }

  private async readObject(key: string): Promise<Buffer | null> {
    if (typeof this.storageProvider.getObjectBuffer === "function") {
      return await this.storageProvider.getObjectBuffer(key);
    }
    if (typeof this.storageProvider.getSignedUrl === "function") {
      const url = await this.storageProvider.getSignedUrl(key, {
        operation: "get",
      });
      const result = await fetchSignedUrlSafely(url, 5000);
      return result.buffer;
    }
    return null;
  }

  private async readIndexManifest(
    themeId: string,
    version: string,
    publicationId = "pub_default",
    allowLegacyFallback = false,
  ): Promise<{
    format: "v1" | "v2";
    generation?: string | undefined;
    previousGeneration?: string | undefined;
    files: string[];
    previousFiles?: string[] | undefined;
    isLegacy: boolean;
    root: string;
  } | null> {
    const scopedRoot = this.getThemeRootPath(themeId, version, publicationId);
    const scopedIndexKey = `${scopedRoot}/__files.json`;

    if (await this.storageProvider.exists(scopedIndexKey)) {
      const buffer = await this.readObject(scopedIndexKey);
      if (buffer) {
        try {
          const parsed = JSON.parse(buffer.toString("utf-8"));
          if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) {
            return {
              format: "v1",
              files: parsed,
              isLegacy: false,
              root: scopedRoot,
            };
          }
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.generation === "string" &&
            Array.isArray(parsed.files) &&
            parsed.files.every((f: unknown) => typeof f === "string")
          ) {
            return {
              format: "v2",
              generation: parsed.generation,
              previousGeneration:
                typeof parsed.previousGeneration === "string"
                  ? parsed.previousGeneration
                  : undefined,
              files: parsed.files,
              previousFiles:
                Array.isArray(parsed.previousFiles) &&
                parsed.previousFiles.every((f: unknown) => typeof f === "string")
                  ? parsed.previousFiles
                  : undefined,
              isLegacy: false,
              root: scopedRoot,
            };
          }
        } catch {
          return null;
        }
      }
      return null;
    }

    if (publicationId !== "pub_default" && allowLegacyFallback) {
      const legacyRoot = this.getLegacyThemeRootPath(themeId, version);
      const legacyIndexKey = `${legacyRoot}/__files.json`;
      if (await this.storageProvider.exists(legacyIndexKey)) {
        const buffer = await this.readObject(legacyIndexKey);
        if (buffer) {
          try {
            const parsed = JSON.parse(buffer.toString("utf-8"));
            if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) {
              return {
                format: "v1",
                files: parsed,
                isLegacy: true,
                root: legacyRoot,
              };
            }
            if (
              parsed &&
              typeof parsed === "object" &&
              typeof parsed.generation === "string" &&
              Array.isArray(parsed.files) &&
              parsed.files.every((f: unknown) => typeof f === "string")
            ) {
              return {
                format: "v2",
                generation: parsed.generation,
                previousGeneration:
                  typeof parsed.previousGeneration === "string"
                    ? parsed.previousGeneration
                    : undefined,
                files: parsed.files,
                previousFiles:
                  Array.isArray(parsed.previousFiles) &&
                  parsed.previousFiles.every((f: unknown) => typeof f === "string")
                    ? parsed.previousFiles
                    : undefined,
                isLegacy: true,
                root: legacyRoot,
              };
            }
          } catch {
            return null;
          }
        }
        return null;
      }
    }

    return null;
  }

  async saveThemeFiles(
    themeId: string,
    version: string,
    files: Map<string, Buffer>,
    publicationId = "pub_default",
  ): Promise<string> {
    const cleanId = validateStorageThemeId(themeId);
    const cleanVersion = validateStorageVersion(version);
    const cleanPublicationId = validateStoragePublicationId(publicationId);

    // Validate all file paths before executing any writes
    for (const relPath of files.keys()) {
      validateThemeRelativePath(relPath);
    }

    const root = this.getThemeRootPath(cleanId, cleanVersion, cleanPublicationId);

    // Read previous manifest if present so we can retain previousGeneration and clean up older generations
    const previousManifest = await this.readIndexManifest(
      cleanId,
      cleanVersion,
      cleanPublicationId,
      false,
    ).catch(() => null);

    const generationId = `gen_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const genPrefix = `${root}/generations/${generationId}`;
    const stagedKeys: string[] = [];
    let manifestUploadAttempted = false;

    try {
      // 1. Upload all files into the new immutable generation
      for (const [relPath, buffer] of files.entries()) {
        const cleanRel = validateThemeRelativePath(relPath);
        const key = `${genPrefix}/${cleanRel}`;
        let contentType = "application/octet-stream";
        if (cleanRel.endsWith(".json")) contentType = "application/json";
        else if (cleanRel.endsWith(".css")) contentType = "text/css";
        else if (cleanRel.endsWith(".liquid") || cleanRel.endsWith(".html"))
          contentType = "text/html";
        else if (cleanRel.endsWith(".webp")) contentType = "image/webp";
        else if (cleanRel.endsWith(".png")) contentType = "image/png";
        else if (cleanRel.endsWith(".jpg") || cleanRel.endsWith(".jpeg"))
          contentType = "image/jpeg";
        else if (cleanRel.endsWith(".svg")) contentType = "image/svg+xml";

        await this.storageProvider.put({
          key,
          body: buffer,
          contentType,
        });
        stagedKeys.push(key);
      }

      // 2. Publish authoritative index manifest pointing to the new generation
      const sortedFiles = Array.from(files.keys())
        .map((f) => f.replace(/\\/g, "/"))
        .sort();
      const manifest: ThemePackageManifest = {
        format: "v2",
        generation: generationId,
        previousGeneration: previousManifest?.generation,
        files: sortedFiles,
        previousFiles: previousManifest?.files,
        createdAt: new Date().toISOString(),
      };

      const indexKey = `${root}/__files.json`;
      manifestUploadAttempted = true;
      await this.storageProvider.put({
        key: indexKey,
        body: Buffer.from(JSON.stringify(manifest)),
        contentType: "application/json",
      });
    } catch (error) {
      if (!manifestUploadAttempted) {
        // A file upload failed before manifest write was ever attempted.
        // Existing manifest is untouched, so clean up all staged keys.
        for (const stagedKey of stagedKeys) {
          await this.storageProvider.delete(stagedKey).catch(() => {});
        }
        throw error;
      }

      // Ambiguous write handling: the manifest write threw or timed out on the client.
      // We must verify whether the storage provider actually committed the manifest.
      const recoveryState = await (async () => {
        try {
          const active = await this.readIndexManifest(
            cleanId,
            cleanVersion,
            cleanPublicationId,
            false,
          );
          return { recoveryReadSuccess: true, activeManifest: active };
        } catch {
          return { recoveryReadSuccess: false, activeManifest: null };
        }
      })();

      if (
        recoveryState.recoveryReadSuccess &&
        recoveryState.activeManifest
      ) {
        if (recoveryState.activeManifest.generation === generationId) {
          // The manifest successfully committed and is active despite the client error/timeout!
          // Never delete the active generation's staged files.
          return root;
        }

        if (recoveryState.activeManifest.previousGeneration === generationId) {
          // A concurrent installer committed after us and became authoritative,
          // but explicitly recorded our generation as its previousGeneration!
          // Our generation is actively referenced and retained for in-flight readers.
          // Never delete our staged files.
          return root;
        }

        if (
          recoveryState.activeManifest.generation &&
          recoveryState.activeManifest.generation !== generationId &&
          recoveryState.activeManifest.previousGeneration !== generationId
        ) {
          // The active manifest was successfully read and positively confirmed to NOT reference
          // our generation as either current or retained previousGeneration.
          // Because manifest write threw on the client AND our generation is completely unreferenced,
          // it is an orphaned staging write and safe to clean up.
          for (const stagedKey of stagedKeys) {
            await this.storageProvider.delete(stagedKey).catch(() => {});
          }
          throw error;
        }
      }

      // Ambiguous/indeterminate failure:
      // Either recovery read threw (network/storage failure), or manifest state could not be verified.
      // Favor data preservation: NEVER delete staged files when authoritative state cannot be verified!
      throw error;
    }

    // 3. Post-activation verification & safe deferred concurrency cleanup
    // Read the authoritative active manifest to confirm our generation became active.
    const verificationState = await (async () => {
      try {
        const active = await this.readIndexManifest(
          cleanId,
          cleanVersion,
          cleanPublicationId,
          false,
        );
        return { verificationReadSuccess: true, activeManifest: active };
      } catch {
        return { verificationReadSuccess: false, activeManifest: null };
      }
    })();

    if (
      verificationState.verificationReadSuccess &&
      verificationState.activeManifest
    ) {
      const activeGen = verificationState.activeManifest.generation;
      const prevGen = verificationState.activeManifest.previousGeneration;

      if (activeGen === generationId) {
        // Our generation is confirmed active.
        // DEFERRED RETENTION: Retain the immediate previous generation (previousManifest.generation)
        // to avoid breaking in-flight readers that already resolved it.
        // Only prune generations older than the previous generation.
        if (previousManifest) {
          if (previousManifest.previousGeneration && previousManifest.previousFiles) {
            for (const staleFile of previousManifest.previousFiles) {
              const oldKey = `${root}/generations/${previousManifest.previousGeneration}/${staleFile}`;
              await this.storageProvider.delete(oldKey).catch(() => {});
            }
          } else if (!previousManifest.generation) {
            // Legacy flat package upgrade cleanup
            for (const staleFile of previousManifest.files) {
              const oldKey = `${root}/${staleFile}`;
              await this.storageProvider.delete(oldKey).catch(() => {});
            }
          }
        }
      } else if (prevGen === generationId) {
        // A concurrent installer committed after us and became authoritative,
        // BUT explicitly recorded our generation as its previousGeneration!
        // Our generation is retained by the authoritative active manifest for in-flight readers.
        // NEVER delete our files, as they are actively referenced.
      } else {
        // A concurrent installer committed after us and became authoritative,
        // and the active manifest does not directly reference our generation.
        // To preserve in-flight readers that may have observed our generation
        // during the transition, do NOT delete our staged files synchronously.
        // Deferred GC (or subsequent generation writes) will prune older generations.
      }
    } else {
      // Indeterminate state: verification read threw or active manifest state could not be confirmed.
      // Never delete our staged generation when authoritative state cannot be verified!
    }

    return root;
  }

  async getThemeFile(
    themeId: string,
    version: string,
    relativePath: string,
    publicationId = "pub_default",
    allowLegacyFallback = false,
    generation?: string,
  ): Promise<Buffer | null> {
    let cleanRel: string;
    try {
      cleanRel = validateThemeRelativePath(relativePath);
      validateStorageThemeId(themeId);
      validateStorageVersion(version);
      validateStoragePublicationId(publicationId);
    } catch {
      return null;
    }

    const root = this.getThemeRootPath(themeId, version, publicationId);

    // If caller explicitly requested a specific generation (e.g. an in-flight reader):
    if (generation) {
      if (!/^[a-zA-Z0-9_-]+$/.test(generation)) {
        return null;
      }
      const specificKey = `${root}/generations/${generation}/${cleanRel}`;
      const buf = await this.readObject(specificKey).catch(() => null);
      if (buf) {
        return buf;
      }
      if (publicationId !== "pub_default" && allowLegacyFallback) {
        const legacyRoot = this.getLegacyThemeRootPath(themeId, version);
        const legacyKey = `${legacyRoot}/generations/${generation}/${cleanRel}`;
        return this.readObject(legacyKey).catch(() => null);
      }
      return null;
    }

    const manifest = await this.readIndexManifest(
      themeId,
      version,
      publicationId,
      allowLegacyFallback,
    ).catch(() => null);

    if (manifest) {
      if (manifest.files.includes(cleanRel)) {
        const key = manifest.generation
          ? `${manifest.root}/generations/${manifest.generation}/${cleanRel}`
          : `${manifest.root}/${cleanRel}`;
        return this.readObject(key).catch(() => null);
      }
      return null;
    }

    // Unindexed legacy fallback support (e.g. older files directly at legacyRoot)
    if (publicationId !== "pub_default" && allowLegacyFallback) {
      const legacyRoot = this.getLegacyThemeRootPath(themeId, version);
      const key = `${legacyRoot}/${cleanRel}`;
      try {
        if (await this.storageProvider.exists(key)) {
          return await this.readObject(key);
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  async listThemeFiles(
    themeId: string,
    version: string,
    publicationId = "pub_default",
    allowLegacyFallback = false,
  ): Promise<string[]> {
    try {
      validateStorageThemeId(themeId);
      validateStorageVersion(version);
      validateStoragePublicationId(publicationId);
    } catch {
      return [];
    }

    const manifest = await this.readIndexManifest(
      themeId,
      version,
      publicationId,
      allowLegacyFallback,
    ).catch(() => null);

    if (manifest) {
      return manifest.files.slice().sort();
    }

    return [];
  }

  async getThemeFilesMap(
    themeId: string,
    version: string,
    publicationId = "pub_default",
    allowLegacyFallback = false,
  ): Promise<Map<string, string>> {
    try {
      validateStorageThemeId(themeId);
      validateStorageVersion(version);
      validateStoragePublicationId(publicationId);
    } catch {
      return new Map();
    }

    // Resolve authoritative manifest snapshot once for all file reads in this operation
    const manifest = await this.readIndexManifest(
      themeId,
      version,
      publicationId,
      allowLegacyFallback,
    ).catch(() => null);

    const map = new Map<string, string>();
    if (!manifest) {
      return map;
    }

    // Pin generation snapshot to guarantee consistent, untorn reads across all files
    const pinnedGeneration = manifest.generation;
    const targetRoot = manifest.root;

    for (const f of manifest.files) {
      if (
        f.endsWith(".liquid") ||
        f.endsWith(".html") ||
        f.endsWith(".json") ||
        f.endsWith(".css") ||
        f.endsWith(".md") ||
        f.endsWith(".txt")
      ) {
        const key = pinnedGeneration
          ? `${targetRoot}/generations/${pinnedGeneration}/${f}`
          : `${targetRoot}/${f}`;
        const buf = await this.readObject(key).catch(() => null);

        if (buf) {
          map.set(f, buf.toString("utf-8"));
        }
      }
    }

    return map;
  }

  async deleteThemeFiles(
    themeId: string,
    version: string,
    publicationId = "pub_default",
  ): Promise<void> {
    try {
      validateStorageThemeId(themeId);
      validateStorageVersion(version);
      validateStoragePublicationId(publicationId);
    } catch {
      return;
    }

    const root = this.getThemeRootPath(themeId, version, publicationId);
    const manifest = await this.readIndexManifest(
      themeId,
      version,
      publicationId,
      false,
    ).catch(() => null);

    if (manifest) {
      if (manifest.generation) {
        for (const f of manifest.files) {
          const key = `${root}/generations/${manifest.generation}/${f}`;
          await this.storageProvider.delete(key).catch(() => {});
        }
      } else {
        for (const f of manifest.files) {
          const key = `${root}/${f}`;
          await this.storageProvider.delete(key).catch(() => {});
        }
      }
      // Also delete files in retained previous generation
      if (manifest.previousGeneration && manifest.previousFiles) {
        for (const f of manifest.previousFiles) {
          const key = `${root}/generations/${manifest.previousGeneration}/${f}`;
          await this.storageProvider.delete(key).catch(() => {});
        }
      }
      await this.storageProvider.delete(`${root}/__files.json`).catch(() => {});
    }
  }

  async themeExists(
    themeId: string,
    version: string,
    publicationId = "pub_default",
    allowLegacyFallback = false,
  ): Promise<boolean> {
    try {
      validateStorageThemeId(themeId);
      validateStorageVersion(version);
      validateStoragePublicationId(publicationId);
    } catch {
      return false;
    }

    const manifest = await this.readIndexManifest(
      themeId,
      version,
      publicationId,
      allowLegacyFallback,
    ).catch(() => null);

    if (manifest) {
      if (!manifest.files.includes("theme.json")) {
        return false;
      }
      const key = manifest.generation
        ? `${manifest.root}/generations/${manifest.generation}/theme.json`
        : `${manifest.root}/theme.json`;
      return this.storageProvider.exists(key);
    }

    if (publicationId !== "pub_default" && allowLegacyFallback) {
      const legacyKey = `${this.getLegacyThemeRootPath(themeId, version)}/theme.json`;
      return this.storageProvider.exists(legacyKey);
    }

    return false;
  }
}
