import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ExtensionAdminNavigationResponseSchema } from "@vibress/api-contracts";
import { hasPermission } from "@vibress/security";
import { PluginDomainError } from "@vibress/plugins";
import { requireStaffSession } from "../middleware/auth";
import { pluginsService } from "../services";
import { admitAdminViews } from "../plugins/admin-view-registry";

function reject(reply: FastifyReply, req: FastifyRequest, code: string, status: number) {
  return reply.status(status).send({
    errors: [{ code, message: code.replaceAll("_", " ").toLowerCase(), requestId: req.id }],
  });
}

/**
 * Metadata-only discovery. The Host (not a plugin) selects publication and
 * Staff privileges. A returned link never grants access to the corresponding
 * API handler, which checks auth, permission, capability and enablement again.
 */
export async function adminExtensionNavigationRoutes(fastify: FastifyInstance) {
  fastify.get("/extensions/navigation", {
    preHandler: [requireStaffSession],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const publicationId = req.publicationContext?.publicationId;
      if (!publicationId || !req.permissions || !req.roles) {
        return reject(reply, req, "PUBLICATION_ACCESS_DENIED", 403);
      }
      try {
        const plugins = await pluginsService.listPluginsForPublication(publicationId);
        const items = [];
        for (const plugin of plugins) {
          if (!plugin.publicationScoped || !plugin.publicationEnabled ||
              plugin.status !== "active" ||
              !plugin.capabilities.includes("admin.navigation") ||
              !plugin.capabilities.includes("extension.routes.admin")) continue;
          let module;
          try {
            module = await pluginsService.resolveExtensionApiModule(
              plugin.manifestId, publicationId, "extension.routes.admin",
            );
          } catch (error) {
            if (error instanceof PluginDomainError &&
                (error.code === "PLUGIN_PUBLICATION_INACTIVE" || error.code === "PLUGIN_INACTIVE")) {
              continue;
            }
            throw error;
          }
          if (!module) continue;
          const views = admitAdminViews(module);
          if (!views) return reject(reply, req, "EXTENSION_INVALID_ADMIN_VIEWS", 503);
          for (const view of views) {
            if (hasPermission(req.permissions, view.permission, req.roles)) {
              items.push({ pluginId: plugin.manifestId, ...view });
            }
          }
        }
        const response = ExtensionAdminNavigationResponseSchema.safeParse({ items });
        if (!response.success) return reject(reply, req, "EXTENSION_INVALID_ADMIN_VIEWS", 503);
        return reply.status(200).send(response.data);
      } catch {
        // Never serialize loader errors: trusted code exceptions can contain secrets.
        return reject(reply, req, "EXTENSION_UNAVAILABLE", 503);
      }
    },
  });
}
