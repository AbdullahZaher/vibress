const API_BASE = '/api/admin/v1';

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  status?: string;
  roles: string[];
  permissions: string[];
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number,
    public path?: string[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const hasBody = options.body != null;
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorDetail = data.errors?.[0] || {};
    const err = new ApiError(
      errorDetail.code || 'UNKNOWN_ERROR',
      errorDetail.message || 'An unexpected error occurred',
      response.status,
      errorDetail.path
    );
    (err as unknown as Record<string, unknown>).referenceCount = errorDetail.referenceCount;
    throw err;
  }

  return data as T;
}

export interface ApiMediaAsset {
  id: string;
  storageProvider: string;
  storageKey: string;
  originalFilename: string;
  displayName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  checksum: string;
  assetType: 'image' | 'video' | 'audio' | 'file';
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
  uploadedBy?: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiMediaReferenceSummary {
  mediaId: string;
  totalReferences: number;
  references: Array<{
    resourceType: string;
    resourceId: string;
    fieldPath: string;
  }>;
}

export async function uploadMediaApi(file: File): Promise<{ media: ApiMediaAsset }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/media`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorDetail = data.errors?.[0] || {};
    throw new ApiError(
      errorDetail.code || 'UPLOAD_FAILED',
      errorDetail.message || 'Media upload failed',
      response.status
    );
  }

  return data as { media: ApiMediaAsset };
}

export async function listMediaApi(params: Record<string, unknown> = {}): Promise<{ items: ApiMediaAsset[]; total: number }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      query.set(k, String(v));
    }
  });
  const queryString = query.toString() ? `?${query.toString()}` : '';
  return apiRequest<{ items: ApiMediaAsset[]; total: number }>(`/media${queryString}`);
}

export async function getMediaApi(id: string): Promise<{ media: ApiMediaAsset }> {
  return apiRequest<{ media: ApiMediaAsset }>(`/media/${id}`);
}

export async function updateMediaApi(id: string, updates: { displayName?: string }): Promise<{ media: ApiMediaAsset }> {
  return apiRequest<{ media: ApiMediaAsset }>(`/media/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteMediaApi(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/media/${id}`, {
    method: 'DELETE',
  });
}

export async function getMediaReferencesApi(id: string): Promise<{ summary: ApiMediaReferenceSummary }> {
  return apiRequest<{ summary: ApiMediaReferenceSummary }>(`/media/${id}/references`);
}

export interface ApiStorageConfiguration {
  id: string;
  name: string;
  providerType: string;
  endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  publicBaseUrl?: string | null;
  forcePathStyle: boolean;
  isActive: boolean;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

export type S3ProviderTypeDto =
  | 'aws-s3'
  | 'cloudflare-r2'
  | 'digitalocean-spaces'
  | 'wasabi'
  | 'backblaze-b2'
  | 'hetzner'
  | 'minio'
  | 'custom';

export interface CreateStorageConfigurationInput {
  name: string;
  providerType: S3ProviderTypeDto;
  endpoint?: string | undefined;
  region?: string | undefined;
  bucket: string;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  forcePathStyle?: boolean | undefined;
  publicBaseUrl?: string | undefined;
}

export async function listStorageConfigurationsApi(): Promise<{ configurations: ApiStorageConfiguration[] }> {
  return apiRequest<{ configurations: ApiStorageConfiguration[] }>('/storage/configurations');
}

export async function createStorageConfigurationApi(data: CreateStorageConfigurationInput): Promise<{ configuration: ApiStorageConfiguration }> {
  return apiRequest<{ configuration: ApiStorageConfiguration }>('/storage/configurations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateStorageConfigurationApi(id: string, data: Partial<CreateStorageConfigurationInput>): Promise<{ configuration: ApiStorageConfiguration }> {
  return apiRequest<{ configuration: ApiStorageConfiguration }>(`/storage/configurations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function testStorageConnectionApi(data: Partial<CreateStorageConfigurationInput> | { id: string }): Promise<{ result: { connected: boolean; bucket: string; providerType: string } }> {
  return apiRequest<{ result: { connected: boolean; bucket: string; providerType: string } }>('/storage/test', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function activateStorageConfigurationApi(id: string): Promise<{ activeConfiguration: ApiStorageConfiguration }> {
  return apiRequest<{ activeConfiguration: ApiStorageConfiguration }>(`/storage/configurations/${id}/activate`, {
    method: 'POST',
  });
}

export async function deleteStorageConfigurationApi(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/storage/configurations/${id}`, {
    method: 'DELETE',
  });
}

export interface ApiThemeManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  themeApi: number;
  capabilities: string[];
  settingsSchemaVersion: number;
}

export interface ApiThemeSummary {
  manifest: ApiThemeManifest;
  settingsSchema: Record<string, ApiThemeSettingDefinition>;
  isActive: boolean;
}

export interface ApiThemeSettingDefinition {
  type: 'string' | 'boolean' | 'number' | 'color' | 'select';
  default?: unknown;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: string[];
}

export interface ApiActiveTheme {
  themeId: string;
  themeVersion: string;
  settings: Record<string, unknown>;
  settingsSchemaVersion: number;
}

export async function listThemesApi(): Promise<{ themes: ApiThemeSummary[] }> {
  return apiRequest('/themes');
}

export async function getActiveThemeApi(): Promise<{ themeId: string; themeVersion: string; settings: Record<string, unknown>; settingsSchemaVersion: number }> {
  return apiRequest('/themes/active');
}

export async function activateThemeApi(id: string): Promise<{ theme: ApiActiveTheme }> {
  return apiRequest(`/themes/${id}/activate`, { method: 'POST' });
}

export async function updateThemeSettingsApi(id: string, settings: Record<string, unknown>): Promise<{ theme: ApiActiveTheme }> {
  return apiRequest(`/themes/${id}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

export async function createThemePreviewApi(id: string): Promise<{ previewToken: string; expiresAt: string; themeId: string }> {
  return apiRequest(`/themes/${id}/preview`, { method: 'POST' });
}

export interface AdminMemberSummary {
  id: string;
  email: string;
  name: string | null;
  status: 'active' | 'disabled';
  emailVerified: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface AdminMemberDetail extends AdminMemberSummary {
  emailNormalized: string;
  disabledAt: string | null;
  updatedAt: string;
  activeSessionCount?: number;
}

export async function listMembersApi(params: { search?: string; status?: string; limit?: number; offset?: number } = {}): Promise<{ members: AdminMemberSummary[]; total: number }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return apiRequest(`/members?${query.toString()}`);
}

export async function getMemberApi(id: string): Promise<{ member: AdminMemberDetail }> {
  return apiRequest(`/members/${id}`);
}

export async function disableMemberApi(id: string): Promise<{ member: { id: string; status: string } }> {
  return apiRequest(`/members/${id}/disable`, { method: 'POST' });
}

export async function enableMemberApi(id: string): Promise<{ member: { id: string; status: string } }> {
  return apiRequest(`/members/${id}/enable`, { method: 'POST' });
}

export async function revokeMemberSessionsApi(id: string): Promise<{ revokedCount: number }> {
  return apiRequest(`/members/${id}/revoke-sessions`, { method: 'POST' });
}

// ---------------- Billing ----------------

export interface AdminProduct {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface AdminPlan {
  id: string;
  productId: string;
  key: string;
  name: string;
  description: string | null;
  billingType: string;
  billingInterval: string | null;
  intervalCount: number;
  currency: string;
  amountMinor: number;
  trialDays: number;
  status: string;
  visibility: string;
  archivedAt: string | null;
}

export interface AdminOffer {
  id: string;
  productId: string;
  planId: string | null;
  key: string;
  name: string;
  description: string | null;
  discountType: string;
  discountValue: number;
  durationType: string;
  durationCycles: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  status: string;
}

export interface AdminSubscription {
  id: string;
  memberId: string;
  productId: string;
  planId: string;
  status: string;
  currency: string;
  amountMinor: number;
  billingInterval: string;
  intervalCount: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export async function listProductsApi(includeArchived = false): Promise<{ products: AdminProduct[] }> {
  return apiRequest(`/products?includeArchived=${includeArchived}`);
}

export async function createProductApi(data: { key: string; name: string; description?: string | null }): Promise<{ product: AdminProduct }> {
  return apiRequest('/products', { method: 'POST', body: JSON.stringify(data) });
}

export async function archiveProductApi(id: string): Promise<{ product: AdminProduct }> {
  return apiRequest(`/products/${id}/archive`, { method: 'POST' });
}

export async function listPlansApi(productId: string): Promise<{ plans: AdminPlan[] }> {
  return apiRequest(`/plans?productId=${encodeURIComponent(productId)}`);
}

export async function createPlanApi(data: {
  productId: string;
  key: string;
  name: string;
  billingType: 'free' | 'recurring';
  billingInterval?: 'month' | 'year' | null;
  currency?: string;
  amountMinor?: number;
  trialDays?: number;
}): Promise<{ plan: AdminPlan }> {
  return apiRequest('/plans', { method: 'POST', body: JSON.stringify(data) });
}

export async function archivePlanApi(id: string): Promise<{ plan: AdminPlan }> {
  return apiRequest(`/plans/${id}/archive`, { method: 'POST' });
}

export async function listOffersApi(): Promise<{ offers: AdminOffer[] }> {
  return apiRequest('/offers');
}

export async function createOfferApi(data: {
  productId: string;
  planId?: string | null;
  key: string;
  name: string;
  discountType: 'percentage' | 'fixed_amount';
  discountValue: number;
  durationType?: string;
  maxRedemptions?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
}): Promise<{ offer: AdminOffer }> {
  return apiRequest('/offers', { method: 'POST', body: JSON.stringify(data) });
}

export async function disableOfferApi(id: string): Promise<{ offer: AdminOffer }> {
  return apiRequest(`/offers/${id}/disable`, { method: 'POST' });
}

export async function listSubscriptionsApi(params: { status?: string; productId?: string; memberId?: string; limit?: number; offset?: number } = {}): Promise<{ subscriptions: AdminSubscription[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.productId) query.set('productId', params.productId);
  if (params.memberId) query.set('memberId', params.memberId);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return apiRequest(`/subscriptions?${query.toString()}`);
}

export async function getSubscriptionApi(id: string): Promise<{ subscription: AdminSubscription; events: unknown[] }> {
  return apiRequest(`/subscriptions/${id}`);
}

export async function cancelSubscriptionApi(id: string): Promise<{ subscription: AdminSubscription }> {
  return apiRequest(`/subscriptions/${id}/cancel`, { method: 'POST' });
}

export async function listMemberSubscriptionsApi(memberId: string): Promise<{ subscriptions: AdminSubscription[]; total: number }> {
  return apiRequest(`/members/${memberId}/subscriptions`);
}

// ---------------- Newsletters & Email ----------------

export interface AdminNewsletter {
  id: string;
  key: string;
  name: string;
  description: string | null;
  senderName: string;
  senderEmail: string;
  replyTo: string | null;
  status: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface AdminNewsletterSend {
  id: string;
  newsletterId: string;
  subject: string;
  status: string;
  audience: { filter: string; productId: string | null; planId: string | null };
  totalRecipients: number;
  sentRecipients: number;
  failedRecipients: number;
  scheduledAt: string | null;
  createdAt: string;
}

export interface AdminSuppression {
  id: string;
  memberId: string | null;
  email: string;
  reason: string;
  source: string;
  detail: string | null;
  createdAt: string;
}

export async function listNewslettersApi(includeArchived = false): Promise<{ newsletters: AdminNewsletter[] }> {
  return apiRequest(`/newsletters?includeArchived=${includeArchived}`);
}

export async function createNewsletterApi(data: {
  key: string;
  name: string;
  description?: string | null;
  senderName: string;
  senderEmail: string;
}): Promise<{ newsletter: AdminNewsletter }> {
  return apiRequest('/newsletters', { method: 'POST', body: JSON.stringify(data) });
}

export async function archiveNewsletterApi(id: string): Promise<{ newsletter: AdminNewsletter }> {
  return apiRequest(`/newsletters/${id}/archive`, { method: 'POST' });
}

export async function listNewsletterSendsApi(params: { status?: string; newsletterId?: string; limit?: number; offset?: number } = {}): Promise<{ sends: AdminNewsletterSend[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.newsletterId) query.set('newsletterId', params.newsletterId);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return apiRequest(`/newsletter-sends?${query.toString()}`);
}

export async function getNewsletterSendApi(id: string): Promise<{ send: AdminNewsletterSend; counts: Record<string, number> }> {
  return apiRequest(`/newsletter-sends/${id}`);
}

export async function createNewsletterSendApi(data: {
  newsletterId: string;
  subject: string;
  content: unknown;
  audience: { filter: string; productId?: string | null };
  scheduledAt?: string | null;
  sendNow?: boolean;
}): Promise<{ send: AdminNewsletterSend; audienceCount: number }> {
  return apiRequest('/newsletter-sends', { method: 'POST', body: JSON.stringify(data) });
}

export async function sendNewsletterNowApi(id: string): Promise<{ recipientCount: number; batchCount: number }> {
  return apiRequest(`/newsletter-sends/${id}/send-now`, { method: 'POST' });
}

export async function cancelNewsletterSendApi(id: string): Promise<{ send: AdminNewsletterSend }> {
  return apiRequest(`/newsletter-sends/${id}/cancel`, { method: 'POST' });
}

export async function sendTestEmailApi(data: {
  newsletterId: string;
  subject: string;
  content: unknown;
  recipients: string[];
}): Promise<{ results: Array<{ email: string; messageId: string | null; error: string | null }>; sent: number; failed: number }> {
  return apiRequest('/newsletter-test-email', { method: 'POST', body: JSON.stringify(data) });
}

export async function newsletterAudienceSummaryApi(data: { newsletterId: string; audience: { filter: string } }): Promise<{ count: number }> {
  return apiRequest('/newsletter-audience-summary', { method: 'POST', body: JSON.stringify(data) });
}

export async function listSuppressionsApi(limit = 50, offset = 0): Promise<{ suppressions: AdminSuppression[]; total: number }> {
  return apiRequest(`/email-suppressions?limit=${limit}&offset=${offset}`);
}

export async function removeSuppressionApi(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/email-suppressions/${id}`, { method: 'DELETE' });
}

// ---------------- Comments Moderation ----------------

export interface AdminComment {
  id: string;
  postId: string;
  memberId: string;
  parentId: string | null;
  body: string;
  status: string;
  likeCount: number;
  replyCount: number;
  createdAt: string;
}

export interface AdminCommentReport {
  id: string;
  commentId: string;
  reporterId: string;
  reason: string;
  status: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export async function listCommentsApi(params: { status?: string; postId?: string; limit?: number; offset?: number } = {}): Promise<{ comments: AdminComment[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.postId) query.set('postId', params.postId);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return apiRequest(`/comments?${query.toString()}`);
}

export async function hideCommentApi(id: string): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/hide`, { method: 'POST' });
}

export async function restoreCommentApi(id: string): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/restore`, { method: 'POST' });
}

export async function adminDeleteCommentApi(id: string): Promise<{ comment: { id: string; status: string } }> {
  return apiRequest(`/comments/${id}/delete`, { method: 'POST' });
}

export async function listCommentReportsApi(params: { status?: string; limit?: number; offset?: number } = {}): Promise<{ reports: AdminCommentReport[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return apiRequest(`/comment-reports?${query.toString()}`);
}

export async function resolveCommentReportApi(id: string, action: string): Promise<{ success: boolean }> {
  return apiRequest(`/comment-reports/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action }) });
}

// ---------------- Recommendations ----------------

export interface AdminRecommendation {
  id: string;
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
}

export async function listRecommendationsApi(includeArchived = false): Promise<{ recommendations: AdminRecommendation[] }> {
  return apiRequest(`/recommendations?includeArchived=${includeArchived}`);
}

export async function createRecommendationApi(data: { url: string; title: string; description?: string | null }): Promise<{ recommendation: AdminRecommendation }> {
  return apiRequest('/recommendations', { method: 'POST', body: JSON.stringify(data) });
}

export async function archiveRecommendationApi(id: string): Promise<{ recommendation: AdminRecommendation }> {
  return apiRequest(`/recommendations/${id}/archive`, { method: 'POST' });
}

// ---------------- Platform: Integrations, API Keys, Webhooks, Plugins ----------------

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
}

export async function listIntegrationsApi(): Promise<{ integrations: AdminIntegration[] }> {
  return apiRequest('/integrations');
}

export async function createIntegrationApi(data: { key: string; type: string; name: string; config?: Record<string, unknown>; secrets?: Record<string, string> }): Promise<{ integration: AdminIntegration }> {
  return apiRequest('/integrations', { method: 'POST', body: JSON.stringify(data) });
}

export async function listApiKeysApi(): Promise<{ keys: AdminApiKey[] }> {
  return apiRequest('/api-keys');
}

export async function createApiKeyApi(data: { name: string; scopes: string[]; expiresAt?: string | null }): Promise<{ key: { id: string; name: string; prefix: string; secret: string; scopes: string[]; expiresAt: string | null } }> {
  return apiRequest('/api-keys', { method: 'POST', body: JSON.stringify(data) });
}

export async function revokeApiKeyApi(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/api-keys/${id}/revoke`, { method: 'POST' });
}

export async function listWebhookEndpointsApi(): Promise<{ endpoints: AdminWebhookEndpoint[] }> {
  return apiRequest('/webhook-endpoints');
}

export async function createWebhookEndpointApi(data: { name: string; url: string; secret?: string | null; eventTypes: string[] }): Promise<{ endpoint: AdminWebhookEndpoint }> {
  return apiRequest('/webhook-endpoints', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteWebhookEndpointApi(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/webhook-endpoints/${id}`, { method: 'DELETE' });
}

