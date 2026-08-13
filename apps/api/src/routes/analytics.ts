import { FastifyInstance } from 'fastify';
import { requireStaffSession, requirePermission } from '../middleware/auth';
import { analyticsOverviewService } from '../services';
import { appLogger } from '../observability';
import { metrics } from '@vibress/observability';

/**
 * Admin Analytics dashboard API. One endpoint returns the full dashboard
 * payload; raw per-event metrics remain available via the existing
 * /api/admin/v1/analytics/metrics endpoint (Intelligence page).
 */
export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/analytics/overview', {
    preHandler: [requireStaffSession, requirePermission('analytics.read')],
    handler: async (req, reply) => {
      const { range } = req.query as { range?: string };
      const started = performance.now();
      try {
        const params: { range?: string; limit?: number } = { limit: 10 };
        if (range) params.range = range;
        const overview = await analyticsOverviewService.getOverview(params);
        metrics.gauge('analytics.query.duration_ms', Math.round(performance.now() - started));
        return reply.status(200).send(overview);
      } catch (err: unknown) {
        metrics.counter('analytics.query.failed', 1);
        appLogger.error('analytics overview query failed', { requestId: req.id, range }, err as Error);
        throw err;
      }
    },
  });
}
