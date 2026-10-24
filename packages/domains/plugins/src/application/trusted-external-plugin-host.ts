import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile, realpath, stat, lstat } from "node:fs/promises";
import path from "node:path";
import { readTrustedPluginLockfile } from "./trusted-release-attestation";
import { z } from "zod";
import { validateManifest, type PluginManifest, type PluginModule } from "@vibress/plugin-sdk";
import { validateStorageModel } from "./plugin-scoped-storage";
import type { ApprovedPluginPhysicalModel } from "./plugin-storage-migrations";
import type { Plugin } from "../domain/plugin";
import { PluginDomainError } from "./plugins-service";

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
  indexedTextFields: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)).max(4).optional(),
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
  // Explicit signed allowlists for non-Staff handlers; omitted in legacy
  // operator lockfiles to preserve existing releases until they are reviewed.
  publicReadModels: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(16).optional(),
  memberReadModels: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(16).optional(),
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
  publicReadModels?: readonly string[];
  memberReadModels?: readonly string[];
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
      const indexes = model.indexedTextFields ?? [];
      if (new Set(indexes).size !== indexes.length ||
          indexes.some((field) => !model.columns.some((column) =>
            column.name === field && column.type === "text"))) {
        throw new Error("Operator index must reference unique approved text fields");
      }
      if (modelKeys.has(model.key)) throw new Error("Duplicate approved storage model key");
      modelKeys.add(model.key);
    }
    for (const allowlist of [entry.publicReadModels, entry.memberReadModels]) {
      if (!allowlist) continue;
      if (new Set(allowlist).size !== allowlist.length ||
          allowlist.some((key) => !modelKeys.has(key))) {
        throw new Error("Operator read allowlist must reference unique approved storage models");
      }
    }
    if (storageModels.length > 0 &&
        !manifest.capabilities.some((capability) =>
          capability === "extension.storage.read" || capability === "extension.storage.write" ||
          capability === "extension.member_storage.read" ||
          capability === "extension.member_storage.write")) {
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
      ...(entry.publicReadModels ? { publicReadModels: entry.publicReadModels } : {}),
      ...(entry.memberReadModels ? { memberReadModels: entry.memberReadModels } : {}),
      adminUiAssets: adminUiAssets.map((asset) => ({ ...asset, sha256: asset.sha256.toLowerCase() })),
    });
  }
  return result;
}

