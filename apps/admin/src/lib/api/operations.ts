import { apiRequest } from './client';

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