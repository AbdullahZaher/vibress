import {
  AssetType,
  MediaAsset,
  MediaReference,
  MediaReferenceSummary,
} from "./asset";

export interface ListMediaFilter {
  publicationId?: string | undefined;
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
  findById(id: string, publicationId?: string): Promise<MediaAsset | null>;
  findByStorageKey(storageKey: string, publicationId?: string): Promise<MediaAsset | null>;
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
    publicationId?: string,
  ): Promise<MediaAsset>;
  delete(id: string, publicationId?: string): Promise<void>;
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
