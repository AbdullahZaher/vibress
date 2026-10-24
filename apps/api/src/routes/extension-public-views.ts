import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PluginApiScope } from "@vibress/plugin-sdk";
import { supportsPublishedExtensionLocale } from "@vibress/i18n";
import {
  ExtensionAdminNavigationParamsSchema,
  ExtensionPublicViewDtoSchema,
  ExtensionPublicPageResponseSchema,
  ExtensionPublicPageQuerySchema,
  validateExtensionApiObject,
} from "@vibress/api-contracts";
import { PluginDomainError, createHostPluginStorageSession } from "@vibress/plugins";
import { pluginsService, publicationLocaleService } from "../services";
import { admitPublicViews } from "../plugins/public-view-registry";

function reject(req: FastifyRequest, reply: FastifyReply, code: string, status: number) {
  return reply.status(status).send({
    errors: [{ code, message: code.toLowerCase().replaceAll("_", " "), requestId: req.id }],
  });
}

/**
 * Public descriptor lookup. Main Fastify /api/content/v1 middleware owns
 * hostname -> publication resolution and the private-site password gate.
 * The descriptor never renders plugin HTML or calls the plugin GET handler.
 */
export async function publicExtensionViewRoutes(fastify: FastifyInstance) {
  /**
   * One Host-publication snapshot for descriptor, route admission, initialization,
   * and scalar data. The previous descriptor/v1 route endpoints are retained for
   * existing integrations; SSR uses this single, independently guarded request.
   */
  fastify.get("/extensions/:pluginId/views/:viewId/page", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      const params = ExtensionAdminNavigationParamsSchema.safeParse(req.params);
      const localeQuery = ExtensionPublicPageQuerySchema.safeParse(req.query);
      if (!params.success || !localeQuery.success) return reject(req, reply, "VALIDATION_ERROR", 400);
      const publicationId = req.publicationContext?.publicationId;
      if (!publicationId) return reject(req, reply, "PUBLICATION_NOT_FOUND", 404);
      const { pluginId, viewId } = params.data;
      try {
        const module = await pluginsService.resolveExtensionApiModule(
          pluginId, publicationId, "extension.routes.public",
        );
        if (!module) return reject(req, reply, "EXTENSION_VIEW_NOT_FOUND", 404);
        const views = admitPublicViews(module);
        if (!views) return reject(req, reply, "EXTENSION_INVALID_PUBLIC_VIEWS", 503);
        const view = views.find((item) => item.viewId === viewId);
        if (!view) return reject(req, reply, "EXTENSION_VIEW_NOT_FOUND", 404);
        const localePolicy = await publicationLocaleService.getConfiguration(publicationId);
        const locale = localeQuery.data.locale ?? localePolicy.primaryLocale;
        if (!localePolicy.enabledLocales.includes(locale) ||
            !supportsPublishedExtensionLocale(view.publishedLocales, locale)) {
          return reject(req, reply, "EXTENSION_VIEW_NOT_FOUND", 404);
        }
        const route = module.routes?.find((item) =>
          item.audience === "public" && item.method === "GET" &&
          item.id === view.routeId && item.query === undefined && item.body === undefined);
        if (!route) return reject(req, reply, "EXTENSION_INVALID_PUBLIC_VIEWS", 503);

        const allowed = await pluginsService.prepareExtensionApiExecution(
          pluginId, publicationId, "extension.routes.public", module,
        );
        if (!allowed) return reject(req, reply, "EXTENSION_VIEW_NOT_FOUND", 404);
        const binding = await pluginsService.resolveExtensionStorageBinding(
          pluginId, publicationId, "extension.storage.read", "public",
        ).catch(() => null);
        let storageSession: ReturnType<typeof createHostPluginStorageSession> | null = null;
        if (binding) {
          storageSession = createHostPluginStorageSession(
            {
              pluginId: binding.pluginId, publicationId,
              actorUserId: "anonymous", requestId: req.id,
              allowWrites: false,
            },
            binding.models,
          );
        }
        const scope: PluginApiScope = {
          publicationId, requestId: req.id, locale, principal: { kind: "anonymous" },
          ...(storageSession ? { storage: storageSession.storage } : {}),
        };
        // Public extension execution never receives privileged storage writes, member,
        // staff, or tenant selectors from the caller. The Host rechecks
        // publication enablement before invoking the trusted plugin callback.
        let output: unknown;
        let sessionCloseFailed = false;
        try {
          output = await route.handle({ query: {}, body: {} }, scope);
        } catch {
          return reject(req, reply, "EXTENSION_HANDLER_FAILED", 503);
        } finally {
          try {
            await storageSession?.close();
          } catch {
            sessionCloseFailed = true;
          }
        }
        if (sessionCloseFailed) return reject(req, reply, "EXTENSION_HANDLER_FAILED", 503);
        const data = validateExtensionApiObject(route.response, output);
        if (!data) return reject(req, reply, "EXTENSION_INVALID_RESPONSE", 503);
        const parsed = ExtensionPublicPageResponseSchema.safeParse({
          pluginId, viewId, routeId: view.routeId, title: view.title,
          ...(view.publishedLocales ? { publishedLocales: view.publishedLocales } : {}),
          publicationId, locale, data,
        });
        if (!parsed.success) return reject(req, reply, "EXTENSION_INVALID_RESPONSE", 503);
        return reply.status(200).send(parsed.data);
      } catch (error) {
        if (error instanceof PluginDomainError &&
            (error.code === "PLUGIN_PUBLICATION_INACTIVE" ||
             error.code === "PLUGIN_INACTIVE")) {
          return reject(req, reply, "EXTENSION_VIEW_NOT_FOUND", 404);
        }
        return reject(req, reply, "EXTENSION_UNAVAILABLE", 503);
      }
    },
  });

  fastify.get("/extensions/:pluginId/views/:viewId", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      const params = ExtensionAdminNavigationParamsSchema.safeParse(req.params);
      if (!params.success) return reject(req, reply, "VALIDATION_ERROR", 400);
      const publicationId = req.publicationContext?.publicationId;
      if (!publicationId) return reject(req, reply, "PUBLICATION_NOT_FOUND", 404);
      try {
        const module = await pluginsService.resolveExtensionApiModule(
          params.data.pluginId, publicationId, "extension.routes.public",
        );
        if (!module) return reject(req, reply, "EXTENSION_VIEW_NOT_FOUND", 404);
        const views = admitPublicViews(module);
        if (!views) return reject(req, reply, "EXTENSION_INVALID_PUBLIC_VIEWS", 503);
        const view = views.find((item) => item.viewId === params.data.viewId);
        if (!view) return reject(req, reply, "EXTENSION_VIEW_NOT_FOUND", 404);
        const response = ExtensionPublicViewDtoSchema.safeParse({
          pluginId: params.data.pluginId, ...view,
        });
        if (!response.success) return reject(req, reply, "EXTENSION_INVALID_PUBLIC_VIEWS", 503);
        return reply.status(200).send(response.data);
      } catch (error) {
        if (error instanceof PluginDomainError &&
            (error.code === "PLUGIN_PUBLICATION_INACTIVE" ||
             error.code === "PLUGIN_INACTIVE")) {
          return reject(req, reply, "EXTENSION_VIEW_NOT_FOUND", 404);
        }
        return reject(req, reply, "EXTENSION_UNAVAILABLE", 503);
      }
    },
  });
}
