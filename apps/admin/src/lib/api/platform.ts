import { apiRequest } from "./client";
import {
  ExtensionNativeAdminResponseV1Schema, type ExtensionNativeAdminPageV1,
  ExtensionNativeDataDiscoveryV1Schema, ExtensionNativeDataPageV1Schema,
  ExtensionNativeActionResultV1Schema,
} from "@vibress/api-contracts";

export interface AdminIntegration {
  id: string;
  key: string;
  type: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  createdAt: string;
}

export interface AdminApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  integrationId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface AdminWebhookEndpoint {
  id: string;
  name: string;
  url: string;
  hasSecret: boolean;
  enabled: boolean;
  eventTypes: string[];
  createdAt: string;
}

export interface AdminWebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  responseStatus: number | null;
  createdAt: string;
}

export interface AdminPlugin {
  id: string;
  manifestId: string;
  name: string;
  version: string;
  vibressApiVersion: string;
  description: string | null;
  capabilities: string[];
  status: string;
  settingsSchema?: Record<string, unknown>;
  /** Added for vNext external plugins; undefined on older API servers. */
  publicationScoped?: boolean;
  /** Host ABI comparison only, not proof of artifact approval or isolation. */
  hostCompatible?: boolean;
  /** Effective: true only when both globally active and site-configured. */
  publicationEnabled?: boolean;
  /** Persisted preference; can remain true while the plugin is globally inactive. */
  publicationConfiguredEnabled?: boolean;
}

export async function listIntegrationsApi(): Promise<{
  integrations: AdminIntegration[];
}> {
  return apiRequest("/integrations");
}

