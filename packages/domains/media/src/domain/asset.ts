export type AssetType = 'image' | 'video' | 'audio' | 'file';

export interface MediaAsset {
  id: string;
  storageProvider: string;
  storageKey: string;
  originalFilename: string;
  displayName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  checksum: string;
  assetType: AssetType;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
  uploadedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface MediaReference {
  id: string;
  mediaId: string;
  resourceType: 'post' | 'page' | string;
  resourceId: string;
  fieldPath: string;
  createdAt: Date;
}

export interface MediaReferenceSummary {
  mediaId: string;
  totalReferences: number;
  references: Array<{
    resourceType: string;
    resourceId: string;
    fieldPath: string;
  }>;
}

export interface UploadMediaInput {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  uploadedBy?: string | null;
  displayName?: string;
  assetType?: AssetType;
}

export interface MediaLimitsConfig {
  maxImageSize: number; // default 20MB
  maxAudioSize: number; // default 100MB
  maxVideoSize: number; // default 500MB
  maxFileSize: number;  // default 100MB
}

export const DEFAULT_MEDIA_LIMITS: MediaLimitsConfig = {
  maxImageSize: 20 * 1024 * 1024,
  maxAudioSize: 100 * 1024 * 1024,
  maxVideoSize: 500 * 1024 * 1024,
  maxFileSize: 100 * 1024 * 1024,
};
