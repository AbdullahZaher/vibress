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
  publicationId?: string | undefined;
  settings: Record<string, unknown>;
  getSecret(key: string): Promise<string | null>;
  log(message: string, level?: "info" | "warn" | "error"): void;
  hasCapability?(capability: string): boolean;
}

export interface PluginModule {
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  onEvent?(eventName: string, payload: unknown): void | Promise<void>;
}

export const SDK_VERSION = "1.0.0";

export interface PluginCapabilityDefinition {
  id: string;
  name: string;
  description: string;
  scope: "publication" | "platform";
  requiredRole: string;
  publicationBehavior: "isolated" | "global";
  risk: "low" | "medium" | "high" | "critical";
  auditRequired: boolean;
}

export const CAPABILITY_REGISTRY: Record<string, PluginCapabilityDefinition> = {
  "content.read": {
    id: "content.read",
    name: "Read Content",
    description: "Allows reading published and draft posts, pages, and tags within publication scope",
    scope: "publication",
    requiredRole: "editor",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: false,
  },
  "content.write": {
    id: "content.write",
    name: "Write Content",
    description: "Allows creating or updating posts and pages within publication scope",
    scope: "publication",
    requiredRole: "editor",
    publicationBehavior: "isolated",
    risk: "medium",
    auditRequired: true,
  },
  "posts.read": {
    id: "posts.read",
    name: "Read Posts",
    description: "Allows reading posts for metrics, SEO, or transformation within publication scope",
    scope: "publication",
    requiredRole: "editor",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: false,
  },
  "media.read": {
    id: "media.read",
    name: "Read Media",
    description: "Allows reading media assets metadata and URLs within publication scope",
    scope: "publication",
    requiredRole: "author",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: false,
  },
  "media.write": {
    id: "media.write",
    name: "Write Media",
    description: "Allows uploading and processing media assets within publication scope",
    scope: "publication",
    requiredRole: "editor",
    publicationBehavior: "isolated",
    risk: "medium",
    auditRequired: true,
  },
  "publication.read": {
    id: "publication.read",
    name: "Read Publication Settings",
    description: "Allows reading publication profile and metadata",
    scope: "publication",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: false,
  },
  "publication.write": {
    id: "publication.write",
    name: "Modify Publication Settings",
    description: "Allows modifying publication configuration",
    scope: "publication",
    requiredRole: "owner",
    publicationBehavior: "isolated",
    risk: "high",
    auditRequired: true,
  },
  "settings.read": {
    id: "settings.read",
    name: "Read Settings",
    description: "Allows reading general publication settings",
    scope: "publication",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: false,
  },
  "settings.read-own": {
    id: "settings.read-own",
    name: "Read Own Settings",
    description: "Allows plugin to read its own configured settings",
    scope: "publication",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: false,
  },
  "settings.write-own": {
    id: "settings.write-own",
    name: "Write Own Settings",
    description: "Allows plugin to update its own configuration",
    scope: "publication",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: true,
  },
  "email.send": {
    id: "email.send",
    name: "Send Email",
    description: "Allows sending transactional or newsletter emails to publication members",
    scope: "publication",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "high",
    auditRequired: true,
  },
  "webhook.emit": {
    id: "webhook.emit",
    name: "Emit Webhooks",
    description: "Allows triggering outbound webhooks for publication events",
    scope: "publication",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "medium",
    auditRequired: true,
  },
  "webhooks.register": {
    id: "webhooks.register",
    name: "Register Webhooks",
    description: "Allows subscribing external endpoints to publication webhooks",
    scope: "publication",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "medium",
    auditRequired: true,
  },
  "analytics.read": {
    id: "analytics.read",
    name: "Read Analytics",
    description: "Allows reading aggregated traffic and post metrics for publication",
    scope: "publication",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: false,
  },
  "events.subscribe": {
    id: "events.subscribe",
    name: "Subscribe to Events",
    description: "Allows listening to platform and publication lifecycle events",
    scope: "platform",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: false,
  },
  "events.read": {
    id: "events.read",
    name: "Read Event Payloads",
    description: "Allows receiving event payloads for analytics and monitoring",
    scope: "platform",
    requiredRole: "admin",
    publicationBehavior: "isolated",
    risk: "low",
    auditRequired: false,
  },
  "storage.provider": {
    id: "storage.provider",
    name: "Custom Storage Provider",
    description: "Registers custom media/asset storage backend",
    scope: "platform",
    requiredRole: "superadmin",
    publicationBehavior: "global",
    risk: "critical",
    auditRequired: true,
  },
  "admin.navigation": {
    id: "admin.navigation",
    name: "Admin Navigation Links",
    description: "Contributes custom navigation items in admin dashboard",
    scope: "platform",
    requiredRole: "admin",
    publicationBehavior: "global",
    risk: "low",
    auditRequired: false,
  },
};

export const SUPPORTED_CAPABILITIES = Object.keys(CAPABILITY_REGISTRY) as readonly string[];

export type SupportedCapability = keyof typeof CAPABILITY_REGISTRY;

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