export async function createIntegrationApi(data: {
  key: string;
  type: string;
  name: string;
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
}): Promise<{ integration: AdminIntegration }> {
  return apiRequest("/integrations", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listApiKeysApi(): Promise<{ keys: AdminApiKey[] }> {
  return apiRequest("/api-keys");
}

export async function createApiKeyApi(data: {
  name: string;
  scopes: string[];
  expiresAt?: string | null;
}): Promise<{
  key: {
    id: string;
    name: string;
    prefix: string;
    secret: string;
    scopes: string[];
    expiresAt: string | null;
  };
}> {
  return apiRequest("/api-keys", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function revokeApiKeyApi(
  id: string,
): Promise<{ success: boolean }> {
  return apiRequest(`/api-keys/${id}/revoke`, { method: "POST" });
}

export async function listWebhookEndpointsApi(): Promise<{
  endpoints: AdminWebhookEndpoint[];
}> {
  return apiRequest("/webhook-endpoints");
}

export async function createWebhookEndpointApi(data: {
  name: string;
  url: string;
  secret?: string | null;
  eventTypes: string[];
}): Promise<{ endpoint: AdminWebhookEndpoint }> {
  return apiRequest("/webhook-endpoints", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteWebhookEndpointApi(
  id: string,
): Promise<{ success: boolean }> {
  return apiRequest(`/webhook-endpoints/${id}`, { method: "DELETE" });
}

export async function listWebhookDeliveriesApi(
  endpointId?: string,
): Promise<{ deliveries: AdminWebhookDelivery[]; total: number }> {
  const query = endpointId
    ? `?endpointId=${encodeURIComponent(endpointId)}`
    : "";
  return apiRequest(`/webhook-deliveries${query}`);
}

/** Host-authorized, localized, read-only Studio view; never an external URL. */
export interface AdminExtensionViewLink {
  pluginId: string;
  viewId: string;
  routeId: string;
  label: { en: string; ar: string };
  title: { en: string; ar: string };
  permission: "plugins.read" | "plugins.manage" | "posts.read" | "posts.edit";
  /** Inert group metadata; absent for legacy plugins and API versions. */
  group?: { id: string; label: { en: string; ar: string };
    icon?: "puzzle" | "graduation-cap" | "book-open" };
  /** Capability negotiated from Host; absent on old API means legacy. */
  nativeProbeSupported?: true;
}

/** Strictly Host-owned native metadata. A declaration alone is not authorization. */
export async function readNativeExtensionAdminPageApi(link: AdminExtensionViewLink): Promise<
  | { mode: "legacy" }
  | { mode: "native"; page: ExtensionNativeAdminPageV1; routeId: string;
      workflow?: import("@vibress/api-contracts").ExtensionNativeDomainWorkflowV1 }
> {
  const response: unknown = await apiRequest(
    `/extensions/${encodeURIComponent(link.pluginId)}/views/${encodeURIComponent(link.viewId)}/native`,
    { cache: "no-store" },
  );
  const parsed = ExtensionNativeAdminResponseV1Schema.safeParse(response);
  if (!parsed.success || (parsed.data.mode === "native" &&
      (parsed.data.page.viewId !== link.viewId || parsed.data.routeId !== link.routeId ||
        (parsed.data.workflow !== undefined &&
          (parsed.data.workflow.viewId !== link.viewId || parsed.data.workflow.routeId !== link.routeId))))) {
    throw new Error("Invalid native plugin view response");
  }
  return parsed.data;
}

/**
 * NUI-03 Host API helpers. Plugin metadata never supplies arbitrary URLs.
 * Discovery grants no permission; every resource/action is reauthorized.
 */
export async function readNativeExtensionDataRegistryApi(pluginId: string) {
  const response: unknown = await apiRequest(
    `/extensions/${encodeURIComponent(pluginId)}/data`, { cache: "no-store" });
  return ExtensionNativeDataDiscoveryV1Schema.parse(response);
}

export async function readNativeExtensionResourceApi(
  pluginId: string, resourceId: string,
  query: { limit?: number; cursor?: string; filterField?: string; filterValue?: string } = {},
) {
  const qs = new URLSearchParams();
  if (query.limit !== undefined) qs.set("limit", String(query.limit));
  if (query.cursor !== undefined) qs.set("cursor", query.cursor);
  if (query.filterField !== undefined) qs.set("filterField", query.filterField);
  if (query.filterValue !== undefined) qs.set("filterValue", query.filterValue);
  const response: unknown = await apiRequest(
    `/extensions/${encodeURIComponent(pluginId)}/resources/${encodeURIComponent(resourceId)}` +
      (qs.size ? `?${qs.toString()}` : ""),
    { cache: "no-store" },
  );
  return ExtensionNativeDataPageV1Schema.parse(response);
}

export async function executeNativeExtensionActionApi(
  pluginId: string, actionId: string,
  payload: { id: string; expectedVersion?: number;
    fields: Readonly<Record<string, string | number | boolean | null>> },
) {
  const response: unknown = await apiRequest(
    `/extensions/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(actionId)}`,
    { method: "POST", body: JSON.stringify(payload), cache: "no-store" },
  );
  return ExtensionNativeActionResultV1Schema.parse(response);
}

export async function listExtensionAdminViewsApi(): Promise<{ items: AdminExtensionViewLink[] }> {
  return apiRequest("/extensions/navigation", { cache: "no-store" });
}

/**
 * B2B: Authorize an optional isolated UI for a Host-admitted plugin view.
 * Never accepts arbitrary URLs from the plugin or exposes Staff credentials.
 */
export async function issueExtensionAdminFrameTicketApi(
  link: AdminExtensionViewLink,
): Promise<{ src: string; bridgeNonce: string; sha256: string }> {
  return apiRequest(`/extensions/${encodeURIComponent(link.pluginId)}/views/${encodeURIComponent(link.viewId)}/frame-ticket`, {
    method: "POST",
    cache: "no-store",
  });
}

/** Revalidate Staff membership, plugin admission and artifact every 30 seconds. */
export async function readExtensionAdminFrameStatusApi(
  link: AdminExtensionViewLink,
): Promise<{ sha256: string }> {
  return apiRequest(`/extensions/${encodeURIComponent(link.pluginId)}/views/${encodeURIComponent(link.viewId)}/frame-status`, {
    cache: "no-store",
  });
}

export async function readExtensionAdminViewApi(
  link: AdminExtensionViewLink,
  query?: Readonly<Record<string, string | number | boolean>>,
): Promise<Record<string, string | number | boolean>> {
  // Host chooses the only authorized route; the server validates any scalar
  // query against the plugin's declared runtime contract.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) params.set(key, String(value));
  const qs = params.size ? `?${params.toString()}` : "";
  return apiRequest(`/extensions/${encodeURIComponent(link.pluginId)}/v1/${encodeURIComponent(link.routeId)}${qs}`, {
    cache: "no-store",
  });
}

/** POST is bound to the exact Host-admitted linked route. No URL, header,
 * publication, method or principal can be supplied by an extension frame. */
export async function writeExtensionAdminViewApi(
  link: AdminExtensionViewLink,
  body: Readonly<Record<string, string | number | boolean>>,
): Promise<Record<string, string | number | boolean>> {
  return apiRequest(
    `/extensions/${encodeURIComponent(link.pluginId)}/v1/${encodeURIComponent(link.routeId)}`,
    { method: "POST", body: JSON.stringify(body), cache: "no-store" },
  );
}

export async function listPluginsApi(): Promise<{
  plugins: AdminPlugin[];
  platformOperator?: boolean;
}> {
  return apiRequest("/plugins");
}

export async function registerPluginApi(
  manifest: unknown,
): Promise<{ plugin: AdminPlugin }> {
  return apiRequest("/plugins/register", {
    method: "POST",
    body: JSON.stringify({ manifest }),
  });
}

export async function activatePluginApi(
  id: string,
): Promise<{ plugin: AdminPlugin }> {
  return apiRequest(`/plugins/${id}/activate`, { method: "POST" });
}

export async function deactivatePluginApi(
  id: string,
): Promise<{ plugin: AdminPlugin }> {
  return apiRequest(`/plugins/${id}/deactivate`, { method: "POST" });
}

export async function setPluginSettingsApi(
  id: string,
  settings: Record<string, unknown>,
): Promise<{ success: boolean }> {
  return apiRequest(`/plugins/${id}/settings`, {
    method: "POST",
    body: JSON.stringify({ settings }),
  });
}

export async function listPluginSettingsApi(
  id: string,
): Promise<{
  settings: Array<{
    key: string;
    value: string | null;
    isSecret: boolean;
    masked: boolean;
  }>;
}> {
  return apiRequest(`/plugins/${id}/settings`);
}

export interface AdminPluginPublicationState {
  pluginId: string;
  publicationId: string;
  enabled: boolean;
}

export async function getPluginPublicationStateApi(
  id: string,
): Promise<AdminPluginPublicationState> {
  return apiRequest(`/plugins/${encodeURIComponent(id)}/publication-state`);
}

export async function setPluginPublicationStateApi(
  id: string,
  enabled: boolean,
): Promise<AdminPluginPublicationState> {
  return apiRequest(`/plugins/${encodeURIComponent(id)}/publication-state`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export interface AdminScopedPluginSetting {
  key: string;
  value: string | null;
  isSecret: boolean;
  masked: boolean;
}

export async function listPluginPublicationSettingsApi(
  id: string,
): Promise<{ settings: AdminScopedPluginSetting[] }> {
  return apiRequest(`/plugins/${encodeURIComponent(id)}/publication-settings`);
}

export async function setPluginPublicationSettingsApi(
  id: string,
  settings: Record<string, string | null>,
): Promise<{ success: boolean }> {
  return apiRequest(`/plugins/${encodeURIComponent(id)}/publication-settings`, {
    method: "PATCH",
    body: JSON.stringify({ settings }),
  });
}

export interface AdminOperatorPlugin {
  id: string;
  name: string;
  version: string;
  description: string | null;
  /** Server-owned approved manifest capabilities, not plugin-authored UI labels. */
  capabilities?: string[];
  /** Optional for older API servers; true only after detached Ed25519 verification. */
  signatureVerified?: boolean | null;
  /** Immutable artifact-bound approval ID; no plugin-supplied executable data. */
  approvalId?: string;
  readiness?: "verification_required";
  upgradeReview?: {
    installedVersion: string;
    installedStatus: string;
    addedCapabilities: string[];
    removedCapabilities: string[];
    metadataChanged: boolean;
  };
  /** Optional read-only release v1 summary; older Host/API versions omit it. */
  release?: {
    releaseId: string;
    publisher: { id: string; name: string };
    artifactSha256: string;
    compatibility: {
      minVibressApiVersion: string;
      maxVibressApiVersion: string;
      sdkAbiVersion: string;
    };
    hasSbom: boolean;
    hasProvenance: boolean;
    migrationPlanIds: string[];
  };
}

export async function listOperatorTrustedPluginsApi(): Promise<{ plugins: AdminOperatorPlugin[] }> {
  return apiRequest("/plugins/trusted-available");
}

export async function registerOperatorTrustedPluginApi(
  manifestId: string,
  expectedReleaseId?: string,
  acknowledgeUpgrade = false,
): Promise<{ plugin: AdminPlugin }> {
  return apiRequest("/plugins/register-trusted", {
    method: "POST",
    body: JSON.stringify({
      manifestId,
      ...(expectedReleaseId ? { expectedReleaseId } : {}),
      ...(acknowledgeUpgrade ? { acknowledgeUpgrade: true } : {}),
    }),
  });
}

/** EXT-401 Host-authorized and publication-scoped failed plugin events. */
export interface AdminFailedPluginEvent {
  eventId: string;
  jobId: string;
  attemptsMade: number;
  status: "failed";
}
export async function listFailedPluginEventsApi(
  id: string, offset = 0,
): Promise<{ items: AdminFailedPluginEvent[]; nextOffset: number }> {
  const query = new URLSearchParams({ offset: String(offset), limit: "25" });
  return apiRequest(`/plugins/${encodeURIComponent(id)}/events/failed?${query}`, {
    cache: "no-store",
  });
}

export async function replayFailedPluginEventApi(
  id: string, eventId: string,
): Promise<Omit<AdminFailedPluginEvent, "status"> & { status: "requeued" }> {
  return apiRequest(
    `/plugins/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}/replay`,
    {
      method: "POST",
      body: JSON.stringify({ confirmAtLeastOnceRisk: true }),
    },
  );
}
