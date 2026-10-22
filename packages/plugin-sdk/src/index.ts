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

/**
 * EXT-201/202: narrow, host-routed HTTP contributions. Never expose Fastify,
 * cookies, arbitrary tenant selectors, raw SQL, or a mutable host principal.
 */
export type PluginApiAudience = "admin" | "member" | "public";
export type PluginApiMethod = "GET" | "POST";
export type PluginApiScalar = string | number | boolean;
export type PluginApiFieldType = "string" | "number" | "boolean";
export interface PluginApiShape {
  fields: Record<string, PluginApiFieldType>;
  required?: readonly string[] | undefined;
}
/**
 * EXT-203B3: ephemeral, host-created, publication-bound plugin storage.
 * Callers never provide a tenant ID, SQL or table name. Host may omit this
 * capability when operator approval or principal authorization is absent.
 */
export type PluginStorageValue = string | number | boolean | null;
export interface PluginStorageItem {
  readonly id: string;
  readonly version: number;
  readonly fields: Readonly<Record<string, PluginStorageValue>>;
}
export interface PluginStorageResultPage {
  readonly items: readonly PluginStorageItem[];
  readonly nextCursor?: string;
}
export interface PluginStorageApi {
  get(modelKey: string, id: string): Promise<PluginStorageItem | null>;
  list(modelKey: string, limit?: number, cursor?: string): Promise<PluginStorageResultPage>;
  create(
    modelKey: string, id: string, fields: Readonly<Record<string, PluginStorageValue>>,
  ): Promise<PluginStorageItem>;
  update(
    modelKey: string, id: string, expectedVersion: number,
    fields: Readonly<Record<string, PluginStorageValue>>,
  ): Promise<PluginStorageItem>;
}
/**
 * EXT-204: identity and subscription facts for the authenticated member
 * owning this request only. A billing plan is NOT an LMS course entitlement.
 * Never accept member or publication selectors from extension code.
 */
export interface PluginMemberSelf {
  readonly id: string;
  readonly displayName: string | null;
}
export interface PluginMemberAccessApi {
  getSelf(): Promise<PluginMemberSelf | null>;
  /** Checks an existing billing plan, NOT course/lesson enrollment rights. */
  hasActivePlan(planId: string): Promise<boolean>;
}

/** EXT-205: own-member-only records; no member, tenant or SQL selectors. */
export interface PluginMemberStorageApi {
  get(modelKey: string, id: string): Promise<PluginStorageItem | null>;
  list(modelKey: string, limit?: number, cursor?: string): Promise<PluginStorageResultPage>;
  /** Atomic insert. A duplicate returns CONFLICT, never overwrites a record. */
  create(modelKey: string, id: string,
    fields: Readonly<Record<string, PluginStorageValue>>): Promise<PluginStorageItem>;
  /** Optimistic CAS; rejects stale versions and records owned by anyone else. */
  update(modelKey: string, id: string, expectedVersion: number,
    fields: Readonly<Record<string, PluginStorageValue>>): Promise<PluginStorageItem>;
}

export interface PluginApiScope {
  readonly publicationId: string;
  /** Member routes only; capabilities are checked independently per method. */
  readonly memberAccess?: PluginMemberAccessApi | undefined;
  /** Member-only, Host-bound storage. Never contains arbitrary owner selectors. */
  readonly memberStorage?: PluginMemberStorageApi | undefined;
  /** Present only for operator-approved models in an authorized Staff request. */
  readonly storage?: PluginStorageApi | undefined;
  readonly requestId: string;
  /** Host-verified published locale for public SSR, never a tenant selector. */
  readonly locale?: string | undefined;
  readonly principal:
    | { readonly kind: "staff"; readonly id: string }
    | { readonly kind: "member"; readonly id: string }
    | { readonly kind: "anonymous" };
}
export interface PluginApiInput {
  readonly query: Readonly<Record<string, PluginApiScalar>>;
  readonly body: Readonly<Record<string, PluginApiScalar>>;
}
export interface PluginApiRoute {
  /** One segment only, e.g. "courses"; host owns all URL prefixes. */
  readonly id: string;
  readonly audience: PluginApiAudience;
  readonly method: PluginApiMethod;
  /** Mandatory for admin; only a host-supported Staff permission is admitted. */
  readonly permission?: "plugins.read" | "plugins.manage" | "posts.read" | "posts.edit" | undefined;
  readonly query?: PluginApiShape | undefined;
  readonly body?: PluginApiShape | undefined;
  /** Strict declared JSON response projection (no arbitrary object serialization). */
  readonly response: PluginApiShape;
  readonly handle: (input: PluginApiInput, scope: PluginApiScope) =>
    Record<string, PluginApiScalar> | Promise<Record<string, PluginApiScalar>>;
}

/**
 * EXT-301A: Host-rendered, read-only Studio view descriptors.
 * Plugins cannot inject React, HTML, scripts, hrefs or change Admin routing.
 * The view's GET route remains independently Host-authorized on every request.
 */
