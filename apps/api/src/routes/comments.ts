import { FastifyInstance } from 'fastify';
import { commentsService, settingsService, subscriptionsService } from '../services';
import { requireMemberSession, validateMemberOrigin } from '../middleware/member-auth';
import { CreateCommentSchema, UpdateCommentSchema, ReportCommentSchema } from '@vibress/api-contracts';
import { CommentDomainError, Comment } from '@vibress/comments';
import { getConfig } from '@vibress/config';

type CommentListQuery = { limit?: string; offset?: string };

function publicCommentDto(c: Comment) {
  return {
    id: c.id,
    postId: c.postId,
    memberId: c.memberId,
    parentId: c.parentId,
    body: c.status === 'deleted' ? null : c.body,
    status: c.status,
    likeCount: c.likeCount,
    replyCount: c.replyCount,
    depth: c.depth,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function publicCommentRoutes(fastify: FastifyInstance) {
  // Public: list published comments for a post
  fastify.get('/posts/:postId/comments', async (req, reply) => {
    const { postId } = req.params as { postId: string };
    const query = (req.query ?? {}) as CommentListQuery;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;
    const result = await commentsService.listPublicCommentsForPost(postId, limit, offset);
    return reply.status(200).send({
      comments: result.comments.map(publicCommentDto),
      total: result.total,
    });
  });

  // Public: comment count for a post
  fastify.get('/posts/:postId/comments/count', async (req, reply) => {
    const { postId } = req.params as { postId: string };
    const count = await commentsService.countCommentsForPost(postId);
    return reply.status(200).send({ count });
  });
}

export async function memberCommentRoutes(fastify: FastifyInstance) {
  // Member: create comment or reply
  fastify.post('/comments', {
    config: { rateLimit: { max: getConfig().isTest ? 100 : 20, timeWindow: '1 minute' } },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const parsed = CreateCommentSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ errors: [{ code: 'VALIDATION_ERROR', message: 'Invalid comment', requestId: req.id }] });

      const publicSettings = await settingsService.getPublicSettings();
      const commentAccess = (publicSettings.comments?.commentAccess as string) || 'all';
      if (commentAccess === 'disabled') {
        return reply.status(403).send({ errors: [{ code: 'COMMENTS_DISABLED', message: 'Comments are disabled for this publication', requestId: req.id }] });
      }
      if (commentAccess === 'paid') {
        const hasActivePaidSub = await subscriptionsService.memberHasActiveSubscription(req.member!.id);
        if (!hasActivePaidSub) {
          return reply.status(403).send({ errors: [{ code: 'PAID_MEMBERS_ONLY', message: 'Only paid subscribers can participate in comments', requestId: req.id }] });
        }
      }

      const preModeration = Boolean(publicSettings.comments?.preModeration);

      try {
        const comment = await commentsService.createComment({
          ...parsed.data,
          memberId: req.member!.id,
          status: preModeration ? 'pending_review' : 'published',
        });
        return reply.status(201).send({ comment: publicCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status = err.code === 'COMMENT_NOT_FOUND' ? 404 : 400;
          return reply.status(status).send({ errors: [{ code: err.code, message: err.message, requestId: req.id }] });
        }
        throw err;
      }
    },
  });

  // Member: edit own comment
  fastify.patch('/comments/:id', {
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = UpdateCommentSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ errors: [{ code: 'VALIDATION_ERROR', message: 'Invalid comment', requestId: req.id }] });
      try {
        const comment = await commentsService.updateComment(id, req.member!.id, parsed.data.body);
        return reply.status(200).send({ comment: publicCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status = err.code === 'COMMENT_NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
          return reply.status(status).send({ errors: [{ code: err.code, message: err.message, requestId: req.id }] });
        }
        throw err;
      }
    },
  });

  // Member: delete (tombstone) own comment
  fastify.delete('/comments/:id', {
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const comment = await commentsService.deleteComment(id, req.member!.id);
        return reply.status(200).send({ comment: publicCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status = err.code === 'COMMENT_NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
          return reply.status(status).send({ errors: [{ code: err.code, message: err.message, requestId: req.id }] });
        }
        throw err;
      }
    },
  });

  // Member: toggle like
  fastify.post('/comments/:id/like', {
    config: { rateLimit: { max: getConfig().isTest ? 200 : 50, timeWindow: '1 minute' } },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const result = await commentsService.toggleLike(id, req.member!.id);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          return reply.status(400).send({ errors: [{ code: err.code, message: err.message, requestId: req.id }] });
        }
        throw err;
      }
    },
  });

  // Member: report comment
  fastify.post('/comments/:id/report', {
    config: { rateLimit: { max: getConfig().isTest ? 50 : 10, timeWindow: '1 minute' } },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = ReportCommentSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ errors: [{ code: 'VALIDATION_ERROR', message: 'Invalid report', requestId: req.id }] });
      try {
        const report = await commentsService.reportComment(id, req.member!.id, parsed.data.reason);
        return reply.status(201).send(report);
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          return reply.status(400).send({ errors: [{ code: err.code, message: err.message, requestId: req.id }] });
        }
        throw err;
      }
    },
  });
}