function manifestMatchesInstalled(plugin: Plugin, installed: PluginManifest): boolean {
  return plugin.manifestId === installed.id &&
    plugin.name === installed.name &&
    (plugin.description || null) === (installed.description || null) &&
    plugin.version === installed.version &&
    plugin.vibressApiVersion === installed.vibressApiVersion &&
    plugin.entrypoint === installed.entrypoint &&
    isDeepStrictEqual(plugin.capabilities ?? [], installed.capabilities ?? []) &&
    isDeepStrictEqual(plugin.hooks ?? [], installed.hooks ?? []) &&
    isDeepStrictEqual(plugin.settingsSchema ?? {}, installed.settingsSchema ?? {});
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
  private readonly explicitLockfilePath: string | undefined;

  constructor(lockfilePath?: string) {
    this.explicitLockfilePath = lockfilePath;
  }

  private get lockfilePath(): string | undefined {
    return this.explicitLockfilePath ?? process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE;
  }

  /** Read the operator's approved manifests. Not an Admin-uploaded registry. */
  async listTrustedManifests(): Promise<PluginManifest[]> {
    const lockfile = this.lockfilePath;
    if (!lockfile) return [];
    const json = await readTrustedPluginLockfile(lockfile);
    return [...parseTrustedPluginLockfile(json).values()].map((p) => p.manifest);
  }

  /**
   * Small, operator-owned release identities for metadata cache invalidation.
   * Never expose this map through HTTP. The fingerprint is the pinned final
   * entrypoint digest, not plugin-authored or supplied by a Staff request.
   */
  async listTrustedFingerprints(): Promise<ReadonlyMap<string, string>> {
    const lockfile = this.lockfilePath;
    if (!lockfile) return new Map();
    const data = await readTrustedPluginLockfile(lockfile);
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
    const lockfile = this.lockfilePath;
    if (!lockfile) return [];
    const data = await readTrustedPluginLockfile(lockfile);
    const approved = parseTrustedPluginLockfile(data).get(plugin.manifestId);
    if (!approved || !manifestMatchesInstalled(plugin, approved.manifest)) {
      throw new PluginDomainError(
        "PLUGIN_STORAGE_MODELS_NOT_APPROVED",
        "Installed plugin differs from operator-approved storage manifest",
      );
    }
    // Defensive copy: plugin code never gets the operator registry reference.
    return approved.storageModels.map((model) => ({
      key: model.key, schemaSha256: model.schemaSha256,
      columns: model.columns.map((column) => ({ ...column })),
      ...(model.indexedTextFields ? { indexedTextFields: [...model.indexedTextFields] } : {}),
    }));
  }

  /** Operator-admitted audience-specific read scope, never plugin supplied. */
  async getApprovedAudienceReadModels(
    plugin: Plugin,
    audience: "public" | "member",
  ): Promise<readonly string[] | null> {
    const lockfile = this.lockfilePath;
    if (!lockfile) return null;
    const approved = parseTrustedPluginLockfile(await readTrustedPluginLockfile(lockfile))
      .get(plugin.manifestId);
    if (!approved || !manifestMatchesInstalled(plugin, approved.manifest)) {
      throw new PluginDomainError("PLUGIN_STORAGE_MODELS_NOT_APPROVED",
        "Installed plugin differs from operator-approved storage manifest");
    }
    // null means a legacy lockfile: the caller retains its old model contract.
    const keys = audience === "public"
      ? approved.publicReadModels : approved.memberReadModels;
    return keys === undefined ? null : [...keys];
  }

  /**
   * EXT-301B1: read only bytes separately pinned in the operator lockfile.
   * No HTTP/browser exposure is granted by this method. A future route must
   * recheck Staff authorization, publication enablement and view admission;
   * the renderer must use an opaque-origin sandbox and restrictive CSP.
   * Every read rechecks the on-disk SHA-256 to reject tampering and stale nodes.
   */
  async readApprovedAdminUiAsset(plugin: Plugin, viewId: string): Promise<string | null> {
    const lockfile = this.lockfilePath;
    if (!lockfile) return null;
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(viewId)) {
      throw new PluginDomainError("INVALID_ADMIN_VIEW_ID", "Invalid Admin UI view identifier");
    }
    const json = await readTrustedPluginLockfile(lockfile);
    const approved = parseTrustedPluginLockfile(json).get(plugin.manifestId);
    if (!approved || !manifestMatchesInstalled(plugin, approved.manifest)) {
      throw new PluginDomainError(
        "PLUGIN_ADMIN_UI_NOT_APPROVED",
        "Installed plugin differs from operator-approved Admin UI manifest",
      );
    }
    const asset = approved.adminUiAssets.find((item) => item.viewId === viewId);
    if (!asset) return null;

    const root = await realpath(path.dirname(lockfile));
    const assetPath = path.resolve(root, asset.path);
    const canonical = await realpath(assetPath);
    if (!canonical.startsWith(root + path.sep)) {
      throw new PluginDomainError(
        "PLUGIN_PATH_ESCAPES_ROOT",
        "Approved Admin UI asset escapes its operator directory",
      );
    }
    const fileInfo = await lstat(assetPath);
    const canonicalInfo = await stat(canonical);
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile() ||
        !canonicalInfo.isFile() || fileInfo.size > MAX_ADMIN_UI_ASSET_BYTES ||
        canonicalInfo.size > MAX_ADMIN_UI_ASSET_BYTES) {
      throw new PluginDomainError(
        "PLUGIN_FILE_INVALID",
        "Approved Admin UI asset is not a bounded regular file",
      );
    }
    const bytes = await readFile(canonical);
    if (bytes.length > MAX_ADMIN_UI_ASSET_BYTES) {
      throw new PluginDomainError(
        "PLUGIN_SIZE_LIMIT_EXCEEDED",
        "Approved Admin UI asset exceeds size limit",
      );
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) {
      throw new PluginDomainError(
        "PLUGIN_CHECKSUM_MISMATCH",
        "Approved Admin UI asset checksum mismatch",
      );
    }
    const document = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (document.includes("\u0000")) {
      throw new PluginDomainError("INVALID_ADMIN_UI_DOCUMENT", "Invalid Admin UI document");
    }
    return document;
  }

  async loadModule(plugin: Plugin, expectedReleaseKey?: string): Promise<PluginModule | null> {
    const lockfile = this.lockfilePath;
    if (!lockfile) return null;
    const json = await readTrustedPluginLockfile(lockfile);
    const installed = parseTrustedPluginLockfile(json).get(plugin.manifestId);
    if (!installed) {
      throw new PluginDomainError(
        "PLUGIN_NOT_TRUSTED",
        `Plugin '${plugin.manifestId}' is not registered in trusted operator lockfile`,
      );
    }
    if (!manifestMatchesInstalled(plugin, installed.manifest)) {
      throw new PluginDomainError(
        "PLUGIN_MANIFEST_MISMATCH",
        "Registered plugin metadata differs from the trusted operator lockfile",
      );
    }
    // Revalidate the release admitted before loading: even a newly signed
    // replacement must never evaluate ESM code before the restart guard.
    if (expectedReleaseKey !== undefined &&
        expectedReleaseKey !== JSON.stringify([
          plugin.id, plugin.version, plugin.entrypoint, installed.sha256,
        ])) {
      throw new PluginDomainError(
        "PLUGIN_RESTART_REQUIRED", "Plugin release changed; restart this runtime",
      );
    }

    const root = await realpath(path.dirname(lockfile));
    const entry = path.resolve(root, installed.manifest.entrypoint);
    const canonical = await realpath(entry);
    if (!canonical.startsWith(root + path.sep)) {
      throw new PluginDomainError(
        "PLUGIN_PATH_ESCAPES_ROOT",
        "Trusted plugin path escapes its approved directory",
      );
    }
    const fileInfo = await lstat(entry);
    const canonicalInfo = await stat(canonical);
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile() ||
      !canonicalInfo.isFile() || canonicalInfo.size > MAX_MODULE_BYTES) {
      throw new PluginDomainError(
        "PLUGIN_FILE_INVALID",
        "Trusted plugin module is not a regular approved file",
      );
    }

    const bytes = await readFile(canonical);
    if (bytes.length > MAX_MODULE_BYTES) {
      throw new PluginDomainError(
        "PLUGIN_SIZE_LIMIT_EXCEEDED",
        "Trusted plugin module exceeds size limit",
      );
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== installed.sha256) {
      throw new PluginDomainError(
        "PLUGIN_CHECKSUM_MISMATCH",
        "Trusted plugin module checksum mismatch",
      );
    }

    // Import the VERIFIED bytes, not the path: prevents a file replacement
    // between the checksum and Node's subsequent module file read (TOCTOU).
    // External plugins must be reviewed, self-contained ESM bundles.
    // Node builtins/process privileges remain available: this is NOT sandboxing.
    const verifiedModuleUrl = `data:text/javascript;base64,${bytes.toString("base64")}`;
    const exports: unknown = await import(verifiedModuleUrl);
    if (typeof exports !== "object" || exports === null) {
      throw new PluginDomainError(
        "PLUGIN_ENTRYPOINT_INVALID",
        "Trusted plugin module has invalid exports",
      );
    }
    const candidate = "default" in exports ? exports.default : exports;
    if (!isPluginModule(candidate)) {
      throw new PluginDomainError(
        "PLUGIN_ENTRYPOINT_INVALID",
        "Trusted plugin module must export activate()",
      );
    }
    return candidate;
  }
}
