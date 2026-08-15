import {
  AssetType,
  MediaAsset,
  MediaReference,
  MediaReferenceSummary,
} from "./asset";

export interface ListMediaFilter {
  limit?: number | undefined;
  offset?: number | undefined;
  assetType?: AssetType | undefined;
  mimeType?: string | undefined;
  uploadedBy?: string | undefined;
  search?: string | undefined;
  sortBy?: "createdAt" | "updatedAt" | "displayName" | "sizeBytes" | undefined;
  sortOrder?: "asc" | "desc" | undefined;
}

export interface MediaRepository {
  findById(id: string): Promise<MediaAsset | null>;
  findByStorageKey(storageKey: string): Promise<MediaAsset | null>;
  create(
    asset: Omit<MediaAsset, "createdAt" | "updatedAt">,
  ): Promise<MediaAsset>;
  update(
    id: string,
    data: {
      displayName?: string;
      metadata?: Record<string, unknown>;
      deletedAt?: Date | null;
    },
  ): Promise<MediaAsset>;
  delete(id: string): Promise<void>;
  list(
    filter?: ListMediaFilter,
  ): Promise<{ items: MediaAsset[]; total: number }>;

  // Reference tracking
  countReferences(mediaId: string): Promise<number>;
  getReferences(mediaId: string): Promise<MediaReferenceSummary>;
  addReference(
    ref: Omit<MediaReference, "id" | "createdAt">,
  ): Promise<MediaReference>;
  removeReferences(
    mediaId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<void>;
  replaceResourceReferences(
    resourceType: string,
    resourceId: string,
    mediaIdsWithPaths: Array<{ mediaId: string; fieldPath?: string }>,
  ): Promise<void>;
}
