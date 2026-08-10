import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import multipart from '@fastify/multipart';
import path from 'node:path';
import fs from 'node:fs';
import { getDbPool, closeDbPool, seedDatabase } from '@vibress/database';
import { getRedisClient, closeRedisClient } from '@vibress/cache';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { postRoutes } from './routes/posts';
import { pageRoutes } from './routes/pages';
import { tagRoutes } from './routes/tags';
import { mediaRoutes } from './routes/media';
import { storageRoutes } from './routes/storage';
import { themeRoutes } from './routes/themes';
import { memberRoutes } from './routes/members';
import { adminMemberRoutes } from './routes/admin-members';
import { publicContentRoutes } from './routes/content';
import { memberBillingRoutes } from './routes/member-billing';
import { adminBillingRoutes } from './routes/admin-billing';
import { publicCatalogRoutes } from './routes/catalog';
import { billingWebhookRoutes } from './routes/billing-webhooks';
import { adminNewsletterRoutes } from './routes/admin-newsletters';
import { memberNewsletterRoutes, publicUnsubscribeRoutes } from './routes/member-newsletters';
import { emailWebhookRoutes } from './routes/email-webhooks';
import { startWebhookEventBridge } from './webhook-event-bridge';
import { startAsyncBridge } from './async-bridge';
import { publicCommentRoutes, memberCommentRoutes } from './routes/comments';
import { memberNotificationRoutes } from './routes/notifications';
import { publicRecommendationRoutes, adminRecommendationRoutes, adminCommentModerationRoutes } from './routes/recommendations';
import { adminIntegrationRoutes, machineApiRoutes } from './routes/platform';
import { publicSearchRoutes, adminAnalyticsRoutes, adminSearchRoutes, adminAutomationRoutes } from './routes/intelligence';
import { adminOperationsRoutes } from './routes/operations';
import { storageService, themeService } from './services';

