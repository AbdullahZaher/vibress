import { generateKeyPairSync, sign, verify, createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { definePlugin, type PluginDefinition } from "./index.js";

export interface PluginCliInitOptions {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly author?: string | undefined;
}

export interface PluginCliValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly manifest?: Record<string, unknown> | undefined;
}

export interface PluginCliPackageResult {
  readonly pluginId: string;
  readonly version: string;
  readonly releaseDigest: string;
  readonly manifestJson: string;
  readonly entrypointFile: string;
}

/**
 * Initializes a new Vibress plugin scaffold in target directory.
 */
export function cliInit(targetDir: string, options: PluginCliInitOptions): void {
  mkdirSync(path.join(targetDir, "src"), { recursive: true });

  const manifest = {
    id: options.id,
    name: options.name,
    version: "1.0.0",
    description: options.description || "A custom Vibress plugin",
    author: options.author || "Community Contributor",
    minVibressApiVersion: "1.0.0",
    maxVibressApiVersion: "1.0.0",
    sdkAbiVersion: "1.0.0",
    entrypoint: "dist/index.js",
    capabilities: [
      "admin.navigation",
      "admin.views",
      "extension.storage.read",
      "extension.storage.write",
    ],
  };

  const sampleSource = `import { definePlugin } from "@vibress/plugin-sdk";

export default definePlugin({
  id: "${options.id}",
  name: "${options.name}",
  version: "1.0.0",
  capabilities: [
    "admin.navigation",
    "admin.views",
    "extension.storage.read",
    "extension.storage.write",
  ],
  admin: {
    navItems: [
      {
        id: "${options.id}.dashboard",
        label: {
          key: "nav.dashboard",
          en: "Overview",
          ar: "نظرة عامة",
        },
        path: "/plugins/${options.id}",
        icon: "dashboard",
      },
    ],
    pages: [
      {
        id: "${options.id}.overview",
        route: "/plugins/${options.id}",
        title: {
          key: "page.overview.title",
          en: "${options.name} Overview",
          ar: "نظرة عامة على ${options.name}",
        },
        viewId: "overview_view",
      },
    ],
  },
  setup: async (context) => {
    // Plugin initialization
  },
});
`;

  writeFileSync(path.join(targetDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(path.join(targetDir, "src", "index.ts"), sampleSource, "utf8");
}

/**
 * Validates a manifest JSON file for required fields, version constraints, and capability safety.
 */
export function cliValidate(manifestPath: string): PluginCliValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(manifestPath)) {
    return { valid: false, errors: [`Manifest file not found: ${manifestPath}`], warnings };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err: unknown) {
    return { valid: false, errors: [`Manifest JSON is malformed: ${(err as Error).message}`], warnings };
  }

  const manifest = raw as Record<string, unknown>;

  if (!manifest.id || typeof manifest.id !== "string") {
    errors.push("Missing or invalid string field: 'id'");
  } else if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(manifest.id)) {
    errors.push("Field 'id' must be alphanumeric with dots and hyphens");
  }

  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push("Missing or invalid string field: 'name'");
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push("Missing or invalid string field: 'version'");
  } else if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) {
    errors.push("Field 'version' must follow semantic versioning (e.g. 1.0.0)");
  }

  if (!Array.isArray(manifest.capabilities)) {
    errors.push("Field 'capabilities' must be an array of strings");
  } else if (manifest.capabilities.length === 0) {
    warnings.push("Plugin declares no capabilities. It will run with minimal default privileges.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest,
  };
}

/**
 * Validates files and computes a deterministic SHA-256 release digest for a plugin directory.
 */
export function cliPackage(pluginDir: string): PluginCliPackageResult {
  const manifestPath = path.join(pluginDir, "manifest.json");
  const validation = cliValidate(manifestPath);
  if (!validation.valid || !validation.manifest) {
    throw new Error(`Cannot package invalid plugin:\n${validation.errors.join("\n")}`);
  }

  const manifestText = readFileSync(manifestPath, "utf8");
  const manifestObj = validation.manifest;
  const entrypoint = (manifestObj.entrypoint as string) || "dist/index.js";
  const entrypointPath = path.join(pluginDir, entrypoint);

  let entrypointBytes = Buffer.alloc(0);
  if (existsSync(entrypointPath)) {
    entrypointBytes = readFileSync(entrypointPath);
  }

  const releaseDigest = createHash("sha256")
    .update(manifestText)
    .update(entrypointBytes)
    .digest("hex");

  return {
    pluginId: String(manifestObj.id),
    version: String(manifestObj.version),
    releaseDigest,
    manifestJson: manifestText,
    entrypointFile: entrypoint,
  };
}

/**
 * Signs payload bytes using an Ed25519 private key.
 */
export function cliSign(payload: Buffer | string, privateKeyPem: string): string {
  const privateKey = createPrivateKey(privateKeyPem);
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const signature = sign(null, data, privateKey);
  return signature.toString("base64");
}

/**
 * Verifies an Ed25519 signature over payload bytes.
 */
export function cliVerify(
  payload: Buffer | string,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
    return verify(null, data, publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Keypair generation utility for developer signing keys.
 */
export function cliGenerateKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}