export async function listWebhookDeliveriesApi(endpointId?: string): Promise<{ deliveries: AdminWebhookDelivery[]; total: number }> {
  const query = endpointId ? `?endpointId=${encodeURIComponent(endpointId)}` : '';
  return apiRequest(`/webhook-deliveries${query}`);
}

export async function listPluginsApi(): Promise<{ plugins: AdminPlugin[] }> {
  return apiRequest('/plugins');
}

export async function registerPluginApi(manifest: unknown): Promise<{ plugin: AdminPlugin }> {
  return apiRequest('/plugins/register', { method: 'POST', body: JSON.stringify({ manifest }) });
}

export async function activatePluginApi(id: string): Promise<{ plugin: AdminPlugin }> {
  return apiRequest(`/plugins/${id}/activate`, { method: 'POST' });
}

export async function deactivatePluginApi(id: string): Promise<{ plugin: AdminPlugin }> {
  return apiRequest(`/plugins/${id}/deactivate`, { method: 'POST' });
}

export async function setPluginSettingsApi(id: string, settings: Record<string, unknown>): Promise<{ success: boolean }> {
  return apiRequest(`/plugins/${id}/settings`, { method: 'POST', body: JSON.stringify({ settings }) });
}

export async function listPluginSettingsApi(id: string): Promise<{ settings: Array<{ key: string; value: string | null; isSecret: boolean; masked: boolean }> }> {
  return apiRequest(`/plugins/${id}/settings`);
}

