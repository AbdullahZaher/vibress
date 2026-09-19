import { describe, it, expect, vi } from "vitest";
import {
  CommentsService,
  CommentDomainError,
  sanitizeCommentBody,
  validateCommentTransition,
} from "../src/application/comments-service";
import {
  CommentRepository,
  CommentLikeRepository,
  CommentReportRepository,
  CommentModerationEventRepository,
} from "../src/domain/repository";
import { Comment, CommentStatus } from "../src/domain/comment";
import {
  MAX_COMMENT_BODY_LENGTH,
  MAX_COMMENT_DEPTH,
} from "../src/domain/comment";

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    publicationId: "pub-1",
    postId: "post-1",
    memberId: "member-1",
    parentId: null,
    body: "Hello",
    status: "published",
    likeCount: 0,
    replyCount: 0,
    depth: 0,
    clientCommentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("validateCommentTransition", () => {
  it("allows legal transitions", () => {
    expect(() =>
      validateCommentTransition("pending_review", "published"),
    ).not.toThrow();
    expect(() =>
      validateCommentTransition("pending_review", "rejected"),
    ).not.toThrow();
    expect(() =>
      validateCommentTransition("published", "hidden"),
    ).not.toThrow();
    expect(() =>
      validateCommentTransition("hidden", "published"),
    ).not.toThrow();
    expect(() =>
      validateCommentTransition("published", "deleted"),
    ).not.toThrow();
  });

  it("rejects illegal transitions", () => {
    expect(() =>
      validateCommentTransition("deleted", "published"),
    ).toThrowError(CommentDomainError);
    expect(() =>
      validateCommentTransition("rejected", "published"),
    ).toThrowError(CommentDomainError);
  });
});

describe("sanitizeCommentBody", () => {
  it("strips HTML tags", () => {
    expect(sanitizeCommentBody('<script>alert("xss")</script>')).toBe(
      'alert("xss")',
    );
    expect(sanitizeCommentBody("<b>bold</b>")).toBe("bold");
  });

  it("strips control characters", () => {
    expect(sanitizeCommentBody("hello\x00world")).toBe("helloworld");
    expect(sanitizeCommentBody("hello\x1fworld")).toBe("helloworld");
  });

  it("truncates to max length", () => {
    const long = "a".repeat(MAX_COMMENT_BODY_LENGTH + 100);
    expect(sanitizeCommentBody(long).length).toBe(MAX_COMMENT_BODY_LENGTH);
  });
});

