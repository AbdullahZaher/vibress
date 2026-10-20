import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ExtensionAdminNavigationResponseSchema } from "@vibress/api-contracts";
import type { PluginAdminPermission } from "@vibress/plugin-sdk";
import { requireStaffSession } from "../middleware/auth";
import { pluginsService } from "../services";
import { admitAdminViews, type AdmittedAdminView } from "../plugins/admin-view-registry";
import { canAccessExtensionAdminRoute } from "../plugins/admin-view-permissions";

function reject(reply: FastifyReply, req: FastifyRequest, code: string, status: number) {
  return reply.status(status).send({
    errors: [{ code, message: code.replaceAll("_", " ").toLowerCase(), requestId: req.id }],
  });
}

const NAV_PERMISSIONS: readonly PluginAdminPermission[] = [
  "plugins.read", "plugins.manage", "posts.read", "posts.edit",
];
const MAX_CACHED_MODULES = 64;
const FAILED_ENTRY_TTL_MS = 30_000;

// Cache ONLY static descriptors admitted from previously hash-verified,
// operator-approved artifacts. Never cache authorization or publication state.
// One Promise per artifact also coalesces concurrent discovery loads.
const descriptorCache = new Map<string, {
  fingerprint: string;
  admitted: Promise<readonly AdmittedAdminView[] | null>;
  failureExpiresAt: number | null;
}>();

function cachedViews(
  pluginId: string,
  fingerprint: string,
  load: () => Promise<readonly AdmittedAdminView[] | null>,
): Promise<readonly AdmittedAdminView[] | null> {
  const existing = descriptorCache.get(pluginId);
  if (existing?.fingerprint === fingerprint &&
      (existing.failureExpiresAt === null || existing.failureExpiresAt > Date.now())) {
    return existing.admitted;
  }
  const entry: {
    fingerprint: string;
    admitted: Promise<readonly AdmittedAdminView[] | null>;
    failureExpiresAt: number | null;
  } = { fingerprint, admitted: Promise.resolve(null), failureExpiresAt: null };
  entry.admitted = Promise.resolve().then(load).then((result) => {
    if (result === null) entry.failureExpiresAt = Date.now() + FAILED_ENTRY_TTL_MS;
    return result;
  }).catch(() => {
    entry.failureExpiresAt = Date.now() + FAILED_ENTRY_TTL_MS;
    return null;
  });
  descriptorCache.delete(pluginId);
  descriptorCache.set(pluginId, entry);
  if (descriptorCache.size > MAX_CACHED_MODULES) {
    const oldest = descriptorCache.keys().next().value;
    if (oldest !== undefined) descriptorCache.delete(oldest);
  }
  return entry.admitted;
}

/**
 * Read-only Staff discovery. Host publication + local role are authoritative.
 * A navigation link is never a grant: the actual Admin GET independently
 * checks origin, Staff permission, plugin capability and publication state.
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
      const eligible = NAV_PERMISSIONS.some((permission) =>
        canAccessExtensionAdminRoute(
          req.permissions, req.roles, req.publicationContext?.role, permission,
        ));
      if (!eligible) return reply.status(200).send({ items: [] });

      try {
        const [plugins, fingerprints] = await Promise.all([
          pluginsService.listPluginsForPublication(publicationId),
          pluginsService.listOperatorAdminFingerprints(),
        ]);
        const items: Array<{
          pluginId: string;
          viewId: string;
          routeId: string;
          title: { en: string; ar: string };
          label: { en: string; ar: string };
          permission: PluginAdminPermission;
        }> = [];
        // All successful contributions are included up to the operator
        // lockfile maximum (64 trusted modules × 8 views).
        for (const plugin of plugins) {
          if (!plugin.publicationScoped || !plugin.publicationEnabled ||
              plugin.status !== "active" ||
              !plugin.capabilities.includes("admin.navigation") ||
              !plugin.capabilities.includes("extension.routes.admin")) continue;
          const digest = fingerprints.get(plugin.manifestId);
          if (!digest) continue; // not present in the approved operator release

          // Identity includes the registry's version, not only its public ID.
          const fingerprint = plugin.version + ":" + plugin.vibressApiVersion + ":" + digest;
          const views = await cachedViews(plugin.manifestId, fingerprint, async () => {
            try {
              const module = await pluginsService.resolveExtensionApiModule(
                plugin.manifestId, publicationId, "extension.routes.admin",
              );
              return module ? admitAdminViews(module) : null;
            } catch {
              return null;
            }
          });
          if (!views) {
            // Do not leak trusted-loader exception text or poison other plugins.
            req.log.warn({ pluginId: plugin.manifestId, requestId: req.id },
              "Extension Admin navigation contribution unavailable");
            continue;
          }
          for (const view of views) {
            if (canAccessExtensionAdminRoute(
              req.permissions, req.roles, req.publicationContext?.role, view.permission,
            )) items.push({ pluginId: plugin.manifestId, ...view });
          }
        }
        const response = ExtensionAdminNavigationResponseSchema.safeParse({ items });
        if (!response.success) return reject(reply, req, "EXTENSION_INVALID_ADMIN_VIEWS", 503);
        return reply.status(200).send(response.data);
      } catch {
        // Operator manifest/DB registry failure is not a plugin contribution
        // error and must fail closed, without leaking internal state.
        return reject(reply, req, "EXTENSION_UNAVAILABLE", 503);
      }
    },
  });
}
