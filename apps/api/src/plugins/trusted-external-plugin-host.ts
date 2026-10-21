import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile, realpath, stat, lstat } from "node:fs/promises";
import path from "node:path";
import { readTrustedPluginLockfile } from "./trusted-release-attestation";
import { z } from "zod";
import { validateManifest, type PluginManifest, type PluginModule } from "@vibress/plugin-sdk";
import { validateStorageModel, type ApprovedPluginPhysicalModel } from "@vibress/plugins";
import type { Plugin } from "@vibress/plugins";

/**
 * Operator-installed trusted, single-file ESM entrypoints.
 * No runtime npm install, Admin ZIP upload, or sandboxing.
 * The operator-owned lockfile pins the compiled module's exact bytes;
 * transitive code and Node privileges remain a TRUSTED code responsibility.
 */
const approvedColumnSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  type: z.enum(["text", "integer", "boolean", "timestamptz"]),
  required: z.boolean(),
}).strict();
const approvedModelSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  schemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
  columns: z.array(approvedColumnSchema).min(1).max(24),
}).strict();
/** EXT-301B1: opt-in, operator-pinned single-file HTML UI artifacts.
 * This approves bytes only; it does NOT make them executable in Studio.
 */
const approvedAdminUiAssetSchema = z.object({
  viewId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  // No schemes, absolute paths, dot segments, query strings or backslashes.
  path: z.string().max(240).regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.html$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
const pinnedPluginSchema = z.object({
  manifest: z.unknown(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  // Optional operator-reviewed descriptors; legacy lockfiles stay valid.
  storageModels: z.array(approvedModelSchema).max(16).optional(),
  adminUiAssets: z.array(approvedAdminUiAssetSchema).max(8).optional(),
}).strict();
const lockfileSchema = z.object({
  schemaVersion: z.literal(1),
  plugins: z.array(pinnedPluginSchema).max(64),
}).strict();

const MAX_MODULE_BYTES = 8 * 1024 * 1024;
const MAX_ADMIN_UI_ASSET_BYTES = 256 * 1024;

type PinnedPlugin = {
  manifest: PluginManifest;
  sha256: string;
  storageModels: readonly ApprovedPluginPhysicalModel[];
  adminUiAssets: readonly {
    viewId: string;
    path: string;
    sha256: string;
  }[];
};

export function parseTrustedPluginLockfile(input: unknown): ReadonlyMap<string, PinnedPlugin> {
  const data = lockfileSchema.parse(input);
  const result = new Map<string, PinnedPlugin>();
  for (const entry of data.plugins) {
    const manifest = validateManifest(entry.manifest);
    if (result.has(manifest.id)) throw new Error("Duplicate trusted plugin ID");
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(manifest.entrypoint)) {
      throw new Error("Trusted entrypoint must be a relative .mjs file within the lockfile directory");
    }
    const storageModels = entry.storageModels ?? [];
    const modelKeys = new Set<string>();
    for (const model of storageModels) {
      validateStorageModel(model);
      if (modelKeys.has(model.key)) throw new Error("Duplicate approved storage model key");
      modelKeys.add(model.key);
    }
    if (storageModels.length > 0 &&
        !manifest.capabilities.some((capability) =>
          capability === "extension.storage.read" || capability === "extension.storage.write")) {
      throw new Error("Approved storage models require declared storage capability");
    }
    const adminUiAssets = entry.adminUiAssets ?? [];
    if (adminUiAssets.length > 0 &&
        (!manifest.capabilities.includes("admin.navigation") ||
         !manifest.capabilities.includes("extension.routes.admin"))) {
      throw new Error("Approved Admin UI assets require declared Admin route and navigation capabilities");
    }
    const viewIds = new Set<string>();
    const assetPaths = new Set<string>();
    for (const asset of adminUiAssets) {
      if (viewIds.has(asset.viewId) || assetPaths.has(asset.path)) {
        throw new Error("Duplicate approved Admin UI view ID or asset path");
      }
      viewIds.add(asset.viewId);
      assetPaths.add(asset.path);
    }
    result.set(manifest.id, {
      manifest, sha256: entry.sha256.toLowerCase(), storageModels,
      adminUiAssets: adminUiAssets.map((asset) => ({ ...asset, sha256: asset.sha256.toLowerCase() })),
    });
  }
  return result;
}

function manifestMatchesInstalled(plugin: Plugin, installed: PluginManifest): boolean {
  return plugin.manifestId === installed.id &&
    plugin.name === installed.name &&
    plugin.description === (installed.description ?? null) &&
    plugin.version === installed.version &&
    plugin.vibressApiVersion === installed.vibressApiVersion &&
    plugin.entrypoint === installed.entrypoint &&
    isDeepStrictEqual(plugin.capabilities, installed.capabilities) &&
    isDeepStrictEqual(plugin.hooks, installed.hooks ?? []) &&
    isDeepStrictEqual(plugin.settingsSchema, installed.settingsSchema ?? {});
}

function isPluginModule(value: unknown): value is PluginModule {
  return typeof value === "object" &&
    value !== null &&
    "activate" in value &&
    typeof value.activate === "function";
}

/**
 * A lockfile is set only by an operator via the service environment.
 * Empty environment means the historical bundled-plugin-only behavior.
 * Every load re-checks the pinned checksum BEFORE importing the module.
 */
export class TrustedExternalPluginHost {
  constructor(private readonly lockfilePath: string | undefined = process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE) {}

  /** Read the operator's approved manifests. Not an Admin-uploaded registry. */
  async listTrustedManifests(): Promise<PluginManifest[]> {
    if (!this.lockfilePath) return [];
    const json = await readTrustedPluginLockfile(this.lockfilePath);
    return [...parseTrustedPluginLockfile(json).values()].map((p) => p.manifest);
  }

  /**
   * Small, operator-owned release identities for metadata cache invalidation.
   * Never expose this map through HTTP. The fingerprint is the pinned final
   * entrypoint digest, not plugin-authored or supplied by a Staff request.
   */
  async listTrustedFingerprints(): Promise<ReadonlyMap<string, string>> {
    if (!this.lockfilePath) return new Map();
    const data = await readTrustedPluginLockfile(this.lockfilePath);
    const fingerprints = new Map<string, string>();
    for (const [id, approved] of parseTrustedPluginLockfile(data)) {
      fingerprints.set(id, approved.sha256);
    }
    return fingerprints;
  }

  /**
   * Operator-maintained lockfile is the only source of reviewed field schemas.
   * A plugin's manifest or HTTP input cannot provide table/column definitions.
   */
  async getApprovedStorageModels(plugin: Plugin): Promise<readonly ApprovedPluginPhysicalModel[]> {
    if (!this.lockfilePath) return [];
    const data = await readTrustedPluginLockfile(this.lockfilePath);
    const approved = parseTrustedPluginLockfile(data).get(plugin.manifestId);
    if (!approved || !manifestMatchesInstalled(plugin, approved.manifest)) {
      throw new Error("Installed plugin differs from operator-approved storage manifest");
    }
    // Defensive copy: plugin code never gets the operator registry reference.
    return approved.storageModels.map((model) => ({
      key: model.key, schemaSha256: model.schemaSha256,
      columns: model.columns.map((column) => ({ ...column })),
    }));
  }

  /**
   * EXT-301B1: read only bytes separately pinned in the operator lockfile.
   * No HTTP/browser exposure is granted by this method. A future route must
   * recheck Staff authorization, publication enablement and view admission;
   * the renderer must use an opaque-origin sandbox and restrictive CSP.
   * Every read rechecks the on-disk SHA-256 to reject tampering and stale nodes.
   */
  async readApprovedAdminUiAsset(plugin: Plugin, viewId: string): Promise<string | null> {
    if (!this.lockfilePath) return null;
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(viewId)) {
      throw new Error("Invalid Admin UI view identifier");
    }
    const json = await readTrustedPluginLockfile(this.lockfilePath);
    const approved = parseTrustedPluginLockfile(json).get(plugin.manifestId);
    if (!approved || !manifestMatchesInstalled(plugin, approved.manifest)) {
      throw new Error("Installed plugin differs from operator-approved Admin UI manifest");
    }
    const asset = approved.adminUiAssets.find((item) => item.viewId === viewId);
    if (!asset) return null;

    const root = await realpath(path.dirname(this.lockfilePath));
    const assetPath = path.resolve(root, asset.path);
    const canonical = await realpath(assetPath);
    if (!canonical.startsWith(root + path.sep)) {
      throw new Error("Approved Admin UI asset escapes its operator directory");
    }
    const fileInfo = await lstat(assetPath);
    const canonicalInfo = await stat(canonical);
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile() ||
        !canonicalInfo.isFile() || fileInfo.size > MAX_ADMIN_UI_ASSET_BYTES ||
        canonicalInfo.size > MAX_ADMIN_UI_ASSET_BYTES) {
      throw new Error("Approved Admin UI asset is not a bounded regular file");
    }
    const bytes = await readFile(canonical);
    if (bytes.length > MAX_ADMIN_UI_ASSET_BYTES) {
      throw new Error("Approved Admin UI asset exceeds size limit");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) throw new Error("Approved Admin UI asset checksum mismatch");
    const document = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (document.includes("\u0000")) throw new Error("Invalid Admin UI document");
    return document;
  }

  async loadModule(plugin: Plugin): Promise<PluginModule | null> {
    if (!this.lockfilePath) return null;
    const json = await readTrustedPluginLockfile(this.lockfilePath);
    const installed = parseTrustedPluginLockfile(json).get(plugin.manifestId);
    if (!installed) return null;
    if (!manifestMatchesInstalled(plugin, installed.manifest)) {
      throw new Error("Registered plugin metadata differs from the trusted operator lockfile");
    }

    const root = await realpath(path.dirname(this.lockfilePath));
    const entry = path.resolve(root, installed.manifest.entrypoint);
    const canonical = await realpath(entry);
    if (!canonical.startsWith(root + path.sep)) throw new Error("Trusted plugin path escapes its approved directory");
    const fileInfo = await lstat(entry);
    const canonicalInfo = await stat(canonical);
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile() ||
      !canonicalInfo.isFile() || canonicalInfo.size > MAX_MODULE_BYTES) {
      throw new Error("Trusted plugin module is not a regular approved file");
    }

    const bytes = await readFile(canonical);
    if (bytes.length > MAX_MODULE_BYTES) throw new Error("Trusted plugin module exceeds size limit");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== installed.sha256) throw new Error("Trusted plugin module checksum mismatch");

    // Import the VERIFIED bytes, not the path: prevents a file replacement
    // between the checksum and Node's subsequent module file read (TOCTOU).
    // External plugins must be reviewed, self-contained ESM bundles.
    // Node builtins/process privileges remain available: this is NOT sandboxing.
    const verifiedModuleUrl = `data:text/javascript;base64,${bytes.toString("base64")}`;
    const exports: unknown = await import(verifiedModuleUrl);
    if (typeof exports !== "object" || exports === null) {
      throw new Error("Trusted plugin module has invalid exports");
    }
    const candidate = "default" in exports ? exports.default : exports;
    if (!isPluginModule(candidate)) throw new Error("Trusted plugin module must export activate()");
    return candidate;
  }
}
