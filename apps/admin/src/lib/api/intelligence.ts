import { apiRequest } from './client';

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