import "./tracing-init.js";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import crypto from "node:crypto";
import multipart from "@fastify/multipart";
import {
  getDbPool,
  closeDbPool,
  seedDatabase,
  assertDatabaseSchemaReady,
} from "@vibress/database";
import { getRedisClient, closeRedisClient } from "@vibress/cache";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { postRoutes } from "./routes/posts";
import { pageRoutes } from "./routes/pages";
import { tagRoutes } from "./routes/tags";
import { mediaRoutes } from "./routes/media";
import { storageRoutes } from "./routes/storage";
import { themeRoutes } from "./routes/themes";
import { memberRoutes } from "./routes/members";
import { adminMemberRoutes } from "./routes/admin-members";
import { publicContentRoutes } from "./routes/content";
import { memberBillingRoutes } from "./routes/member-billing";
import { adminBillingRoutes } from "./routes/admin-billing";
import { publicCatalogRoutes } from "./routes/catalog";
import { billingWebhookRoutes } from "./routes/billing-webhooks";
import { adminNewsletterRoutes } from "./routes/admin-newsletters";
import {
  memberNewsletterRoutes,
  publicUnsubscribeRoutes,
} from "./routes/member-newsletters";
import { emailWebhookRoutes } from "./routes/email-webhooks";
import { startWebhookEventBridge } from "./webhook-event-bridge";
import { startAsyncBridge } from "./async-bridge";
import {
  publicCommentRoutes,
  memberCommentRoutes,
  adminCommentModerationRoutes,
} from "./routes/comments";
import { memberNotificationRoutes } from "./routes/notifications";
import {
  publicRecommendationRoutes,
  adminRecommendationRoutes,
} from "./routes/recommendations";
import { adminIntegrationRoutes, machineApiRoutes } from "./routes/platform";
import { adminPluginEventRoutes } from "./routes/plugin-events";
import { closePluginEventQueue } from "./plugins/plugin-event-queue";
import {
  adminExtensionApiRoutes,
  memberExtensionApiRoutes,
  publicExtensionApiRoutes,
} from "./routes/extension-api";
import { unsplashRoutes } from "./routes/integrations-unsplash";
import {
  publicSearchRoutes,
  adminAnalyticsRoutes,
  adminSearchRoutes,
} from "./routes/intelligence";
import { healthRoutes } from "./routes/health";
import { setupRoutes, ensureSetupTokenConfigured } from "./routes/setup";
import { analyticsRoutes } from "./routes/analytics";
import { analyticsCollectorRoutes } from "./routes/analytics-public";
import { setupService, settingsService, workspaceService } from "./services";
import { mediaStreamRoutes } from "./routes/media-stream";
import { adminOperationsRoutes } from "./routes/operations";
import { aiRoutes } from "./routes/ai";
import { collaborationRoutes } from "./routes/collaboration";
import websocket from "@fastify/websocket";
import { collaborationWsRoutes } from "./routes/collaboration-ws";
import {
  contentModelerRoutes,
  publicContentModelRoutes,
} from "./routes/content-models";
import { translationRoutes } from "./routes/translations";
import { whatsNewRoutes } from "./routes/whats-new";
import { distributionRoutes } from "./routes/distribution";
import { openApiDocsRoutes } from "./routes/docs";
import { storageService, themeService, pluginsService } from "./services";
import { getConfig } from "@vibress/config";
import { verifyTrustedPluginRelease, verifyOperatorReleaseAdmission } from "./plugins/operator-release-preflight";
import {
  SITE_AUTH_COOKIE_NAME,
  signSiteAuthToken,
} from "@vibress/security";
import { evaluatePublicSiteAccess } from "./middleware/public-site-privacy";
import {
  appLogger,
  recordHttpError,
  registerMetricsRoutes,
  registerTraceHooks,
  startObservabilityMonitors,
} from "./observability";

const PUBLIC_CONTENT_PREFIX = "/api/content/v1";
const PUBLIC_CONTENT_PRIVATE_ACCESS_EXEMPT_PATHS = new Set([
  "/site",
  "/verify-site-password",
]);

function getSitePrivacySecret(): string {
  const config = getConfig();
  return (
    config.secrets.encryptionKey ||
    process.env.VIBRESS_ENCRYPTION_KEY ||
    "vibress-site-privacy-secret"
  );
}

function normalizePublicContentRoutePath(url: string): string {
  const pathname = url.split("?")[0] || "/";
  if (!pathname.startsWith(PUBLIC_CONTENT_PREFIX)) return pathname;
  return pathname.slice(PUBLIC_CONTENT_PREFIX.length) || "/";
}

