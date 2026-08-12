import './tracing-init';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import multipart from '@fastify/multipart';
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
import { healthRoutes } from './routes/health';
import { mediaStreamRoutes } from './routes/media-stream';
import { adminOperationsRoutes } from './routes/operations';
import { storageService, themeService } from './services';
import { getConfig } from '@vibress/config';
import {
  appLogger,
  recordHttpError,
  registerMetricsRoutes,
  registerTraceHooks,
  startObservabilityMonitors,
} from './observability';

export const buildApp = () => {
  const config = getConfig();
  const fastify = Fastify({
    logger: false,
    bodyLimit: 1048576, // 1MB body limit
    requestIdHeader: 'x-request-id',
    trustProxy: true,
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

  fastify.register(mediaStreamRoutes);

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
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
  });

  fastify.register(cors, {
    origin: config.cors.origin,
    credentials: true,
  });

  // Central error handler
  fastify.setErrorHandler(function (error, request, reply) {
    const errObj = error instanceof Error ? error : undefined;
    appLogger.error('request failed', { requestId: request.id, method: request.method, path: request.url }, errObj);
    const e = error as Error & { statusCode?: number; code?: string };
    const statusCode = e.statusCode || 500;
    const errorCode = e.code || 'INTERNAL_ERROR';
    const isServerError = statusCode >= 500;
    const responseCode = config.isProduction && isServerError ? 'INTERNAL_ERROR' : errorCode;
    const message = config.isProduction && isServerError
      ? 'Internal Server Error'
      : e.message || 'Internal Server Error';
    recordHttpError(statusCode, errorCode);
    reply.status(statusCode).send({
      errors: [
        {
          code: responseCode,
          message,
          requestId: request.id,
        },
      ],
    });
  });

  fastify.register(healthRoutes);
  registerTraceHooks(fastify);
  registerMetricsRoutes(fastify);

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
    const port = getConfig().ports.api;

    // Initialize clients eagerly on startup
    getDbPool();
    getRedisClient();
    await storageService.initializeStartupProvider();

    // Bridge domain events to outbound webhooks
    startWebhookEventBridge();
    // Bridge domain events to analytics, search indexing, and automations
    startAsyncBridge();
    // Event-loop lag + process metrics (only if METRICS_ENABLED)
    const observabilityMonitors = startObservabilityMonitors();

    // Ensure system database roles, permissions, and dev staff users are seeded
    try {
      await seedDatabase();
      appLogger.info('Seeded database roles, permissions, and dev staff users');
    } catch (err) {
      appLogger.error('Failed to seed database users', {}, err as Error);
    }

    // Ensure an active theme exists (idempotent seed → vibress-default)
    try {
      const active = await themeService.getActiveThemeConfiguration();
      if (!active) {
        await themeService.activateTheme('vibress-default', null);
        appLogger.info('Seeded default active theme (vibress-default)');
      }
    } catch (err) {
      appLogger.error('Failed to seed active theme', {}, err as Error);
    }

    await app.listen({ port, host: '0.0.0.0' });
    appLogger.info(`API listening on port ${port}`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      appLogger.info(`Received ${signal}. Shutting down gracefully...`);
      try {
        observabilityMonitors.stop();
        await app.close();
        await closeDbPool();
        await closeRedisClient();
        const { tracingHandle } = await import('./tracing-init');
        await tracingHandle.stop();
        appLogger.info('Closed out remaining connections.');
        process.exit(0);
      } catch (err) {
        appLogger.error('Error during shutdown', {}, err as Error);
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
