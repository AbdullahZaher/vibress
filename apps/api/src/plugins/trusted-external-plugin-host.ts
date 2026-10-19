import { createHash } from "node:crypto";
import { readFile, realpath, stat, lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { validateManifest, type PluginManifest, type PluginModule } from "@vibress/plugin-sdk";
import type { Plugin } from "@vibress/plugins";

/**
 * Operator-installed trusted, single-file ESM entrypoints.
 * No runtime npm install, Admin ZIP upload, or sandboxing.
 * The operator-owned lockfile pins the compiled module's exact bytes;
 * transitive code and Node privileges remain a TRUSTED code responsibility.
 */
const pinnedPluginSchema = z.object({
  manifest: z.unknown(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
const lockfileSchema = z.object({
  schemaVersion: z.literal(1),
  plugins: z.array(pinnedPluginSchema).max(64),
}).strict();

const MAX_LOCKFILE_BYTES = 128 * 1024;
const MAX_MODULE_BYTES = 8 * 1024 * 1024;

type PinnedPlugin = {
  manifest: PluginManifest;
  sha256: string;
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
    result.set(manifest.id, { manifest, sha256: entry.sha256.toLowerCase() });
  }
  return result;
}

function manifestMatchesInstalled(plugin: Plugin, installed: PluginManifest): boolean {
  return plugin.manifestId === installed.id &&
    plugin.version === installed.version &&
    plugin.vibressApiVersion === installed.vibressApiVersion &&
    plugin.entrypoint === installed.entrypoint &&
    plugin.capabilities.length === installed.capabilities.length &&
    plugin.capabilities.every((cap) => installed.capabilities.includes(cap)) &&
    plugin.hooks.length === (installed.hooks ?? []).length &&
    plugin.hooks.every((hook) => (installed.hooks ?? []).includes(hook));
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
    if (!path.isAbsolute(this.lockfilePath)) {
      throw new Error("Trusted plugin lockfile must use an absolute path");
    }
    const lockfileStats = await lstat(this.lockfilePath);
    if (!lockfileStats.isFile() || lockfileStats.isSymbolicLink() ||
      lockfileStats.size > MAX_LOCKFILE_BYTES) {
      throw new Error("Invalid trusted plugin lockfile");
    }
    const json: unknown = JSON.parse(await readFile(this.lockfilePath, "utf8"));
    return [...parseTrustedPluginLockfile(json).values()].map((p) => p.manifest);
  }

  async loadModule(plugin: Plugin): Promise<PluginModule | null> {
    if (!this.lockfilePath) return null;
    if (!path.isAbsolute(this.lockfilePath)) throw new Error("Trusted plugin lockfile must use an absolute path");

    const lockfileStats = await lstat(this.lockfilePath);
    if (!lockfileStats.isFile() || lockfileStats.isSymbolicLink() ||
      lockfileStats.size > MAX_LOCKFILE_BYTES) {
      throw new Error("Invalid trusted plugin lockfile");
    }
    const json: unknown = JSON.parse(await readFile(this.lockfilePath, "utf8"));
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
