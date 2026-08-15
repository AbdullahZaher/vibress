import crypto from "crypto";

/**
 * @vibress/plugin-sdk — the ONLY surface plugins may import.
 * Plugins must never import database, admin, or private domain internals.
 */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  vibressApiVersion: string;
  description?: string | undefined;
  entrypoint: string;
  capabilities: string[];
  settingsSchema?: Record<string, unknown> | undefined;
  hooks?: string[] | undefined;
  checksum?: string | undefined;
}

export interface PluginContext {
  manifestId: string;
  name: string;
  version: string;
  settings: Record<string, unknown>;
  getSecret(key: string): Promise<string | null>;
  log(message: string, level?: "info" | "warn" | "error"): void;
}

export interface PluginModule {
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  onEvent?(eventName: string, payload: unknown): void | Promise<void>;
}

export const SDK_VERSION = "1.0.0";

export const SUPPORTED_CAPABILITIES = [
  "events.subscribe",
  "webhooks.register",
  "storage.provider",
  "content.read",
  "admin.navigation",
  "settings.read-own",
  "settings.write-own",
] as const;

export type SupportedCapability = (typeof SUPPORTED_CAPABILITIES)[number];

/**
 * Validates a plugin manifest. Rejects incompatible API versions and
 * unknown capabilities.
 */
export function validateManifest(manifest: unknown): PluginManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be an object");
  }
  const m = manifest as Record<string, unknown>;
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(m.id)) {
    throw new Error("Manifest id must be lowercase alphanumeric with hyphens");
  }
  if (typeof m.name !== "string" || !m.name.trim())
    throw new Error("Manifest name is required");
  if (typeof m.version !== "string" || !m.version.trim())
    throw new Error("Manifest version is required");
  if (typeof m.entrypoint !== "string" || !m.entrypoint.trim())
    throw new Error("Manifest entrypoint is required");
  if (
    typeof m.vibressApiVersion !== "string" ||
    m.vibressApiVersion !== SDK_VERSION
  ) {
    throw new Error(
      `Unsupported Vibress API version: ${String(m.vibressApiVersion)} (expected ${SDK_VERSION})`,
    );
  }
  if (!Array.isArray(m.capabilities))
    throw new Error("Manifest capabilities must be an array");
  for (const cap of m.capabilities as unknown[]) {
    if (
      typeof cap !== "string" ||
      !(SUPPORTED_CAPABILITIES as readonly string[]).includes(cap)
    ) {
      throw new Error(`Unsupported capability: ${String(cap)}`);
    }
  }
  if (m.hooks !== undefined && !Array.isArray(m.hooks))
    throw new Error("Manifest hooks must be an array");

  return {
    id: m.id,
    name: m.name,
    version: m.version,
    vibressApiVersion: m.vibressApiVersion,
    description: typeof m.description === "string" ? m.description : undefined,
    entrypoint: m.entrypoint,
    capabilities: m.capabilities as string[],
    settingsSchema:
      typeof m.settingsSchema === "object" && m.settingsSchema !== null
        ? (m.settingsSchema as Record<string, unknown>)
        : undefined,
    hooks: Array.isArray(m.hooks) ? (m.hooks as string[]) : undefined,
    checksum: typeof m.checksum === "string" ? m.checksum : undefined,
  };
}

/**
 * Verifies SHA-256 cryptographic checksum of plugin code or package artifact.
 */
export function verifyPluginChecksum(
  data: Buffer | string,
  expectedSha256: string,
): boolean {
  const actualHash = crypto
    .createHash("sha256")
    .update(data)
    .digest("hex")
    .toLowerCase();
  return actualHash === expectedSha256.trim().toLowerCase();
}

/**
 * Sandboxed timeout guard for plugin execution.
 */
export async function executeWithTimeout<T>(
  fn: () => Promise<T> | T,
  timeoutMs = 5000,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Plugin execution exceeded timeout of ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(fn()), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