// ---------------- Analytics / Search / Automations ----------------

export interface AdminMetric {
  date: string;
  name: string;
  count: number;
}

export interface AdminAutomation {
  id: string;
  key: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  conditions: Array<{ field: string; op: string; value?: unknown }>;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  status: string;
  version: number;
}

export interface AdminAutomationRun {
  id: string;
  automationId: string;
  version: number;
  triggerEvent: string;
  status: string;
  depth: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export async function getAnalyticsMetricsApi(params: { from?: string; to?: string; metricName?: string } = {}): Promise<{ metrics: AdminMetric[]; from: string; to: string; timezone: string }> {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.metricName) query.set('metricName', params.metricName);
  return apiRequest(`/analytics/metrics?${query.toString()}`);
}

export async function rebuildSearchIndexApi(): Promise<{ accepted: boolean }> {
  return apiRequest('/search/rebuild', { method: 'POST' });
}

export async function getSearchIndexCountApi(): Promise<{ count: number }> {
  return apiRequest('/search/index-count');
}

export async function listAutomationsApi(): Promise<{ automations: AdminAutomation[] }> {
  return apiRequest('/automations');
}

export async function createAutomationApi(data: { key: string; name: string; triggerEvent: string; conditions?: unknown[]; actions: unknown[] }): Promise<{ automation: AdminAutomation }> {
  return apiRequest('/automations', { method: 'POST', body: JSON.stringify(data) });
}

