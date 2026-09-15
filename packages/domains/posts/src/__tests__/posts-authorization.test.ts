import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostsService, PostActorContext } from "../application/posts-service";
import { Post, PostDomainError } from "../domain/post";

describe("SEC-02: Content Ownership & Resource Authorization", () => {
  let postsService: PostsService;
  let mockPostRepo: any;
  let mockRevisionService: any;
  let mockAuthorRepo: any;
  let mockAuditRepo: any;
  let mockMediaService: any;
  let mockEventWriter: any;

  const mockPost: Post = {
    id: "post-100",
    publicationId: "pub_default",
    title: "Author A's Article",
    slug: "author-a-article",
    excerpt: "Excerpt",
    content: { version: 1, root: {} },
    contentVersion: 1,
    status: "draft",
    visibility: "public",
    version: 1,
    primaryAuthorId: "author-a",
    createdBy: "author-a",
    updatedBy: "author-a",
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

  beforeEach(() => {
    vi.clearAllMocks();

    mockPostRepo = {
      findById: vi.fn().mockResolvedValue({ ...mockPost }),
      findBySlug: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((id, data) =>
        Promise.resolve({ ...mockPost, ...data, version: (mockPost.version || 1) + 1 }),
      ),
      delete: vi.fn().mockResolvedValue(undefined),
      setPostTagIds: vi.fn().mockResolvedValue(undefined),
      getPostTagIds: vi.fn().mockResolvedValue([]),
    };

    mockRevisionService = {
      createRevision: vi.fn().mockResolvedValue({ id: "rev-1" }),
      getRevisionById: vi.fn().mockResolvedValue({
        id: "rev-1",
        resourceType: "post",
        resourceId: "post-100",
        title: "Previous Title",
        slug: "author-a-article",
        excerpt: "Prev Excerpt",
        content: { version: 1, root: {} },
        contentVersion: 1,
        revisionNumber: 1,
      }),
    };

    mockAuthorRepo = {
      getPostAuthors: vi.fn().mockResolvedValue([
        { authorId: "author-a", isPrimary: true },
      ]),
      setPostAuthors: vi.fn().mockResolvedValue(undefined),
    };

    mockAuditRepo = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    mockMediaService = {
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

  it("permits the primary author to update their own post", async () => {
    const actor: PostActorContext = {
      userId: "author-a",
      roles: ["author"],
      permissions: ["posts.edit"],
    };

    const updated = await postsService.updatePost(
      "post-100",
      { title: "Updated by Author A" },
      actor,
    );

    expect(updated).toBeDefined();
    expect(mockPostRepo.update).toHaveBeenCalled();
  });

  it("REJECTS an author attempting to update another author's post (IDOR)", async () => {
    const actorB: PostActorContext = {
      userId: "author-b",
      roles: ["author"],
      permissions: ["posts.edit"],
    };

    await expect(
      postsService.updatePost(
        "post-100",
        { title: "Malicious Edit by Author B" },
        actorB,
      ),
    ).rejects.toThrowError(PostDomainError);

    await expect(
      postsService.updatePost(
        "post-100",
        { title: "Malicious Edit by Author B" },
        actorB,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mockPostRepo.update).not.toHaveBeenCalled();
  });

  it("REJECTS an author attempting to delete another author's post", async () => {
    const actorB: PostActorContext = {
      userId: "author-b",
      roles: ["author"],
      permissions: ["posts.delete"],
    };

    await expect(
      postsService.deletePost("post-100", actorB),
    ).rejects.toThrowError(PostDomainError);

    await expect(
      postsService.deletePost("post-100", actorB),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mockPostRepo.delete).not.toHaveBeenCalled();
  });

  it("permits an author to delete their own post", async () => {
    const actorA: PostActorContext = {
      userId: "author-a",
      roles: ["author"],
      permissions: ["posts.delete"],
      publicationId: "pub_default",
    };

    await postsService.deletePost("post-100", actorA);
    expect(mockPostRepo.delete).toHaveBeenCalledWith("post-100", "pub_default");
  });

  it("REJECTS an unauthorized author restoring revisions on another author's post", async () => {
    const actorB: PostActorContext = {
      userId: "author-b",
      roles: ["author"],
      permissions: ["posts.edit"],
    };

    await expect(
      postsService.restoreRevision("post-100", "rev-1", actorB),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("permits an Editor or Administrator to update and delete another author's post within same publication", async () => {
    const editor: PostActorContext = {
      userId: "editor-1",
      roles: ["editor"],
      permissions: ["posts.edit", "posts.delete"],
      publicationId: "pub_default",
    };

    const updated = await postsService.updatePost(
      "post-100",
      { title: "Editorial Update" },
      editor,
    );
    expect(updated).toBeDefined();

    await postsService.deletePost("post-100", editor);
    expect(mockPostRepo.delete).toHaveBeenCalledWith("post-100", "pub_default");
  });

  it("REJECTS an Administrator from another publication attempting to modify or delete a post (cross-tenant isolation)", async () => {
    const foreignAdmin: PostActorContext = {
      userId: "admin-foreign",
      roles: ["administrator"],
      permissions: ["posts.edit", "posts.delete"],
      publicationId: "pub_other",
    };

    // When repository enforces tenant isolation on findById, it returns null -> POST_NOT_FOUND (404)
    mockPostRepo.findById.mockImplementation(async (id: string, pubId?: string) => {
      if (pubId && pubId !== mockPost.publicationId) return null;
      return { ...mockPost };
    });

    await expect(
      postsService.updatePost("post-100", { title: "Cross Tenant Attack" }, foreignAdmin),
    ).rejects.toMatchObject({ code: "POST_NOT_FOUND" });

    await expect(
      postsService.deletePost("post-100", foreignAdmin),
    ).rejects.toMatchObject({ code: "POST_NOT_FOUND" });

    expect(mockPostRepo.delete).not.toHaveBeenCalled();
  });

  it("permits a co-author in post authors to update the post", async () => {
    mockAuthorRepo.getPostAuthors.mockResolvedValueOnce([
      { id: "author-a", isPrimary: true },
      { id: "co-author-c", isPrimary: false },
    ]);

    const coAuthor: PostActorContext = {
      userId: "co-author-c",
      roles: ["author"],
      permissions: ["posts.edit"],
    };

    const updated = await postsService.updatePost(
      "post-100",
      { title: "Co-authored Update" },
      coAuthor,
    );
    expect(updated).toBeDefined();
  });
});