export const buildApp = () => {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["set-cookie"]',
          'req.body.password',
          'password',
          'password_hash',
          'token',
          'sessionToken',
        ],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 1048576, // 1MB body limit
    requestIdHeader: 'x-request-id',
    genReqId: function (req) {
      return (req.headers['x-request-id'] as string) || crypto.randomUUID();
    },
  });

  fastify.register(cookie);

  fastify.register(multipart, {
    limits: {
      fileSize: 524288000, // 500MB max limit at multipart route layer
      files: 1,
      fields: 10,
    },
  });

  const mediaPath = path.resolve(process.cwd(), 'content', 'media');

  // Manual media serving route — replaces @fastify/static to avoid its CVEs
  fastify.get('/content/media/*', async (request, reply) => {
    const rawKey = (request.params as Record<string, string>)['*'];
    if (!rawKey || typeof rawKey !== 'string') return reply.status(404).send();
    if (rawKey.includes('\0') || rawKey.includes('..') || rawKey.includes('\\') || path.isAbsolute(rawKey)) {
      return reply.status(404).send();
    }
    const resolved = path.resolve(mediaPath, rawKey);
    if (!resolved.startsWith(mediaPath + path.sep) && resolved !== mediaPath) {
      return reply.status(404).send();
    }
    try {
      const buf = await fs.promises.readFile(resolved);
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(buf);
    } catch {
      return reply.status(404).send();
    }
  });

  fastify.register(rateLimit, {
    global: false, // Apply per route as configured
    errorResponseBuilder: (req, context) => {
      const err = new Error(`Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`);
      (err as Error & { statusCode: number }).statusCode = 429;
      (err as Error & { code: string }).code = 'TOO_MANY_REQUESTS';
      (err as Error & { requestId: string }).requestId = req.id;
      return err;
    },
  });

  fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });

  fastify.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://vibress.com']
      : true,
    credentials: true,
  });

  // Central error handler
  fastify.setErrorHandler(function (error: any, request, reply) {
    this.log.error(error);
    const statusCode = error.statusCode || 500;
    const errorCode = error.code || 'INTERNAL_ERROR';
    reply.status(statusCode).send({
      errors: [
        {
          code: errorCode,
          message: error.message || 'Internal Server Error',
          requestId: request.id,
        },
      ],
    });
  });

  fastify.get('/health/live', async () => {
    return { status: 'ok' };
  });

  fastify.get('/api/health/live', async () => {
    return { status: 'ok' };
  });

  fastify.get('/health/ready', async (request, reply) => {
    let isDbReady = false;
    let isRedisReady = false;

    try {
      const pool = getDbPool();
      const res = await pool.query('SELECT 1');
      if (res.rowCount === 1) isDbReady = true;
    } catch (e) {
      fastify.log.error(e, 'DB readiness check failed');
    }

    try {
      const redis = getRedisClient();
      if (redis.status === 'ready') isRedisReady = true;
    } catch (e) {
      fastify.log.error(e, 'Redis readiness check failed');
    }

    if (!isDbReady || !isRedisReady) {
      return reply.status(503).send({
        status: 'not_ready',
        checks: {
          database: isDbReady ? 'up' : 'down',
          redis: isRedisReady ? 'up' : 'down',
        },
      });
    }

    return {
      status: 'ready',
      checks: {
        database: 'up',
        redis: 'up',
      },
    };
  });

  fastify.get('/api', async () => {
    return { name: 'Vibress API', status: 'ok' };
  });

  // Register Admin & Auth Routes
  fastify.register(authRoutes, { prefix: '/api/admin/v1/auth' });
  fastify.register(adminRoutes, { prefix: '/api/admin/v1' });
  fastify.register(postRoutes, { prefix: '/api/admin/v1' });
  fastify.register(pageRoutes, { prefix: '/api/admin/v1' });
  fastify.register(tagRoutes, { prefix: '/api/admin/v1' });
  fastify.register(mediaRoutes, { prefix: '/api/admin/v1' });
  fastify.register(storageRoutes, { prefix: '/api/admin/v1' });
  fastify.register(themeRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminMemberRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminBillingRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminNewsletterRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminRecommendationRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminCommentModerationRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminIntegrationRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminAnalyticsRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminSearchRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminAutomationRoutes, { prefix: '/api/admin/v1' });
  fastify.register(adminOperationsRoutes, { prefix: '/api/admin/v1' });

  // Register Member Routes
  fastify.register(memberRoutes, { prefix: '/api/members/v1' });
  fastify.register(memberBillingRoutes, { prefix: '/api/members/v1' });
  fastify.register(memberNewsletterRoutes, { prefix: '/api/members/v1' });
  fastify.register(memberCommentRoutes, { prefix: '/api/members/v1' });
  fastify.register(memberNotificationRoutes, { prefix: '/api/members/v1' });

  // Register Public Content Routes
  fastify.register(publicContentRoutes, { prefix: '/api/content/v1' });
  fastify.register(publicCatalogRoutes, { prefix: '/api/content/v1' });
  fastify.register(publicCommentRoutes, { prefix: '/api/content/v1' });
  fastify.register(publicRecommendationRoutes, { prefix: '/api/content/v1' });
  fastify.register(publicSearchRoutes, { prefix: '/api/content/v1' });
  fastify.register(publicUnsubscribeRoutes, { prefix: '/api/public/v1' });

  // Machine API key surface (separate from staff/member sessions)
  fastify.register(machineApiRoutes, { prefix: '/api/machine/v1' });

  // Register Billing Webhooks (signature-authenticated, NOT cookie auth)
  fastify.register(billingWebhookRoutes, { prefix: '/api/webhooks/v1' });
  fastify.register(emailWebhookRoutes, { prefix: '/api/webhooks/v1/email' });

  return fastify;
};

const start = async () => {
  const app = buildApp();
  try {
    const port = process.env.API_PORT ? parseInt(process.env.API_PORT) : 7780;

    // Initialize clients eagerly on startup
    getDbPool();
    getRedisClient();
    await storageService.initializeStartupProvider();

    // Bridge domain events to outbound webhooks
    startWebhookEventBridge();
    // Bridge domain events to analytics, search indexing, and automations
    startAsyncBridge();

    // Ensure system database roles, permissions, and dev staff users are seeded
    try {
      await seedDatabase();
      app.log.info('Seeded database roles, permissions, and dev staff users');
    } catch (err) {
      app.log.error(err, 'Failed to seed database users');
    }

    // Ensure an active theme exists (idempotent seed → vibress-default)
    try {
      const active = await themeService.getActiveThemeConfiguration();
      if (!active) {
        await themeService.activateTheme('vibress-default', null);
        app.log.info('Seeded default active theme (vibress-default)');
      }
    } catch (err) {
      app.log.error(err, 'Failed to seed active theme');
    }

    await app.listen({ port, host: '0.0.0.0' });
    app.log.info(`API listening on port ${port}`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      app.log.info(`Received ${signal}. Shutting down gracefully...`);
      try {
        await app.close();
        await closeDbPool();
        await closeRedisClient();
        app.log.info('Closed out remaining connections.');
        process.exit(0);
      } catch (err) {
        app.log.error(err, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}