function isPublicContentPrivacyExempt(url: string): boolean {
  return PUBLIC_CONTENT_PRIVATE_ACCESS_EXEMPT_PATHS.has(
    normalizePublicContentRoutePath(url),
  );
}

export const buildApp = () => {
  const config = getConfig();

  if (config.isProduction && config.trustProxy === true) {
    appLogger.warn(
      "SECURITY WARNING: TRUST_PROXY is set to true (trust all hops). In production, this allows client-spoofed X-Forwarded-For headers to determine req.ip and bypass rate limiting. Use TRUST_PROXY=1 (or specific trusted CIDRs) combined with Nginx realip configuration instead.",
    );
  }

  const fastify = Fastify({
    logger: false,
    bodyLimit: config.bodyLimitBytes, // Safe configurable default (1MB); raised per-route on upload/import endpoints
    requestIdHeader: "x-request-id",
    trustProxy: config.trustProxy,
    genReqId: function (req) {
      return (req.headers["x-request-id"] as string) || crypto.randomUUID();
    },
  });

  fastify.register(cookie);

  fastify.register(multipart, {
    limits: {
      fileSize: 524288000, // 500MB max limit at multipart route layer
      files: 10,
      fields: 50,
    },
  });

  fastify.register(websocket, {
    options: {
      maxPayload: 65536,
    },
  });

  fastify.register(mediaStreamRoutes);

  fastify.register(rateLimit, {
    global: false, // Apply per route as configured
    errorResponseBuilder: (req, context) => {
      const err = new Error(
        `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      );
      (err as Error & { statusCode: number }).statusCode = 429;
      (err as Error & { code: string }).code = "TOO_MANY_REQUESTS";
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

  // Strip raw workspace/tenant override headers; x-publication-id is authoritatively validated by auth middleware
  fastify.addHook("onRequest", async (request) => {
    if (request.headers["x-workspace-id"]) {
      delete request.headers["x-workspace-id"];
    }
    if (request.headers["x-tenant-id"]) {
      delete request.headers["x-tenant-id"];
    }
  });

  fastify.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith(`${PUBLIC_CONTENT_PREFIX}/`)) {
      return;
    }

    const host = request.hostname || (request.headers["host"] as string | undefined) || null;
    const isDevFallbackAllowed =
      !getConfig().isProduction && request.headers["x-dev-fallback"] !== "false";

    let publicationId: string;
    try {
      const pubCtx = await workspaceService.resolvePublicPublicationContext({
        host,
        isDevFallbackAllowed,
      });
      publicationId = pubCtx.publicationId;
      request.publicationContext = {
        publicationId: pubCtx.publicationId,
        workspaceId: pubCtx.workspaceId,
        actorType: pubCtx.actorType,
        isSystemOperation: pubCtx.isSystemOperation,
      };
    } catch {
      return reply.status(404).send({
        errors: [
          {
            code: "PUBLICATION_NOT_FOUND",
            message: "Publication not found",
            requestId: request.id,
          },
        ],
      });
    }

    if (isPublicContentPrivacyExempt(request.url)) {
      return;
    }

    // Test suites share pub_default state across integration files. Keep
    // publication context resolution active, but skip only the private-site
    // password gate in tests so route-level isolation assertions still run.
    if (getConfig().isTest) {
      return;
    }

    const privacy = await evaluatePublicSiteAccess(
      publicationId,
      request.cookies?.[SITE_AUTH_COOKIE_NAME] as string | undefined,
      getSitePrivacySecret(),
      (id) => settingsService.getPublicSettings(id),
    );
    if (privacy === "unavailable") {
      return reply.status(503).send({
        errors: [{
          code: "PRIVACY_STATE_UNAVAILABLE",
          message: "Site privacy state is unavailable",
          requestId: request.id,
        }],
      });
    }
    if (privacy === "denied") {
      return reply.status(403).send({
        errors: [{
          code: "PRIVATE_SITE_AUTH_REQUIRED",
          message: "Private site authentication required",
          requestId: request.id,
        }],
      });
    }
  });

  fastify.addHook("onSend", async (request, reply, payload) => {
    if (getConfig().isTest) {
      return payload;
    }
    if (
      request.method !== "POST" ||
      normalizePublicContentRoutePath(request.url) !== "/verify-site-password" ||
      reply.statusCode !== 200 ||
      !request.publicationContext?.publicationId
    ) {
      return payload;
    }

    const payloadText = Buffer.isBuffer(payload)
      ? payload.toString("utf8")
      : typeof payload === "string"
        ? payload
        : "";

    try {
      const body = JSON.parse(payloadText) as { valid?: unknown; private?: unknown };
      if (body.valid === true && body.private === true) {
        const token = signSiteAuthToken(
          getSitePrivacySecret(),
          request.publicationContext.publicationId,
        );
        reply.setCookie(SITE_AUTH_COOKIE_NAME, token, {
          path: "/",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60,
        });
      }
    } catch {
      // Non-JSON response: leave payload untouched.
    }

    return payload;
  });

  // Central error handler
  fastify.setErrorHandler(function (error, request, reply) {
    const errObj = error instanceof Error ? error : undefined;
    appLogger.error(
      "request failed",
      { requestId: request.id, method: request.method, path: request.url.split("?")[0] },
      errObj,
    );
    const e = error as Error & { statusCode?: number; code?: string };
    const statusCode = e.statusCode || 500;
    const errorCode = e.code || "INTERNAL_ERROR";
    const isServerError = statusCode >= 500;
    const responseCode =
      config.isProduction && isServerError ? "INTERNAL_ERROR" : errorCode;
    const message =
      config.isProduction && isServerError
        ? "Internal Server Error"
        : e.message || "Internal Server Error";
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
  fastify.register(setupRoutes, { prefix: "/api/setup/v1" });
  fastify.register(analyticsRoutes, { prefix: "/api/admin/v1" });
  fastify.register(analyticsCollectorRoutes, {
    prefix: "/api/public/v1/analytics",
  });
  registerTraceHooks(fastify);
  registerMetricsRoutes(fastify);

  // Register Admin & Auth Routes
  fastify.register(authRoutes, { prefix: "/api/admin/v1/auth" });
  fastify.register(adminRoutes, { prefix: "/api/admin/v1" });
  fastify.register(postRoutes, { prefix: "/api/admin/v1" });
  fastify.register(pageRoutes, { prefix: "/api/admin/v1" });
  fastify.register(tagRoutes, { prefix: "/api/admin/v1" });
  fastify.register(mediaRoutes, { prefix: "/api/admin/v1" });
  fastify.register(storageRoutes, { prefix: "/api/admin/v1" });
  fastify.register(themeRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminMemberRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminBillingRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminNewsletterRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminRecommendationRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminCommentModerationRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminIntegrationRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminExtensionApiRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminPluginEventRoutes, { prefix: "/api/admin/v1" });
  fastify.register(unsplashRoutes, {
    prefix: "/api/admin/v1/integrations/unsplash",
  });
  fastify.register(adminAnalyticsRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminSearchRoutes, { prefix: "/api/admin/v1" });
  fastify.register(adminOperationsRoutes, { prefix: "/api/admin/v1" });
  fastify.register(aiRoutes, { prefix: "/api/admin/v1" });
  fastify.register(collaborationRoutes, { prefix: "/api/admin/v1" });
  fastify.register(collaborationWsRoutes, { prefix: "/api/admin/v1" });
  fastify.register(contentModelerRoutes, { prefix: "/api/admin/v1" });
  fastify.register(translationRoutes, { prefix: "/api/admin/v1" });
  fastify.register(whatsNewRoutes, { prefix: "/api/admin/v1" });

  // Register Member Routes
  fastify.register(memberRoutes, { prefix: "/api/members/v1" });
  fastify.register(memberBillingRoutes, { prefix: "/api/members/v1" });
  fastify.register(memberNewsletterRoutes, { prefix: "/api/members/v1" });
  fastify.register(memberCommentRoutes, { prefix: "/api/members/v1" });
  fastify.register(memberNotificationRoutes, { prefix: "/api/members/v1" });
  fastify.register(memberExtensionApiRoutes, { prefix: "/api/members/v1" });

  // Register Public Content Routes
  fastify.register(publicContentRoutes, { prefix: "/api/content/v1" });
  fastify.register(publicCatalogRoutes, { prefix: "/api/content/v1" });
  fastify.register(publicCommentRoutes, { prefix: "/api/content/v1" });
  fastify.register(publicRecommendationRoutes, { prefix: "/api/content/v1" });
  fastify.register(publicSearchRoutes, { prefix: "/api/content/v1" });
  fastify.register(publicContentModelRoutes, { prefix: "/api/content/v1" });
  fastify.register(publicExtensionApiRoutes, { prefix: "/api/content/v1" });
  fastify.register(publicUnsubscribeRoutes, { prefix: "/api/public/v1" });

  // Machine API key surface (separate from staff/member sessions)
  fastify.register(machineApiRoutes, { prefix: "/api/machine/v1" });

  // Register Billing Webhooks (signature-authenticated, NOT cookie auth)
  fastify.register(billingWebhookRoutes, { prefix: "/api/webhooks/v1" });
  fastify.register(emailWebhookRoutes, { prefix: "/api/webhooks/v1/email" });

  // Public Distribution & Feeds (/llms.txt, /.well-known/webfinger, /activitypub/actor, /rss.xml, /feed.json)
  fastify.register(distributionRoutes);

  // Developer Platform OpenAPI 3.1 Documentation & Swagger UI
  fastify.register(openApiDocsRoutes);

  fastify.addHook("onClose", async () => {
    await closePluginEventQueue();
    await pluginsService.shutdown();
  });

  return fastify;
};

const start = async () => {
  const app = buildApp();
  try {
    const port = getConfig().ports.api;

    // Fail before the HTTP listener opens if this replica has missing, altered,
    // unsigned-when-required, or incompatible operator-approved plugin bytes.
    // Legacy bundled-only installs remain unaffected.
    if (process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE === "1" &&
        !process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE) {
      throw new Error("Trusted plugin release mount required");
    }
    const policy = process.env.VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY;
    if (policy !== undefined && policy !== "strict") {
      throw new Error("Unsupported trusted plugin admission policy");
    }
    if (policy === "strict" &&
        (!process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE ||
         !process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256)) {
      throw new Error("Strict operator admission requires pinned release");
    }
    if (process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE) {
      const lockfilePath = process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE;
      const verified = policy === "strict"
        ? (await verifyOperatorReleaseAdmission(lockfilePath,
            process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256)).releases
        : await verifyTrustedPluginRelease(lockfilePath);
      appLogger.info("External plugin release preflight passed", { approvedReleases: verified.length });
    }

    // Initialize clients eagerly on startup
    getDbPool();
    await assertDatabaseSchemaReady();
    getRedisClient();
    await storageService.initializeStartupProvider();

    // Bridge domain events to outbound webhooks
    startWebhookEventBridge();
    // Bridge domain events to analytics and search indexing
    startAsyncBridge();
    // Event-loop lag + process metrics (only if METRICS_ENABLED)
    const observabilityMonitors = startObservabilityMonitors();

    // Ensure system database roles, permissions, and dev staff users are
    // seeded (dev users are automatically skipped in production)
    try {
      await seedDatabase();
      appLogger.info("Seeded database roles, permissions, and staff users");
    } catch (err) {
      appLogger.error("Failed to seed database users", {}, err as Error);
    }

    // Classify legacy databases as installed BEFORE accepting setup traffic:
    // existing Vibress installations must never be exposed to the wizard.
    try {
      await setupService.classifyLegacyInstallation();
    } catch (err) {
      appLogger.error(
        "Failed to classify legacy installation state",
        {},
        err as Error,
      );
    }

    // Dev-only: print an ephemeral setup token when one is not configured.
    ensureSetupTokenConfigured();

    // Ensure an active theme exists (idempotent seed → vibress-default)
    try {
      const active = await themeService.getActiveThemeConfiguration();
      if (!active) {
        await themeService.activateTheme("vibress-default", null);
        appLogger.info("Seeded default active theme (vibress-default)");
      }
    } catch (err) {
      appLogger.error("Failed to seed active theme", {}, err as Error);
    }

    await app.listen({ port, host: "0.0.0.0" });
    appLogger.info(`API listening on port ${port}`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      appLogger.info(`Received ${signal}. Shutting down gracefully...`);
      try {
        observabilityMonitors.stop();
        await app.close();
        await closeDbPool();
        await closeRedisClient();
        const { tracingHandle } = await import("./tracing-init");
        await tracingHandle.stop();
        appLogger.info("Closed out remaining connections.");
        process.exit(0);
      } catch (err) {
        appLogger.error("Error during shutdown", {}, err as Error);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

const isDirectExecution = () => {
  try {
    if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
      return true;
    }
  } catch {
    // ESM scope
  }
  if (process.argv[1]) {
    const script = process.argv[1];
    if (script.endsWith("main.js") || script.endsWith("main.ts") || script.endsWith("main.mjs") || script.includes("/apps/api/")) {
      return true;
    }
  }
  return false;
};

if (isDirectExecution()) {
  start();
}
