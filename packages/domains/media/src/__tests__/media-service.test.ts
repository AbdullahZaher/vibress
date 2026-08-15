import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MediaService,
  MediaInUseError,
  MediaUploadFailedError,
  extractMediaReferencesFromDocument,
  MediaRepository,
  MediaAsset,
} from "../index";
import { StorageProvider, StorageRegistry } from "@vibress/storage-core";

describe("MediaService Application Use Cases", () => {
  let mediaService: MediaService;
  let mockRepo: MediaRepository;
  let mockStorage: StorageProvider;
  let registry: StorageRegistry;

  const sampleAsset: MediaAsset = {
    id: "asset-123",
    storageProvider: "local",
    storageKey: "media/asset-123/sample.png",
    originalFilename: "sample.png",
    displayName: "Sample Image",
    mimeType: "image/png",
    extension: "png",
    sizeBytes: 100,
    checksum: "abc123sha256",
    assetType: "image",
    width: 10,
    height: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockRepo = {
      findById: vi.fn(),
      findByStorageKey: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      countReferences: vi.fn(),
      getReferences: vi.fn(),
      addReference: vi.fn(),
      removeReferences: vi.fn(),
      replaceResourceReferences: vi.fn(),
    };

    mockStorage = {
      name: "local",
      getCapabilities: () => ({
        signedUrls: false,
        directUpload: false,
        multipartUpload: false,
        privateObjects: false,
        publicObjects: true,
      }),
      put: vi.fn().mockResolvedValue({
        key: "media/asset-123/sample.png",
        url: "/content/media/media/asset-123/sample.png",
        size: 100,
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
      getUrl: vi
        .fn()
        .mockResolvedValue("/content/media/media/asset-123/sample.png"),
    };

    registry = new StorageRegistry();
    registry.register(mockStorage);
    registry.setActiveProvider("local");

    mediaService = new MediaService(mockRepo, registry);
  });

  it("should upload media asset successfully", async () => {
    vi.mocked(mockRepo.create).mockResolvedValue(sampleAsset);

    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    const result = await mediaService.uploadMedia({
      filename: "sample.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    expect(mockStorage.put).toHaveBeenCalled();
    expect(mockRepo.create).toHaveBeenCalled();
    expect(result.id).toBe("asset-123");
  });

  it("should compensate by deleting stored object if DB insert fails during upload", async () => {
    vi.mocked(mockRepo.create).mockRejectedValue(new Error("DB failure"));

    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    await expect(
      mediaService.uploadMedia({
        filename: "sample.png",
        mimeType: "image/png",
        buffer: pngBuffer,
      }),
    ).rejects.toThrow(MediaUploadFailedError);

    expect(mockStorage.delete).toHaveBeenCalled();
  });

  it("should reject deletion if media asset is referenced by content (MediaInUseError)", async () => {
    vi.mocked(mockRepo.findById).mockResolvedValue(sampleAsset);
    vi.mocked(mockRepo.countReferences).mockResolvedValue(2);

    await expect(mediaService.deleteMedia("asset-123")).rejects.toThrow(
      MediaInUseError,
    );
    expect(mockRepo.delete).not.toHaveBeenCalled();
  });

  it("should soft-delete media asset if reference count is 0", async () => {
    vi.mocked(mockRepo.findById).mockResolvedValue(sampleAsset);
    vi.mocked(mockRepo.countReferences).mockResolvedValue(0);

    await mediaService.deleteMedia("asset-123");
    expect(mockRepo.delete).toHaveBeenCalledWith("asset-123");
  });

  it("should extract media references correctly from Studio documents", () => {
    const doc = {
      schema: "vibress-studio",
      version: 1,
      root: {
        type: "root",
        children: [
          {
            type: "studio-card",
            cardType: "image",
            cardData: {
              assetId: "11111111-1111-1111-1111-111111111111",
              src: "/content/media/media/11111111-1111-1111-1111-111111111111/photo.png",
            },
          },
          {
            type: "studio-card",
            cardType: "gallery",
            cardData: {
              images: [
                {
                  assetId: "22222222-2222-2222-2222-222222222222",
                  src: "/content/media/media/22222222-2222-2222-2222-222222222222/gallery1.jpg",
                },
              ],
            },
          },
        ],
      },
    };

    const refs = extractMediaReferencesFromDocument(doc);
    expect(refs.length).toBe(2);
    expect(refs.map((r) => r.mediaId)).toContain(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(refs.map((r) => r.mediaId)).toContain(
      "22222222-2222-2222-2222-222222222222",
    );
  });

  it("should extract references from assetIds arrays (gallery card)", () => {
    const doc = {
      schema: "vibress-studio",
      version: 1,
      root: {
        type: "root",
        children: [
          {
            type: "studio-card",
            cardType: "gallery",
            cardData: {
              assetIds: [
                "33333333-3333-3333-3333-333333333333",
                "44444444-4444-4444-4444-444444444444",
              ],
            },
          },
        ],
      },
    };

    const refs = extractMediaReferencesFromDocument(doc);
    expect(refs.length).toBe(2);
    expect(refs.map((r) => r.mediaId)).toEqual([
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
    ]);
  });
});
