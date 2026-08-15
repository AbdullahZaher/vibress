import crypto from "node:crypto";
import { StorageRegistry } from "@vibress/storage-core";
import { AuditRepository } from "@vibress/audit";
import { MediaRepository, ListMediaFilter } from "../domain/repository";
import {
  MediaAsset,
  MediaLimitsConfig,
  MediaReferenceSummary,
  UploadMediaInput,
} from "../domain/asset";
import { validateAndDetectFile } from "../domain/file-validator";
import {
  MediaInUseError,
  MediaNotFoundError,
  MediaStorageError,
  MediaUploadFailedError,
} from "../domain/errors";

export class MediaService {
  constructor(
    private mediaRepo: MediaRepository,
    private storageRegistry: StorageRegistry,
    private auditRepo?: AuditRepository,
    private limitsConfig?: MediaLimitsConfig,
  ) {}

  resolveProviderForAsset(storageProviderName?: string | null) {
    if (
      storageProviderName &&
      this.storageRegistry.hasProvider(storageProviderName)
    ) {
      return this.storageRegistry.getProvider(storageProviderName);
    }
    return this.storageRegistry.getActiveProvider();
  }

  async getMediaUrl(asset: MediaAsset): Promise<string> {
    const provider = this.resolveProviderForAsset(asset.storageProvider);
    return provider.getUrl(asset.storageKey);
  }

  async uploadMedia(
    input: UploadMediaInput,
    actorId?: string,
  ): Promise<MediaAsset> {
    const validated = validateAndDetectFile(input, this.limitsConfig);

    const assetId = crypto.randomUUID();
    const storageProvider = this.storageRegistry.getActiveProvider();
    const storageKey = `media/${assetId}/${validated.originalFilename}`;

    let storedObject;
    try {
      storedObject = await storageProvider.put({
        key: storageKey,
        body: input.buffer,
        contentType: validated.mimeType,
      });
    } catch (error) {
      throw new MediaStorageError((error as Error).message);
    }

    let asset: MediaAsset;
    try {
      asset = await this.mediaRepo.create({
        id: assetId,
        storageProvider: storageProvider.name,
        storageKey: storedObject.key,
        originalFilename: validated.originalFilename,
        displayName: validated.displayName,
        mimeType: validated.mimeType,
        extension: validated.extension,
        sizeBytes: validated.sizeBytes,
        checksum: validated.checksum,
        assetType: validated.assetType,
        width: validated.width,
        height: validated.height,
        durationMs: null,
        metadata: null,
        uploadedBy: input.uploadedBy || actorId || null,
      });
    } catch (dbError) {
      // COMPENSATION: If DB insert fails, cleanup stored object in storage provider
      try {
        await storageProvider.delete(storageKey);
      } catch {
        // ignore cleanup error
      }
      throw new MediaUploadFailedError((dbError as Error).message);
    }

    if (this.auditRepo) {
      const uploader = actorId || input.uploadedBy || undefined;
      await this.auditRepo.record({
        actorUserId: uploader,
        action: "media.uploaded",
        targetType: "media",
        targetId: asset.id,
        metadata: {
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          assetType: asset.assetType,
          displayName: asset.displayName,
        },
      });
    }

    return asset;
  }

  async getMediaById(id: string): Promise<MediaAsset> {
    const asset = await this.mediaRepo.findById(id);
    if (!asset) {
      throw new MediaNotFoundError(id);
    }
    return asset;
  }

  async listMedia(
    filter?: ListMediaFilter,
  ): Promise<{ items: MediaAsset[]; total: number }> {
    return this.mediaRepo.list(filter);
  }

  async updateMediaMetadata(
    id: string,
    updates: {
      displayName?: string | undefined;
      metadata?: Record<string, unknown> | undefined;
    },
    actorId?: string,
  ): Promise<MediaAsset> {
    await this.getMediaById(id);

    const repoUpdate: {
      displayName?: string;
      metadata?: Record<string, unknown>;
    } = {};
    if (updates.displayName !== undefined)
      repoUpdate.displayName = updates.displayName;
    if (updates.metadata !== undefined) repoUpdate.metadata = updates.metadata;

    const updated = await this.mediaRepo.update(id, repoUpdate);

    if (this.auditRepo && actorId) {
      await this.auditRepo.record({
        actorUserId: actorId,
        action: "media.updated",
        targetType: "media",
        targetId: id,
        metadata: {
          displayName: updated.displayName,
        },
      });
    }

    return updated;
  }

  async updateFocalPoint(
    id: string,
    focalPoint: { x: number; y: number },
    actorId?: string,
  ): Promise<MediaAsset> {
    const asset = await this.getMediaById(id);
    const existingMeta = (asset.metadata as Record<string, unknown>) || {};
    const clampedFocalPoint = {
      x: Math.max(0, Math.min(1, focalPoint.x)),
      y: Math.max(0, Math.min(1, focalPoint.y)),
    };

    return this.updateMediaMetadata(
      id,
      {
        metadata: {
          ...existingMeta,
          focalPoint: clampedFocalPoint,
        },
      },
      actorId,
    );
  }

  async deleteMedia(id: string, actorId?: string): Promise<void> {
    const asset = await this.getMediaById(id);

    const refCount = await this.mediaRepo.countReferences(id);
    if (refCount > 0) {
      throw new MediaInUseError(id, refCount);
    }

    await this.mediaRepo.delete(id);

    // Invoke asset's owner storage provider to purge or soft-delete object if required
    const provider = this.resolveProviderForAsset(asset.storageProvider);

    if (this.auditRepo && actorId) {
      await this.auditRepo.record({
        actorUserId: actorId,
        action: "media.deleted",
        targetType: "media",
        targetId: id,
        metadata: {
          displayName: asset.displayName,
          mimeType: asset.mimeType,
          storageProvider: provider.name,
        },
      });
    }
  }

  async getMediaReferences(id: string): Promise<MediaReferenceSummary> {
    await this.getMediaById(id);
    return this.mediaRepo.getReferences(id);
  }

  async updateResourceMediaReferences(
    resourceType: string,
    resourceId: string,
    mediaIdsWithPaths: Array<{ mediaId: string; fieldPath?: string }>,
  ): Promise<void> {
    await this.mediaRepo.replaceResourceReferences(
      resourceType,
      resourceId,
      mediaIdsWithPaths,
    );
  }
}