describe("CommentsService", () => {
  const commentRepo: CommentRepository = {
    create: vi.fn(async (d) => makeComment({ ...d, body: d.body })),
    findById: vi.fn(async () => null),
    findByClientId: vi.fn(async () => null),
    update: vi.fn(async (_pub, id, d) => makeComment({ id, body: d.body })),
    updateStatus: vi.fn(async (_pub, id, status) => makeComment({ id, status })),
    incrementLikeCount: vi.fn(async () => undefined),
    incrementReplyCount: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ comments: [], total: 0 })),
    listThreaded: vi.fn(async () => ({ comments: [], total: 0 })),
    countForPost: vi.fn(async () => 0),
    countForPosts: vi.fn(async () => new Map()),
    hardErase: vi.fn(async () => undefined),
  };
  const likeRepo: CommentLikeRepository = {
    toggle: vi.fn(async () => ({ liked: true })),
    exists: vi.fn(async () => false),
    getLikedCommentIdsForMember: vi.fn(async () => new Set()),
  };
  const reportRepo: CommentReportRepository = {
    create: vi.fn(async (_pub, _cid, _rid, _reason) => ({
      id: "r1",
      status: "pending",
    })),
    exists: vi.fn(async () => false),
    list: vi.fn(async () => ({ reports: [], total: 0 })),
    resolve: vi.fn(async () => undefined),
  };
  const moderationEventRepo: CommentModerationEventRepository = {
    create: vi.fn(async (e) => ({
      id: "event-1",
      createdAt: new Date(),
      ...e,
    })),
    listForComment: vi.fn(async () => []),
  };
  const notificationSink = { notify: vi.fn(async () => undefined) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeService(overrides: Record<string, unknown> = {}) {
    return new CommentsService({
      commentRepo,
      likeRepo,
      reportRepo,
      moderationEventRepo,
      notificationSink,
      ...overrides,
    } as any);
  }

  it("creates a top-level comment with sanitized body", async () => {
    const service = makeService();
    const comment = await service.createComment({
      publicationId: "pub-1",
      postId: "post-1",
      memberId: "m1",
      body: "<b>Hello</b> world",
    });
    expect(comment.body).toBe("Hello world");
  });

  it("returns existing comment idempotently when clientCommentId matches", async () => {
    const existing = makeComment({ id: "c-existing", clientCommentId: "client-uuid-1" });
    const repoWith: CommentRepository = {
      ...commentRepo,
      findByClientId: vi.fn(async () => existing),
    };
    const service = makeService({ commentRepo: repoWith });
    const result = await service.createComment({
      publicationId: "pub-1",
      postId: "post-1",
      memberId: "m1",
      body: "Hello",
      clientCommentId: "client-uuid-1",
    });
    expect(result.id).toBe("c-existing");
    expect(commentRepo.create).not.toHaveBeenCalled();
  });

  it("rejects an empty comment", async () => {
    const service = makeService();
    await expect(
      service.createComment({
        publicationId: "pub-1",
        postId: "post-1",
        memberId: "m1",
        body: "   ",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates a reply with correct depth and increments parent reply count", async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () =>
        makeComment({ id: "parent-1", publicationId: "pub-1", postId: "post-1", depth: 2 }),
      ),
    };
    const service = makeService({ commentRepo: repoWith });
    const reply = await service.createComment({
      publicationId: "pub-1",
      postId: "post-1",
      memberId: "m2",
      parentId: "parent-1",
      body: "Reply",
    });
    expect(reply.depth).toBe(3);
    expect(repoWith.incrementReplyCount).toHaveBeenCalledWith("pub-1", "parent-1", 1);
  });

  it("rejects a reply to a comment in a different post", async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () =>
        makeComment({ id: "parent-1", publicationId: "pub-1", postId: "other-post" }),
      ),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(
      service.createComment({
        publicationId: "pub-1",
        postId: "post-1",
        memberId: "m2",
        parentId: "parent-1",
        body: "Reply",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a reply exceeding max thread depth", async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () =>
        makeComment({
          id: "parent-1",
          publicationId: "pub-1",
          postId: "post-1",
          depth: MAX_COMMENT_DEPTH,
        }),
      ),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(
      service.createComment({
        publicationId: "pub-1",
        postId: "post-1",
        memberId: "m2",
        parentId: "parent-1",
        body: "Reply",
      }),
    ).rejects.toMatchObject({ code: "MAX_THREAD_DEPTH" });
  });

  it("rejects reply to a deleted comment", async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () =>
        makeComment({ id: "parent-1", publicationId: "pub-1", postId: "post-1", status: "deleted" }),
      ),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(
      service.createComment({
        publicationId: "pub-1",
        postId: "post-1",
        memberId: "m2",
        parentId: "parent-1",
        body: "Reply",
      }),
    ).rejects.toMatchObject({ code: "COMMENT_NOT_AVAILABLE" });
  });

  it("sends reply notification to parent author (not self-reply)", async () => {
    const sink = { notify: vi.fn(async () => undefined) };
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () =>
        makeComment({
          id: "parent-1",
          publicationId: "pub-1",
          postId: "post-1",
          memberId: "parent-author",
          depth: 0,
        }),
      ),
    };
    const service = makeService({
      commentRepo: repoWith,
      notificationSink: sink,
    });
    await service.createComment({
      publicationId: "pub-1",
      postId: "post-1",
      memberId: "replier",
      parentId: "parent-1",
      body: "Reply",
    });
    expect(sink.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "parent-author",
        type: "comment.reply",
      }),
    );
  });

  it("does not send notification for self-reply", async () => {
    const sink = { notify: vi.fn(async () => undefined) };
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () =>
        makeComment({
          id: "parent-1",
          publicationId: "pub-1",
          postId: "post-1",
          memberId: "same-author",
          depth: 0,
        }),
      ),
    };
    const service = makeService({
      commentRepo: repoWith,
      notificationSink: sink,
    });
    await service.createComment({
      publicationId: "pub-1",
      postId: "post-1",
      memberId: "same-author",
      parentId: "parent-1",
      body: "Self reply",
    });
    expect(sink.notify).not.toHaveBeenCalled();
  });

  it("IDOR: member cannot edit another member comment", async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () =>
        makeComment({ id: "c1", publicationId: "pub-1", memberId: "member-A" }),
      ),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(
      service.updateComment("pub-1", "c1", "member-B", "hacked"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("IDOR: member cannot delete another member comment", async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () =>
        makeComment({ id: "c1", publicationId: "pub-1", memberId: "member-A" }),
      ),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(
      service.deleteComment("pub-1", "c1", "member-B"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("delete uses tombstone semantics (body cleared, status deleted)", async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: "c1", publicationId: "pub-1", memberId: "m1" })),
      update: vi.fn(async (_pub, id, d) => makeComment({ id, body: d.body })),
      updateStatus: vi.fn(async (_pub, id, status) =>
        makeComment({ id, status, body: "[deleted]" }),
      ),
    };
    const service = makeService({ commentRepo: repoWith });
    const result = await service.deleteComment("pub-1", "c1", "m1");
    expect(result.status).toBe("deleted");
    expect(result.body).toBe("[deleted]");
  });

  it("toggle like increments/decrements like count", async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: "c1", publicationId: "pub-1" })),
    };
    const service = makeService({ commentRepo: repoWith });
    const result = await service.toggleLike("pub-1", "c1", "m1");
    expect(result.liked).toBe(true);
    expect(repoWith.incrementLikeCount).toHaveBeenCalledWith("pub-1", "c1", 1);
  });

  it("report spam: one report per member per comment", async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: "c1", publicationId: "pub-1" })),
    };
    const reportRepoWith: CommentReportRepository = {
      ...reportRepo,
      exists: vi.fn(async () => true),
    };
    const service = makeService({
      commentRepo: repoWith,
      reportRepo: reportRepoWith,
    });
    await expect(
      service.reportComment("pub-1", "c1", "m1", "spam"),
    ).rejects.toMatchObject({ code: "ALREADY_REPORTED" });
  });

  it("moderation: hide sets status hidden, records audit event, and notifies author", async () => {
    const sink = { notify: vi.fn(async () => undefined) };
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () =>
        makeComment({ id: "c1", publicationId: "pub-1", memberId: "author-1" }),
      ),
      updateStatus: vi.fn(async (_pub, id, status) =>
        makeComment({ id, publicationId: "pub-1", status }),
      ),
    };
    const eventRepoMock: CommentModerationEventRepository = {
      create: vi.fn(async (e) => ({ id: "ev-1", createdAt: new Date(), ...e })),
      listForComment: vi.fn(async () => []),
    };
    const service = makeService({
      commentRepo: repoWith,
      moderationEventRepo: eventRepoMock,
      notificationSink: sink,
    });
    const result = await service.hideComment("pub-1", "c1", "admin-user");
    expect(result.status).toBe("hidden");
    expect(eventRepoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        publicationId: "pub-1",
        commentId: "c1",
        actorId: "admin-user",
        action: "hide",
        fromStatus: "published",
        toStatus: "hidden",
      }),
    );
    expect(sink.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "author-1",
        type: "comment.hidden",
      }),
    );
  });
});

