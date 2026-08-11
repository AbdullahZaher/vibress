import { ApiError, apiRequest, API_BASE } from './client';

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