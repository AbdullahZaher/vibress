export interface StorageConfiguration {
  id: string;
  name: string;
  providerType: string;
  endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  publicBaseUrl?: string | null;
  forcePathStyle: boolean;
  encryptedCredentials?: string | null;
  encryptionVersion: number;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStorageConfigurationData {
  id?: string | undefined;
  name: string;
  providerType: string;
  endpoint?: string | null | undefined;
  region?: string | null | undefined;
  bucket?: string | null | undefined;
  publicBaseUrl?: string | null | undefined;
  forcePathStyle?: boolean | undefined;
  credentials?: Record<string, string> | undefined;
  signedUrlTtlSeconds?: number | undefined;
  createdBy?: string | undefined;
}

export interface UpdateStorageConfigurationData {
  name?: string | undefined;
  providerType?: string | undefined;
  endpoint?: string | null | undefined;
  region?: string | null | undefined;
  bucket?: string | null | undefined;
  publicBaseUrl?: string | null | undefined;
  forcePathStyle?: boolean | undefined;
  credentials?: Record<string, string> | undefined;
  signedUrlTtlSeconds?: number | undefined;
}

export interface UploadSession {
  id: string;
  actorId: string;
  storageConfigurationId?: string | null;
  storageKey: string;
  originalFilename: string;
  declaredMime: string;
  expectedSize: number;
  assetType: "image" | "video" | "audio" | "file";
  state: "pending" | "uploaded" | "verified" | "failed";
  expiresAt: Date;
  multipartUploadId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
