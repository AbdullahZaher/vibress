import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';
import { searchService, analyticsService, automationsService } from '../services';
import { enqueueSearchRebuild } from '../async-bridge';
import { SearchDomainError } from '@vibress/search';
import { AutomationDomainError } from '@vibress/automations';
import { AnalyticsDomainError } from '@vibress/analytics';
import { getConfig } from '@vibress/config';

const sendError = (reply: FastifyReply, code: string, message: string, requestId: string, status = 400) =>
  reply.status(status).send({ errors: [{ code, message, requestId }] });

// ---------------- Public Search ----------------
export async function publicSearchRoutes(fastify: FastifyInstance) {
  fastify.get('/search', {
    config: { rateLimit: { max: getConfig().isTest ? 200 : 30, timeWindow: '1 minute' } },
    handler: async (req, reply) => {
      const query = req.query as any;
      const q = typeof query.q === 'string' ? query.q : '';
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      try {
        const result = await searchService.search(q, limit, offset);
        return reply.status(200).send(result);
      } catch (err: any) {
        if (err instanceof SearchDomainError) {
          return sendError(reply, err.code, err.message, req.id, err.code === 'QUERY_TOO_LONG' ? 400 : 400);
        }
        throw err;
      }
    },
  });
}

// ---------------- Admin Analytics ----------------
export async function adminAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/analytics/metrics', {
    preHandler: [requireStaffSession, requirePermission('analytics.read')],
    handler: async (req, reply) => {
      const query = req.query as any;
      const from = typeof query.from === 'string' ? query.from : undefined;
      const to = typeof query.to === 'string' ? query.to : undefined;
      const metricName = typeof query.metricName === 'string' ? query.metricName : undefined;
      try {
        const result = await analyticsService.getMetrics({ from: from || '', to: to || '', metricName });
        return reply.status(200).send(result);
      } catch (err: any) {
        if (err instanceof AnalyticsDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });
}

// ---------------- Admin Search ----------------
export async function adminSearchRoutes(fastify: FastifyInstance) {
  fastify.post('/search/rebuild', {
    preHandler: [requireStaffSession, requirePermission('search.manage'), validateOrigin],
    handler: async (req, reply) => {
      await enqueueSearchRebuild();
      return reply.status(202).send({ accepted: true });
    },
  });

  fastify.get('/search/index-count', {
    preHandler: [requireStaffSession, requirePermission('search.manage')],
    handler: async (_req, reply) => {
      const count = await searchService.indexCount();
      return reply.status(200).send({ count });
    },
  });
}

// ---------------- Admin Automations ----------------
export async function adminAutomationRoutes(fastify: FastifyInstance) {
  fastify.get('/automations', {
    preHandler: [requireStaffSession, requirePermission('automations.read')],
    handler: async (_req, reply) => {
      const automations = await automationsService.listAutomations();
      return reply.status(200).send({ automations });
    },
  });

  fastify.post('/automations', {
    preHandler: [requireStaffSession, requirePermission('automations.manage'), validateOrigin],
    handler: async (req, reply) => {
      const body = req.body as any;
      if (!body?.key || !body?.name || !body?.triggerEvent || !Array.isArray(body?.actions)) {
        return sendError(reply, 'VALIDATION_ERROR', 'key, name, triggerEvent, and actions are required', req.id);
      }
      try {
        const automation = await automationsService.createAutomation({
          key: body.key,
          name: body.name,
          description: body.description || null,
          triggerEvent: body.triggerEvent,
          conditions: body.conditions || [],
          actions: body.actions,
        }, req.user!.id);
        return reply.status(201).send({ automation });
      } catch (err: any) {
        if (err instanceof AutomationDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.patch('/automations/:id', {
    preHandler: [requireStaffSession, requirePermission('automations.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      try {
        const automation = await automationsService.updateAutomation(id, {
          name: body?.name,
          description: body?.description,
          triggerEvent: body?.triggerEvent,
          conditions: body?.conditions,
          actions: body?.actions,
        }, req.user!.id);
        return reply.status(200).send({ automation });
      } catch (err: any) {
        if (err instanceof AutomationDomainError) {
          return sendError(reply, err.code, err.message, req.id, err.code === 'AUTOMATION_NOT_FOUND' ? 404 : 400);
        }
        throw err;
      }
    },
  });

  fastify.post('/automations/:id/activate', {
    preHandler: [requireStaffSession, requirePermission('automations.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const automation = await automationsService.activateAutomation(id, req.user!.id);
        return reply.status(200).send({ automation });
      } catch (err: any) {
        if (err instanceof AutomationDomainError) return sendError(reply, err.code, err.message, req.id, 400);
        throw err;
      }
    },
  });

  fastify.post('/automations/:id/deactivate', {
    preHandler: [requireStaffSession, requirePermission('automations.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const automation = await automationsService.deactivateAutomation(id, req.user!.id);
        return reply.status(200).send({ automation });
      } catch (err: any) {
        if (err instanceof AutomationDomainError) return sendError(reply, err.code, err.message, req.id, 404);
        throw err;
      }
    },
  });

  fastify.post('/automations/:id/run', {
    preHandler: [requireStaffSession, requirePermission('automations.run'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const run = await automationsService.manualRun(id, req.user!.id);
        return reply.status(201).send({ run });
      } catch (err: any) {
        if (err instanceof AutomationDomainError) return sendError(reply, err.code, err.message, req.id, 400);
        throw err;
      }
    },
  });

  fastify.get('/automation-runs', {
    preHandler: [requireStaffSession, requirePermission('automations.read')],
    handler: async (req, reply) => {
      const query = req.query as any;
      const result = await automationsService.listRuns({
        automationId: query.automationId,
        status: query.status,
        limit: query.limit ? parseInt(query.limit, 10) : 20,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      });
      return reply.status(200).send({
        runs: result.runs.map((r) => ({
          id: r.id,
          automationId: r.automationId,
          version: r.version,
          triggerEvent: r.triggerEvent,
          status: r.status,
          depth: r.depth,
          error: r.error,
          startedAt: r.startedAt ? r.startedAt.toISOString() : null,
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
        })),
        total: result.total,
      });
    },
  });

  fastify.get('/automation-runs/:id/steps', {
    preHandler: [requireStaffSession, requirePermission('automations.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const steps = await automationsService.getRunSteps(id);
      return reply.status(200).send({ steps });
    },
  });
}
