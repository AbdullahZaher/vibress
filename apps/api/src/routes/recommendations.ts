import { FastifyInstance, FastifyReply } from 'fastify';
import { recommendationsService, commentsService } from '../services';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';
import { CreateRecommendationSchema, UpdateRecommendationSchema } from '@vibress/api-contracts';
import { RecommendationDomainError } from '@vibress/recommendations';
import { CommentDomainError } from '@vibress/comments';

const sendError = (reply: FastifyReply, code: string, message: string, requestId: string, status = 400) =>
  reply.status(status).send({ errors: [{ code, message, requestId }] });

export async function publicRecommendationRoutes(fastify: FastifyInstance) {
  // Public: list active recommendations
  fastify.get('/recommendations', async (_req, reply) => {
    const recommendations = await recommendationsService.listActiveRecommendations();
    return reply.status(200).send({
      recommendations: recommendations.map((r) => ({
        id: r.id,
        url: r.url,
        title: r.title,
        description: r.description,
        imageUrl: r.imageUrl,
        faviconUrl: r.faviconUrl,
      })),
    });
  });

  // Public: record a click
  fastify.post('/recommendations/:id/click', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { sessionId?: string } | undefined;
    const sessionId = body?.sessionId || null;
    try {
      await recommendationsService.recordClick(id, null, sessionId);
      return reply.status(200).send({ success: true });
    } catch (err) {
      if (err instanceof RecommendationDomainError) {
        return reply.status(404).send({ errors: [{ code: err.code, message: err.message, requestId: req.id }] });
      }
      throw err;
    }
  });
}

export async function adminRecommendationRoutes(fastify: FastifyInstance) {
  fastify.get('/recommendations', {
    preHandler: [requireStaffSession, requirePermission('recommendations.read')],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as { includeArchived?: string };
      const includeArchived = String(query.includeArchived) === 'true';
      const recommendations = await recommendationsService.listRecommendations({ includeArchived });
      return reply.status(200).send({ recommendations });
    },
  });

  fastify.post('/recommendations', {
    preHandler: [requireStaffSession, requirePermission('recommendations.manage'), validateOrigin],
    handler: async (req, reply) => {
      const parsed = CreateRecommendationSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid recommendation', req.id);
      try {
        const recommendation = await recommendationsService.createRecommendation(parsed.data, req.user!.id);
        return reply.status(201).send({ recommendation });
      } catch (err) {
        if (err instanceof RecommendationDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.patch('/recommendations/:id', {
    preHandler: [requireStaffSession, requirePermission('recommendations.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = UpdateRecommendationSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid recommendation', req.id);
      try {
        const recommendation = await recommendationsService.updateRecommendation(id, parsed.data, req.user!.id);
        return reply.status(200).send({ recommendation });
      } catch (err) {
        if (err instanceof RecommendationDomainError) {
          return sendError(reply, err.code, err.message, req.id, err.code === 'RECOMMENDATION_NOT_FOUND' ? 404 : 400);
        }
        throw err;
      }
    },
  });

  fastify.post('/recommendations/:id/archive', {
    preHandler: [requireStaffSession, requirePermission('recommendations.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const recommendation = await recommendationsService.archiveRecommendation(id, req.user!.id);
        return reply.status(200).send({ recommendation });
      } catch (err) {
        if (err instanceof RecommendationDomainError) return sendError(reply, err.code, err.message, req.id, 404);
        throw err;
      }
    },
  });

  fastify.get('/recommendations/:id/stats', {
    preHandler: [requireStaffSession, requirePermission('recommendations.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const stats = await recommendationsService.getClickCount(id);
      return reply.status(200).send({ stats });
    },
  });
}

type AdminCommentListQuery = { status?: string; postId?: string; limit?: string; offset?: string };
type CommentReportListQuery = { status?: string; limit?: string; offset?: string };

export async function adminCommentModerationRoutes(fastify: FastifyInstance) {
  fastify.get('/comments', {
    preHandler: [requireStaffSession, requirePermission('comments.read')],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as AdminCommentListQuery;
      const params: { status?: string; postId?: string; limit: number; offset: number } = {
        limit: query.limit ? parseInt(query.limit, 10) : 50,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      };
      if (query.status) params.status = query.status;
      if (query.postId) params.postId = query.postId;
      const result = await commentsService.listCommentsForModeration(params);
      return reply.status(200).send({
        comments: result.comments.map((c) => ({
          id: c.id, postId: c.postId, memberId: c.memberId, parentId: c.parentId,
          body: c.body, status: c.status, likeCount: c.likeCount, replyCount: c.replyCount,
          createdAt: c.createdAt.toISOString(),
        })),
        total: result.total,
      });
    },
  });

  fastify.post('/comments/:id/hide', {
    preHandler: [requireStaffSession, requirePermission('comments.moderate'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const comment = await commentsService.hideComment(id);
        return reply.status(200).send({ comment: { id: comment.id, status: comment.status } });
      } catch (err) {
        if (err instanceof CommentDomainError) return sendError(reply, err.code, err.message, req.id, 404);
        throw err;
      }
    },
  });

  fastify.post('/comments/:id/restore', {
    preHandler: [requireStaffSession, requirePermission('comments.moderate'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const comment = await commentsService.restoreComment(id);
        return reply.status(200).send({ comment: { id: comment.id, status: comment.status } });
      } catch (err) {
        if (err instanceof CommentDomainError) return sendError(reply, err.code, err.message, req.id, 404);
        throw err;
      }
    },
  });

  fastify.post('/comments/:id/delete', {
    preHandler: [requireStaffSession, requirePermission('comments.moderate'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const comment = await commentsService.adminDeleteComment(id);
        return reply.status(200).send({ comment: { id: comment.id, status: comment.status } });
      } catch (err) {
        if (err instanceof CommentDomainError) return sendError(reply, err.code, err.message, req.id, 404);
        throw err;
      }
    },
  });

  fastify.get('/comment-reports', {
    preHandler: [requireStaffSession, requirePermission('comments.read')],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as CommentReportListQuery;
      const params: { status?: string; limit: number; offset: number } = {
        limit: query.limit ? parseInt(query.limit, 10) : 50,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      };
      if (query.status) params.status = query.status;
      const result = await commentsService.listReports(params);
      return reply.status(200).send(result);
    },
  });

  fastify.post('/comment-reports/:id/resolve', {
    preHandler: [requireStaffSession, requirePermission('comments.moderate'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { action?: string } | undefined;
      const action = body?.action || 'resolved';
      await commentsService.resolveReport(id, action, req.user!.id);
      return reply.status(200).send({ success: true });
    },
  });
}
