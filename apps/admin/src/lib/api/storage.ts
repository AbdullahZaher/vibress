import { apiRequest } from './client';

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