export async function activateAutomationApi(id: string): Promise<{ automation: AdminAutomation }> {
  return apiRequest(`/automations/${id}/activate`, { method: 'POST' });
}

export async function deactivateAutomationApi(id: string): Promise<{ automation: AdminAutomation }> {
  return apiRequest(`/automations/${id}/deactivate`, { method: 'POST' });
}

export async function runAutomationApi(id: string): Promise<{ run: AdminAutomationRun }> {
  return apiRequest(`/automations/${id}/run`, { method: 'POST' });
}

export async function listAutomationRunsApi(params: { automationId?: string; status?: string; limit?: number } = {}): Promise<{ runs: AdminAutomationRun[]; total: number }> {
  const query = new URLSearchParams();
  if (params.automationId) query.set('automationId', params.automationId);
  if (params.status) query.set('status', params.status);
  if (params.limit) query.set('limit', String(params.limit));
  return apiRequest(`/automation-runs?${query.toString()}`);
}

// ---------------- Operations: Settings / Audit / Redirects / Import-Export / System ----------------

export interface AdminSettingValue {
  key: string;
  value: unknown;
  classification: string;
}

export interface AdminAuditEvent {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminRedirect {
  id: string;
  source: string;
  destination: string;
  statusCode: number;
  enabled: boolean;
  sortOrder: number;
}

export interface AdminImportExportJob {
  id: string;
  type: string;
  status: string;
  requestedBy: string | null;
  progress: number;
  errorSummary: string | null;
  artifactKey: string | null;
  createdAt: string;
}

export interface AdminIntegrityCheck {
  check: string;
  status: string;
  detail?: string;
}

export async function getStaffSettingsApi(): Promise<{ namespaces: Array<{ namespace: string; settings: AdminSettingValue[] }> }> {
  return apiRequest('/settings');
}

export async function updateSettingApi(namespace: string, key: string, value: unknown): Promise<{ setting: AdminSettingValue }> {
  return apiRequest(`/settings/${namespace}/${key}`, { method: 'PUT', body: JSON.stringify({ value }) });
}

export async function listAuditApi(params: { action?: string; targetType?: string; limit?: number } = {}): Promise<{ events: AdminAuditEvent[]; total: number }> {
  const query = new URLSearchParams();
  if (params.action) query.set('action', params.action);
  if (params.targetType) query.set('targetType', params.targetType);
  if (params.limit) query.set('limit', String(params.limit));
  return apiRequest(`/audit?${query.toString()}`);
}

export async function listRedirectsApi(): Promise<{ redirects: AdminRedirect[] }> {
  return apiRequest('/redirects');
}

export async function createRedirectApi(data: { source: string; destination: string; statusCode?: number; enabled?: boolean }): Promise<{ redirect: AdminRedirect }> {
  return apiRequest('/redirects', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteRedirectApi(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/redirects/${id}`, { method: 'DELETE' });
}

export async function createImportApi(envelope: unknown): Promise<{ job: AdminImportExportJob }> {
  return apiRequest('/imports', { method: 'POST', body: JSON.stringify(envelope) });
}

export async function validateImportApi(envelope: unknown): Promise<{ valid: boolean }> {
  return apiRequest('/imports/validate', { method: 'POST', body: JSON.stringify(envelope) });
}

export async function createExportApi(): Promise<{ job: AdminImportExportJob }> {
  return apiRequest('/exports', { method: 'POST' });
}

export async function listJobsApi(): Promise<{ jobs: AdminImportExportJob[]; total: number }> {
  return apiRequest('/import-export-jobs?limit=20');
}

export async function getDiagnosticsApi(): Promise<{ diagnostics: Record<string, unknown> }> {
  return apiRequest('/system/diagnostics');
}

export async function runMaintenanceApi(operation: string): Promise<{ operation: string; accepted: boolean }> {
  return apiRequest('/system/maintenance', { method: 'POST', body: JSON.stringify({ operation }) });
}

export async function getIntegrityApi(): Promise<{ checks: AdminIntegrityCheck[] }> {
  return apiRequest('/system/integrity');
}
