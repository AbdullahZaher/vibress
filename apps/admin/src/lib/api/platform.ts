import { apiRequest } from "./client";

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
  publicationEnabled?: boolean;
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
): Promise<Record<string, string | number | boolean>> {
  // Neither path component nor API permission is supplied by plugin UI code.
  return apiRequest(`/extensions/${encodeURIComponent(link.pluginId)}/v1/${encodeURIComponent(link.routeId)}`, {
    cache: "no-store",
  });
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
}

export async function listOperatorTrustedPluginsApi(): Promise<{ plugins: AdminOperatorPlugin[] }> {
  return apiRequest("/plugins/trusted-available");
}

export async function registerOperatorTrustedPluginApi(
  manifestId: string,
): Promise<{ plugin: AdminPlugin }> {
  return apiRequest("/plugins/register-trusted", {
    method: "POST",
    body: JSON.stringify({ manifestId }),
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
