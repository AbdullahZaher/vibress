import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostsService, PostActorContext } from "../application/posts-service";
import { Post, PostDomainError } from "../domain/post";

describe("Post Feature Image - Publication Isolation & Media Reference Lifecycle", () => {
  let postsService: PostsService;
  let mockPostRepo: any;
  let mockRevisionService: any;
  let mockAuthorRepo: any;
  let mockAuditRepo: any;
  let mockMediaService: any;
  let mockEventWriter: any;

  const samplePost: Post = {
    id: "post-pub-a",
    publicationId: "pub-a",
    title: "Pub A Article",
    slug: "pub-a-article",
    excerpt: "Excerpt",
    content: {
      version: 1,
      root: {
        children: [
          {
            type: "image",
            assetId: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
          },
        ],
      },
    },
    contentVersion: 1,
    status: "draft",
    visibility: "public",
    version: 1,
    featureImageId: null,
    featureImageAlt: null,
    featureImageCaption: null,
    primaryAuthorId: "author-1",
    createdBy: "author-1",
    updatedBy: "author-1",
    publishedBy: null,
    publishedAt: null,
    scheduledAt: null,
    metaTitle: null,
    metaDescription: null,
    canonicalUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const actorContext: PostActorContext = {
    userId: "author-1",
    roles: ["editor"],
    permissions: ["posts.create", "posts.edit", "posts.delete"],
    publicationId: "pub-a",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPostRepo = {
      findById: vi.fn().mockImplementation((id: string, pubId?: string) => {
        if (id === samplePost.id && (!pubId || pubId === samplePost.publicationId)) {
          return Promise.resolve({ ...samplePost });
        }
        return Promise.resolve(null);
      }),
      findBySlug: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((data: any) =>
        Promise.resolve({
          ...samplePost,
          ...data,
          id: data.id || "new-post-id",
          version: 1,
        }),
      ),
      update: vi.fn().mockImplementation((id: string, data: any) =>
        Promise.resolve({
          ...samplePost,
          ...data,
          version: (samplePost.version || 1) + 1,
        }),
      ),
      updateFeatureImage: vi.fn().mockImplementation((id: string, data: any) =>
        Promise.resolve({
          ...samplePost,
          ...data,
          version: samplePost.version, // does NOT bump post.version
        }),
      ),
      delete: vi.fn().mockResolvedValue(undefined),
      setPostTagIds: vi.fn().mockResolvedValue(undefined),
      getPostTagIds: vi.fn().mockResolvedValue([]),
    };

    mockRevisionService = {
      createRevision: vi.fn().mockResolvedValue({ id: "rev-1" }),
    };

    mockAuthorRepo = {
      getPostAuthors: vi.fn().mockResolvedValue([
        { authorId: "author-1", isPrimary: true },
      ]),
      setPostAuthors: vi.fn().mockResolvedValue(undefined),
    };

    mockAuditRepo = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    mockMediaService = {
      getMediaById: vi.fn().mockImplementation((id: string, pubId?: string) => {
        if (id === "media-pub-a") {
          return Promise.resolve({
            id: "media-pub-a",
            publicationId: "pub-a",
            originalFilename: "image-a.jpg",
          });
        }
        if (id === "media-pub-b") {
          return Promise.resolve({
            id: "media-pub-b",
            publicationId: "pub-b",
            originalFilename: "image-b.jpg",
          });
        }
        throw new Error(`Media not found: ${id}`);
      }),
      updateResourceMediaReferences: vi.fn().mockResolvedValue(undefined),
    };

    mockEventWriter = {
      write: vi.fn().mockResolvedValue(undefined),
    };

    postsService = new PostsService(
      mockPostRepo,
      mockRevisionService,
      mockAuthorRepo,
      mockAuditRepo,
      mockMediaService,
      mockEventWriter,
    );
  });

  describe("Publication Isolation on Creation", () => {
    it("permits feature image belonging to the same publication (A post + A media)", async () => {
      const post = await postsService.createPost(
        {
          title: "New Post in Pub A",
          primaryAuthorId: "author-1",
          featureImageId: "media-pub-a",
        },
        actorContext,
      );

      expect(post).toBeDefined();
      expect(mockMediaService.getMediaById).toHaveBeenCalledWith("media-pub-a", "pub-a");
      expect(mockMediaService.updateResourceMediaReferences).toHaveBeenCalledWith(
        "post",
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ mediaId: "media-pub-a", fieldPath: "featureImage" }),
        ]),
      );
    });

    it("REJECTS feature image belonging to a different publication (A post + B media)", async () => {
      await expect(
        postsService.createPost(
          {
            title: "Cross Tenant Attack Post",
            primaryAuthorId: "author-1",
            featureImageId: "media-pub-b",
          },
          actorContext,
        ),
      ).rejects.toThrowError(PostDomainError);

      await expect(
        postsService.createPost(
          {
            title: "Cross Tenant Attack Post",
            primaryAuthorId: "author-1",
            featureImageId: "media-pub-b",
          },
          actorContext,
        ),
      ).rejects.toMatchObject({ code: "INVALID_FEATURE_IMAGE" });
    });

    it("REJECTS non-existent media as feature image", async () => {
      await expect(
        postsService.createPost(
          {
            title: "Missing Media Post",
            primaryAuthorId: "author-1",
            featureImageId: "media-nonexistent",
          },
          actorContext,
        ),
      ).rejects.toMatchObject({ code: "INVALID_FEATURE_IMAGE" });
    });
  });

  describe("Publication Isolation on Update & Patch", () => {
    it("permits updating feature image to an asset within same publication", async () => {
      const updated = await postsService.updatePost(
        "post-pub-a",
        {
          featureImageId: "media-pub-a",
          featureImageAlt: "Alt description",
        },
        actorContext,
      );

      expect(updated.featureImageId).toBe("media-pub-a");
      expect(mockMediaService.updateResourceMediaReferences).toHaveBeenCalledWith(
        "post",
        "post-pub-a",
        expect.arrayContaining([
          expect.objectContaining({ mediaId: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d" }),
          expect.objectContaining({ mediaId: "media-pub-a", fieldPath: "featureImage" }),
        ]),
      );
    });

    it("REJECTS updating feature image with media from another publication", async () => {
      await expect(
        postsService.updatePost(
          "post-pub-a",
          {
            featureImageId: "media-pub-b",
          },
          actorContext,
        ),
      ).rejects.toMatchObject({ code: "INVALID_FEATURE_IMAGE" });
    });

    it("permits patchFeatureImage within same publication without bumping content version", async () => {
      const updated = await postsService.patchFeatureImage(
        "post-pub-a",
        {
          featureImageId: "media-pub-a",
          featureImageAlt: "Custom Alt",
          featureImageCaption: "Photographer Attribution",
        },
        actorContext,
      );

      expect(updated.featureImageId).toBe("media-pub-a");
      expect(mockPostRepo.updateFeatureImage).toHaveBeenCalledWith(
        "post-pub-a",
        {
          featureImageId: "media-pub-a",
          featureImageAlt: "Custom Alt",
          featureImageCaption: "Photographer Attribution",
          updatedBy: "author-1",
        },
        "pub-a",
      );
      // Verify version is untouched
      expect(updated.version).toBe(1);
    });

    it("REJECTS patchFeatureImage with cross-publication media asset", async () => {
      await expect(
        postsService.patchFeatureImage(
          "post-pub-a",
          {
            featureImageId: "media-pub-b",
          },
          actorContext,
        ),
      ).rejects.toMatchObject({ code: "INVALID_FEATURE_IMAGE" });
    });
  });

  describe("Media Reference Lifecycle", () => {
    it("preserves body media references when feature image is removed", async () => {
      await postsService.patchFeatureImage(
        "post-pub-a",
        {
          featureImageId: null,
          featureImageAlt: null,
          featureImageCaption: null,
        },
        actorContext,
      );

      expect(mockMediaService.updateResourceMediaReferences).toHaveBeenCalledWith(
        "post",
        "post-pub-a",
        [
          expect.objectContaining({ mediaId: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d" }),
        ],
      );
    });

    it("cleans up post media references when post is deleted", async () => {
      await postsService.deletePost("post-pub-a", actorContext);

      expect(mockMediaService.updateResourceMediaReferences).toHaveBeenCalledWith(
        "post",
        "post-pub-a",
        [],
      );
    });
  });
});
