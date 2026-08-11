import { FastifyInstance } from 'fastify';
import { CreatePageInputSchema, UpdatePageInputSchema, SchedulePageInputSchema } from '@vibress/api-contracts';
import { pagesService, authorsService, revisionsService } from '../services';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';
import { PageDomainError } from '@vibress/pages';

export async function pageRoutes(fastify: FastifyInstance) {
  // List pages
  fastify.get('/pages', {
    preHandler: [requireStaffSession, requirePermission('pages.read')],
    handler: async (req, reply) => {
      const { status, search, limit, offset } = req.query as any;
      const result = await pagesService.listPages({
        status,
        search,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });

      const pagesWithAuthors = await Promise.all(
        result.pages.map(async (p: Record<string, any>) => {
          const authors = await authorsService.getPageAuthors(p.id);
          return { ...p, authors };
        })
      );

      return reply.status(200).send({
        pages: pagesWithAuthors,
        total: result.total,
      });
    },
  });

  // Get page by ID
  fastify.get('/pages/:id', {
    preHandler: [requireStaffSession, requirePermission('pages.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const page = await pagesService.findById(id);
      if (!page) {
        return reply.status(404).send({
          errors: [{ code: 'PAGE_NOT_FOUND', message: 'Page not found', requestId: req.id }],
        });
      }

      const authors = await authorsService.getPageAuthors(id);
      return reply.status(200).send({
        page: { ...page, authors },
      });
    },
  });

  // Create page
  fastify.post('/pages', {
    preHandler: [requireStaffSession, requirePermission('pages.create'), validateOrigin],
    handler: async (req, reply) => {
      const parseResult = CreatePageInputSchema.safeParse(req.body);
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

      const page = await pagesService.createPage(
        {
          ...parseResult.data,
          scheduledAt: parseResult.data.scheduledAt ? new Date(parseResult.data.scheduledAt) : null,
        },
        req.user!.id
      );

      const authors = await authorsService.getPageAuthors(page.id);
      return reply.status(201).send({
        page: { ...page, authors },
      });
    },
  });

  // Update page
  fastify.put('/pages/:id', {
    preHandler: [requireStaffSession, requirePermission('pages.edit'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = UpdatePageInputSchema.safeParse(req.body);
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
        const page = await pagesService.updatePage(id, parseResult.data, req.user!.id);
        const authors = await authorsService.getPageAuthors(page.id);
        return reply.status(200).send({
          page: { ...page, authors },
        });
      } catch (err: unknown) {
        if (err instanceof PageDomainError) {
          if (err.code === 'CONTENT_CONFLICT') {
            return reply.status(409).send({
              errors: [{ code: 'CONTENT_CONFLICT', message: err.message, requestId: req.id }],
            });
          }
          if (err.code === 'PAGE_NOT_FOUND') {
            return reply.status(404).send({
              errors: [{ code: 'PAGE_NOT_FOUND', message: 'Page not found', requestId: req.id }],
            });
          }
        }
        throw err;
      }
    },
  });

  // Delete page
  fastify.delete('/pages/:id', {
    preHandler: [requireStaffSession, requirePermission('pages.delete'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        await pagesService.deletePage(id, req.user!.id);
        return reply.status(200).send({ success: true });
      } catch (err: unknown) {
        if (err instanceof PageDomainError && err.code === 'PAGE_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'PAGE_NOT_FOUND', message: 'Page not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Publish page
  fastify.post('/pages/:id/publish', {
    preHandler: [requireStaffSession, requirePermission('pages.publish'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const page = await pagesService.publishPage(id, req.user!.id);
        return reply.status(200).send({ page });
      } catch (err: unknown) {
        if (err instanceof PageDomainError) {
          if (err.code === 'PAGE_NOT_FOUND') {
            return reply.status(404).send({
              errors: [{ code: 'PAGE_NOT_FOUND', message: 'Page not found', requestId: req.id }],
            });
          }
          if (err.code === 'VALIDATION_ERROR') {
            return reply.status(400).send({
              errors: [{ code: 'VALIDATION_ERROR', message: err.message, requestId: req.id }],
            });
          }
        }
        throw err;
      }
    },
  });

  // Unpublish page
  fastify.post('/pages/:id/unpublish', {
    preHandler: [requireStaffSession, requirePermission('pages.publish'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const page = await pagesService.unpublishPage(id, req.user!.id);
        return reply.status(200).send({ page });
      } catch (err: unknown) {
        if (err instanceof PageDomainError && err.code === 'PAGE_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'PAGE_NOT_FOUND', message: 'Page not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Schedule page
  fastify.post('/pages/:id/schedule', {
    preHandler: [requireStaffSession, requirePermission('pages.publish'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = SchedulePageInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [{ code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message || 'Invalid schedule timestamp', requestId: req.id }],
        });
      }

      try {
        const scheduledAt = new Date(parseResult.data.scheduledAt);
        const page = await pagesService.schedulePage(id, scheduledAt, req.user!.id);
        return reply.status(200).send({ page });
      } catch (err: unknown) {
        if (err instanceof PageDomainError) {
          if (err.code === 'INVALID_SCHEDULE_TIME') {
            return reply.status(400).send({
              errors: [{ code: 'INVALID_SCHEDULE_TIME', message: err.message, requestId: req.id }],
            });
          }
          if (err.code === 'PAGE_NOT_FOUND') {
            return reply.status(404).send({
              errors: [{ code: 'PAGE_NOT_FOUND', message: 'Page not found', requestId: req.id }],
            });
          }
        }
        throw err;
      }
    },
  });

  // Cancel page schedule
  fastify.post('/pages/:id/cancel-schedule', {
    preHandler: [requireStaffSession, requirePermission('pages.publish'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const page = await pagesService.cancelSchedule(id, req.user!.id);
        return reply.status(200).send({ page });
      } catch (err: unknown) {
        if (err instanceof PageDomainError && err.code === 'PAGE_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'PAGE_NOT_FOUND', message: 'Page not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Get page revisions
  fastify.get('/pages/:id/revisions', {
    preHandler: [requireStaffSession, requirePermission('pages.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const page = await pagesService.findById(id);
      if (!page) {
        return reply.status(404).send({
          errors: [{ code: 'PAGE_NOT_FOUND', message: 'Page not found', requestId: req.id }],
        });
      }

      const revisions = await revisionsService.getRevisions('page', id);
      return reply.status(200).send({ revisions });
    },
  });
}
