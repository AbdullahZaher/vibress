import { describe, it, expect, vi } from 'vitest';
import { CommentsService, CommentDomainError, sanitizeCommentBody } from '../src/application/comments-service';
import { CommentRepository, CommentLikeRepository, CommentReportRepository } from '../src/domain/repository';
import { Comment, CommentStatus } from '../src/domain/comment';
import { MAX_COMMENT_BODY_LENGTH, MAX_COMMENT_DEPTH } from '../src/domain/comment';

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    postId: 'post-1',
    memberId: 'member-1',
    parentId: null,
    body: 'Hello',
    status: 'published',
    likeCount: 0,
    replyCount: 0,
    depth: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('sanitizeCommentBody', () => {
  it('strips HTML tags', () => {
    expect(sanitizeCommentBody('<script>alert("xss")</script>')).toBe('alert("xss")');
    expect(sanitizeCommentBody('<b>bold</b>')).toBe('bold');
  });

  it('strips control characters', () => {
    expect(sanitizeCommentBody('hello\x00world')).toBe('helloworld');
    expect(sanitizeCommentBody('hello\x1fworld')).toBe('helloworld');
  });

  it('truncates to max length', () => {
    const long = 'a'.repeat(MAX_COMMENT_BODY_LENGTH + 100);
    expect(sanitizeCommentBody(long).length).toBe(MAX_COMMENT_BODY_LENGTH);
  });
});

describe('CommentsService', () => {
  const commentRepo: CommentRepository = {
    create: vi.fn(async (d) => makeComment({ ...d, body: d.body })),
    findById: vi.fn(async () => null),
    update: vi.fn(async (id, d) => makeComment({ id, body: d.body })),
    updateStatus: vi.fn(async (id, status) => makeComment({ id, status })),
    incrementLikeCount: vi.fn(async () => undefined),
    incrementReplyCount: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ comments: [], total: 0 })),
    listThreaded: vi.fn(async () => ({ comments: [], total: 0 })),
    countForPost: vi.fn(async () => 0),
  };
  const likeRepo: CommentLikeRepository = {
    toggle: vi.fn(async () => ({ liked: true })),
    exists: vi.fn(async () => false),
  };
  const reportRepo: CommentReportRepository = {
    create: vi.fn(async (_cid, _rid, _reason) => ({ id: 'r1', status: 'pending' })),
    exists: vi.fn(async () => false),
    list: vi.fn(async () => ({ reports: [], total: 0 })),
    resolve: vi.fn(async () => undefined),
  };
  const notificationSink = { notify: vi.fn(async () => undefined) };

  function makeService(overrides: Record<string, unknown> = {}) {
    return new CommentsService({
      commentRepo,
      likeRepo,
      reportRepo,
      notificationSink,
      ...overrides,
    } as any);
  }

  it('creates a top-level comment with sanitized body', async () => {
    const service = makeService();
    const comment = await service.createComment({ postId: 'post-1', memberId: 'm1', body: '<b>Hello</b> world' });
    expect(comment.body).toBe('Hello world');
  });

  it('rejects an empty comment', async () => {
    const service = makeService();
    await expect(service.createComment({ postId: 'post-1', memberId: 'm1', body: '   ' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('creates a reply with correct depth and increments parent reply count', async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'parent-1', postId: 'post-1', depth: 2 })),
    };
    const service = makeService({ commentRepo: repoWith });
    const reply = await service.createComment({ postId: 'post-1', memberId: 'm2', parentId: 'parent-1', body: 'Reply' });
    expect(reply.depth).toBe(3);
    expect(repoWith.incrementReplyCount).toHaveBeenCalledWith('parent-1', 1);
  });

  it('rejects a reply to a comment in a different post', async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'parent-1', postId: 'other-post' })),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(service.createComment({ postId: 'post-1', memberId: 'm2', parentId: 'parent-1', body: 'Reply' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a reply exceeding max thread depth', async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'parent-1', postId: 'post-1', depth: MAX_COMMENT_DEPTH })),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(service.createComment({ postId: 'post-1', memberId: 'm2', parentId: 'parent-1', body: 'Reply' }))
      .rejects.toMatchObject({ code: 'MAX_THREAD_DEPTH' });
  });

  it('rejects reply to a deleted comment', async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'parent-1', postId: 'post-1', status: 'deleted' })),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(service.createComment({ postId: 'post-1', memberId: 'm2', parentId: 'parent-1', body: 'Reply' }))
      .rejects.toMatchObject({ code: 'COMMENT_NOT_AVAILABLE' });
  });

  it('sends reply notification to parent author (not self-reply)', async () => {
    const sink = { notify: vi.fn(async () => undefined) };
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'parent-1', postId: 'post-1', memberId: 'parent-author', depth: 0 })),
    };
    const service = makeService({ commentRepo: repoWith, notificationSink: sink });
    await service.createComment({ postId: 'post-1', memberId: 'replier', parentId: 'parent-1', body: 'Reply' });
    expect(sink.notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'parent-author', type: 'comment.reply' }));
  });

  it('does not send notification for self-reply', async () => {
    const sink = { notify: vi.fn(async () => undefined) };
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'parent-1', postId: 'post-1', memberId: 'same-author', depth: 0 })),
    };
    const service = makeService({ commentRepo: repoWith, notificationSink: sink });
    await service.createComment({ postId: 'post-1', memberId: 'same-author', parentId: 'parent-1', body: 'Self reply' });
    expect(sink.notify).not.toHaveBeenCalled();
  });

  it('IDOR: member cannot edit another member comment', async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'c1', memberId: 'member-A' })),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(service.updateComment('c1', 'member-B', 'hacked'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('IDOR: member cannot delete another member comment', async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'c1', memberId: 'member-A' })),
    };
    const service = makeService({ commentRepo: repoWith });
    await expect(service.deleteComment('c1', 'member-B'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('delete uses tombstone semantics (body cleared, status deleted)', async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'c1', memberId: 'm1' })),
      update: vi.fn(async (id, d) => makeComment({ id, body: d.body })),
      updateStatus: vi.fn(async (id, status) => makeComment({ id, status, body: '[deleted]' })),
    };
    const service = makeService({ commentRepo: repoWith });
    const result = await service.deleteComment('c1', 'm1');
    expect(result.status).toBe('deleted');
    expect(result.body).toBe('[deleted]');
  });

  it('toggle like increments/decrements like count', async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'c1' })),
    };
    const service = makeService({ commentRepo: repoWith });
    const result = await service.toggleLike('c1', 'm1');
    expect(result.liked).toBe(true);
    expect(repoWith.incrementLikeCount).toHaveBeenCalledWith('c1', 1);
  });

  it('report spam: one report per member per comment', async () => {
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'c1' })),
    };
    const reportRepoWith: CommentReportRepository = {
      ...reportRepo,
      exists: vi.fn(async () => true),
    };
    const service = makeService({ commentRepo: repoWith, reportRepo: reportRepoWith });
    await expect(service.reportComment('c1', 'm1', 'spam'))
      .rejects.toMatchObject({ code: 'ALREADY_REPORTED' });
  });

  it('moderation: hide sets status hidden and notifies author', async () => {
    const sink = { notify: vi.fn(async () => undefined) };
    const repoWith: CommentRepository = {
      ...commentRepo,
      findById: vi.fn(async () => makeComment({ id: 'c1', memberId: 'author-1' })),
    };
    const service = makeService({ commentRepo: repoWith, notificationSink: sink });
    const result = await service.hideComment('c1');
    expect(result.status).toBe('hidden');
    expect(sink.notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'author-1', type: 'comment.hidden' }));
  });
});
