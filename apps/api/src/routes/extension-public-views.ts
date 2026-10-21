import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ExtensionAdminNavigationParamsSchema,
  ExtensionPublicViewDtoSchema,
} from "@vibress/api-contracts";
import { PluginDomainError } from "@vibress/plugins";
import { pluginsService } from "../services";
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