export type PluginAdminPermission = "plugins.read" | "plugins.manage" | "posts.read" | "posts.edit";
export interface PluginAdminLocalizedLabel {
  readonly en: string;
  readonly ar: string;
}
export interface PluginAdminView {
  /** Stable single URL segment under the Host-owned Admin route. */
  readonly id: string;
  /** Must resolve to a declared Admin GET route in this same module. */
  readonly routeId: string;
  readonly title: PluginAdminLocalizedLabel;
}
export interface PluginAdminNavigationItem {
  readonly viewId: string;
  readonly label: PluginAdminLocalizedLabel;
  /** Must match the linked route permission; the Host checks both. */
  readonly permission: PluginAdminPermission;
}

/**
 * EXT-302A: opt-in Host-rendered, public-only SSR contribution.
 * The linked GET route must have no caller-defined query/body. No HTML, URL,
 * React component or private/member principal is sent to the public Web app.
 */
export interface PluginPublicView {
  /** One stable reserved /extensions/:pluginId/:viewId URL segment. */
  readonly id: string;
  /** Must resolve to this module's public GET route. */
  readonly routeId: string;
  readonly title: PluginAdminLocalizedLabel;
  /** Operator-trusted, explicitly published locale variants; absent means no hreflang. */
  readonly publishedLocales?: readonly string[] | undefined;
}

export interface PluginModule {
  activate(context: PluginContext): void | Promise<void>;
  /** Additive optional contribution: existing SDK v1 modules are unchanged. */
  readonly routes?: readonly PluginApiRoute[] | undefined;
  /** Optional metadata only; never executable UI contributions. */
  readonly adminViews?: readonly PluginAdminView[] | undefined;
  readonly adminNavigation?: readonly PluginAdminNavigationItem[] | undefined;
  /** Explicitly declared public SSR views; legacy modules remain unchanged. */
  readonly publicViews?: readonly PluginPublicView[] | undefined;
  deactivate?(): void | Promise<void>;
  /** Third parameter is additive; bundled v1 handlers may ignore it. */
  onEvent?(eventName: string, payload: unknown, context?: PluginContext): void | Promise<void>;
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
  "extension.storage.read": {
    id: "extension.storage.read",
    name: "Read Extension Storage",
    description: "Read host-scoped, plugin-owned relational models within an enabled publication",
    scope: "publication", requiredRole: "member",
    publicationBehavior: "isolated", risk: "medium", auditRequired: true,
  },
  "extension.storage.write": {
    id: "extension.storage.write",
    name: "Write Extension Storage",
    description: "Write validated plugin-owned relational models within an authorized publication",
    scope: "publication", requiredRole: "editor",
    publicationBehavior: "isolated", risk: "high", auditRequired: true,
  },
  "extension.member_storage.read": {
    id: "extension.member_storage.read",
    name: "Read Own Extension Member Records",
    description: "Read only records belonging to the authenticated Member in the current publication",
    scope: "publication", requiredRole: "member",
    publicationBehavior: "isolated", risk: "medium", auditRequired: false,
  },
  "extension.member_storage.write": {
    id: "extension.member_storage.write",
    name: "Write Own Extension Member Records",
    description: "Create or compare-and-update only current Member owned records under Host control",
    scope: "publication", requiredRole: "member",
    publicationBehavior: "isolated", risk: "high", auditRequired: true,
  },
  "extension.members.self.read": {
    id: "extension.members.self.read",
    name: "Read Signed-in Member Profile",
    description: "Read a minimal profile for the authenticated member in the active publication only",
    scope: "publication", requiredRole: "member",
    publicationBehavior: "isolated", risk: "medium", auditRequired: false,
  },
  "extension.entitlements.plan.read": {
    id: "extension.entitlements.plan.read",
    name: "Check Own Billing Plan",
    description: "Boolean-only check of the authenticated member's active billing plan, never LMS enrollment",
    scope: "publication", requiredRole: "member",
    publicationBehavior: "isolated", risk: "high", auditRequired: true,
  },
  "extension.routes.admin": {
    id: "extension.routes.admin",
    name: "Admin Extension API",
    description: "Host-authorized publication-scoped extension API for Staff",
    scope: "publication", requiredRole: "editor",
    publicationBehavior: "isolated", risk: "medium", auditRequired: true,
  },
  "extension.routes.member": {
    id: "extension.routes.member",
    name: "Member Extension API",
    description: "Host-authorized publication-scoped extension API for Members",
    scope: "publication", requiredRole: "member",
    publicationBehavior: "isolated", risk: "medium", auditRequired: true,
  },
  "extension.routes.public": {
    id: "extension.routes.public",
    name: "Public Extension API",
    description: "Host-scoped GET-only extension API with site privacy enforcement",
    scope: "publication", requiredRole: "public",
    publicationBehavior: "isolated", risk: "medium", auditRequired: true,
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
    m.entrypoint.length > 240 ||
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)*$/.test(m.entrypoint) ||
    m.entrypoint.split("/").some((part) => part === "." || part === "..") ||
    /^[a-zA-Z]:/.test(m.entrypoint)
  ) {
    throw new Error("Manifest entrypoint must be a safe relative path");
  }
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
  if (
    m.hooks !== undefined &&
    (!Array.isArray(m.hooks) ||
      m.hooks.some((hook: unknown) => typeof hook !== "string" || !hook.trim()))
  ) {
    throw new Error("Manifest hooks must be an array of non-empty names");
  }

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
 * Asynchronous timeout only. It cannot interrupt blocking JS or isolate crashes.
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
