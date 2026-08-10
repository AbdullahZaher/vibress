import { FastifyInstance } from 'fastify';
import { CreatePostInputSchema, UpdatePostInputSchema, SchedulePostInputSchema } from '@vibress/api-contracts';
import { postsService, authorsService, tagsService, revisionsService } from '../services';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';

export async function postRoutes(fastify: FastifyInstance) {
  // List posts
  fastify.get('/posts', {
    preHandler: [requireStaffSession, requirePermission('posts.read')],
    handler: async (req, reply) => {
      const { status, authorId, search, limit, offset, sortBy, sortOrder } = req.query as any;
      const result = await postsService.listPosts({
        status,
        authorId,
        search,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
        sortBy,
        sortOrder,
      });

      const postsWithDetails = await Promise.all(
        result.posts.map(async (p: Record<string, any>) => {
          const authors = await authorsService.getPostAuthors(p.id);
          const tagIds = await postsService.getPostTagIds(p.id);
          return { ...p, authors, tagIds };
        })
      );

      return reply.status(200).send({
        posts: postsWithDetails,
        total: result.total,
      });
    },
  });

  // Get post by ID
  fastify.get('/posts/:id', {
    preHandler: [requireStaffSession, requirePermission('posts.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const post = await postsService.findById(id);
      if (!post) {
        return reply.status(404).send({
          errors: [{ code: 'POST_NOT_FOUND', message: 'Post not found', requestId: req.id }],
        });
      }

      const authors = await authorsService.getPostAuthors(id);
      const tagIds = await postsService.getPostTagIds(id);

      return reply.status(200).send({
        post: { ...post, authors, tagIds },
      });
    },
  });

  // Create post
  fastify.post('/posts', {
    preHandler: [requireStaffSession, requirePermission('posts.create'), validateOrigin],
    handler: async (req, reply) => {
      const parseResult = CreatePostInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid input',
              requestId: req.id,
            },
          ],
        });
      }

      const post = await postsService.createPost(
        {
          ...parseResult.data,
          scheduledAt: parseResult.data.scheduledAt ? new Date(parseResult.data.scheduledAt) : null,
        },
        req.user!.id
      );

      const authors = await authorsService.getPostAuthors(post.id);
      const tagIds = await postsService.getPostTagIds(post.id);

      return reply.status(201).send({
        post: { ...post, authors, tagIds },
      });
    },
  });

  // Update post
  fastify.put('/posts/:id', {
    preHandler: [requireStaffSession, requirePermission('posts.edit'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = UpdatePostInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid input',
              requestId: req.id,
            },
          ],
        });
      }

      try {
        const post = await postsService.updatePost(id, parseResult.data, req.user!.id);
        const authors = await authorsService.getPostAuthors(post.id);
        const tagIds = await postsService.getPostTagIds(post.id);

        return reply.status(200).send({
          post: { ...post, authors, tagIds },
        });
      } catch (err: any) {
        if (err.code === 'CONTENT_CONFLICT') {
          return reply.status(409).send({
            errors: [{ code: 'CONTENT_CONFLICT', message: err.message, requestId: req.id }],
          });
        }
        if (err.code === 'POST_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'POST_NOT_FOUND', message: 'Post not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Delete post
  fastify.delete('/posts/:id', {
    preHandler: [requireStaffSession, requirePermission('posts.delete'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        await postsService.deletePost(id, req.user!.id);
        return reply.status(200).send({ success: true });
      } catch (err: any) {
        if (err.code === 'POST_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'POST_NOT_FOUND', message: 'Post not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Publish post
  fastify.post('/posts/:id/publish', {
    preHandler: [requireStaffSession, requirePermission('posts.publish'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const post = await postsService.publishPost(id, req.user!.id);
        return reply.status(200).send({ post });
      } catch (err: any) {
        if (err.code === 'POST_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'POST_NOT_FOUND', message: 'Post not found', requestId: req.id }],
          });
        }
        if (err.code === 'VALIDATION_ERROR') {
          return reply.status(400).send({
            errors: [{ code: 'VALIDATION_ERROR', message: err.message, requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Unpublish post
  fastify.post('/posts/:id/unpublish', {
    preHandler: [requireStaffSession, requirePermission('posts.publish'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const post = await postsService.unpublishPost(id, req.user!.id);
        return reply.status(200).send({ post });
      } catch (err: any) {
        if (err.code === 'POST_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'POST_NOT_FOUND', message: 'Post not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Schedule post
  fastify.post('/posts/:id/schedule', {
    preHandler: [requireStaffSession, requirePermission('posts.publish'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = SchedulePostInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [{ code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message || 'Invalid schedule timestamp', requestId: req.id }],
        });
      }

      try {
        const scheduledAt = new Date(parseResult.data.scheduledAt);
        const post = await postsService.schedulePost(id, scheduledAt, req.user!.id);
        return reply.status(200).send({ post });
      } catch (err: any) {
        if (err.code === 'INVALID_SCHEDULE_TIME') {
          return reply.status(400).send({
            errors: [{ code: 'INVALID_SCHEDULE_TIME', message: err.message, requestId: req.id }],
          });
        }
        if (err.code === 'POST_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'POST_NOT_FOUND', message: 'Post not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Cancel post schedule
  fastify.post('/posts/:id/cancel-schedule', {
    preHandler: [requireStaffSession, requirePermission('posts.publish'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const post = await postsService.cancelSchedule(id, req.user!.id);
        return reply.status(200).send({ post });
      } catch (err: any) {
        if (err.code === 'POST_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'POST_NOT_FOUND', message: 'Post not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Get post revisions
  fastify.get('/posts/:id/revisions', {
    preHandler: [requireStaffSession, requirePermission('posts.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const post = await postsService.findById(id);
      if (!post) {
        return reply.status(404).send({
          errors: [{ code: 'POST_NOT_FOUND', message: 'Post not found', requestId: req.id }],
        });
      }

      const revisions = await revisionsService.getRevisions('post', id);
      return reply.status(200).send({ revisions });
    },
  });

  // Restore post revision
  fastify.post('/posts/:id/revisions/:revisionId/restore', {
    preHandler: [requireStaffSession, requirePermission('posts.edit'), validateOrigin],
    handler: async (req, reply) => {
      const { id, revisionId } = req.params as { id: string; revisionId: string };
      try {
        const post = await postsService.restoreRevision(id, revisionId, req.user!.id);
        return reply.status(200).send({ post });
      } catch (err: any) {
        if (err.code === 'POST_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'POST_NOT_FOUND', message: 'Post not found', requestId: req.id }],
          });
        }
        if (err.code === 'REVISION_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'REVISION_NOT_FOUND', message: 'Revision not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });
}
