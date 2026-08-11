import { FastifyInstance } from 'fastify';
import { CreateTagInputSchema, UpdateTagInputSchema } from '@vibress/api-contracts';
import { tagsService } from '../services';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';
import { TagDomainError } from '@vibress/tags';

export async function tagRoutes(fastify: FastifyInstance) {
  // List tags
  fastify.get('/tags', {
    preHandler: [requireStaffSession, requirePermission('tags.read')],
    handler: async (req, reply) => {
      const { search } = req.query as { search?: string };
      const tags = await tagsService.listAll(search);
      return reply.status(200).send({ tags });
    },
  });

  // Get tag by ID
  fastify.get('/tags/:id', {
    preHandler: [requireStaffSession, requirePermission('tags.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const tag = await tagsService.findById(id);
      if (!tag) {
        return reply.status(404).send({
          errors: [{ code: 'TAG_NOT_FOUND', message: 'Tag not found', requestId: req.id }],
        });
      }
      return reply.status(200).send({ tag });
    },
  });

  // Create tag
  fastify.post('/tags', {
    preHandler: [requireStaffSession, requirePermission('tags.create'), validateOrigin],
    handler: async (req, reply) => {
      const parseResult = CreateTagInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid tag payload',
              requestId: req.id,
            },
          ],
        });
      }

      const tag = await tagsService.createTag(parseResult.data);
      return reply.status(201).send({ tag });
    },
  });

  // Update tag
  fastify.put('/tags/:id', {
    preHandler: [requireStaffSession, requirePermission('tags.edit'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = UpdateTagInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid tag payload',
              requestId: req.id,
            },
          ],
        });
      }

      try {
        const tag = await tagsService.updateTag(id, parseResult.data);
        return reply.status(200).send({ tag });
      } catch (err: unknown) {
        if (err instanceof TagDomainError && err.code === 'TAG_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'TAG_NOT_FOUND', message: 'Tag not found', requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Delete tag
  fastify.delete('/tags/:id', {
    preHandler: [requireStaffSession, requirePermission('tags.delete'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      await tagsService.deleteTag(id);
      return reply.status(200).send({ success: true });
    },
  });
}
