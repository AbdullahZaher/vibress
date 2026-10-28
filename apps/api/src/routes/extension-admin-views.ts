import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import {
  ExtensionAdminNavigationResponseSchema, ExtensionAdminNavigationParamsSchema,
  ExtensionAdminUiResponseSchema, ExtensionNativeAdminResponseV1Schema,
} from "@vibress/api-contracts";
import type { PluginAdminPermission } from "@vibress/plugin-sdk";
import { PluginDomainError } from "@vibress/plugins";
import { getConfig } from "@vibress/config";
import { requireStaffSession, validateOrigin } from "../middleware/auth";
import { pluginsService } from "../services";
import { admitAdminViews, type AdmittedAdminView } from "../plugins/admin-view-registry";
import { canAccessExtensionAdminRoute } from "../plugins/admin-view-permissions";
import { appLogger } from "../observability";
import { admitNativeAdminPage } from "../plugins/native-admin-registry";
import { admitNativeDomainWorkflow } from "../plugins/native-domain-workflow";
import { admitNativeDataModel } from "../plugins/native-data-registry";

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
  // Native is operator-controlled and pinned to the exact approved release.
  // Never let plugin-supplied metadata switch rendering or grant authorization.
  fastify.get("/extensions/:pluginId/views/:viewId/native", {
    preHandler: [requireStaffSession, validateOrigin],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      const params = ExtensionAdminNavigationParamsSchema.safeParse(req.params);
      if (!params.success) return reject(reply, req, "VALIDATION_ERROR", 400);
      const publicationId = req.publicationContext?.publicationId;
      if (!publicationId || !req.permissions || !req.roles) {
        return reject(reply, req, "PUBLICATION_ACCESS_DENIED", 403);
      }
      const { pluginId, viewId } = params.data;
      const legacy = () => reply.status(200).send(
        ExtensionNativeAdminResponseV1Schema.parse({ mode: "legacy" }),
      );
      const allowlist = getConfig().nativeAdminUiReleases;
      // The feature is disabled by default on fresh and upgraded installs.
      if (allowlist.length === 0) return legacy();
      try {
        const digests = await pluginsService.listOperatorAdminFingerprints();
        const digest = digests.get(pluginId);
        if (!digest || !allowlist.includes(`${pluginId}@${digest}`)) return legacy();
        const module = await pluginsService.resolveExtensionApiModule(
          pluginId, publicationId, "extension.routes.admin",
        );
        if (!module) return reject(reply, req, "EXTENSION_UI_NOT_FOUND", 404);
        const admission = admitNativeAdminPage(module, viewId);
        if (admission.kind === "invalid") {
          return reject(reply, req, "EXTENSION_INVALID_NATIVE_VIEW", 503);
        }
        if (admission.kind === "absent") return legacy();
        if (!canAccessExtensionAdminRoute(
          req.permissions, req.roles, req.publicationContext?.role,
          admission.permission,
        )) return reject(reply, req, "PERMISSION_DENIED", 403);
        // A read allowlist must NEVER imply consent to a write workflow.
        // The paired Admin POST independently authenticates and enforces the
        // Host-scoped plugin handler's publication, CAS and business rules.
        let workflow;
        if (getConfig().nativeAdminActionReleases.includes(`${pluginId}@${digest}`)) {
          const admitted = admitNativeDomainWorkflow(module, viewId);
          if (admitted.kind === "invalid") {
            return reject(reply, req, "EXTENSION_INVALID_WORKFLOW", 503);
          }
          if (admitted.kind === "admitted") {
            const storage = await pluginsService.resolveExtensionStorageBinding(
              pluginId, publicationId, "extension.storage.write",
            );
            if (storage?.publicationId === publicationId) {
              const source = module.adminResources?.find(
                (item) => item.id === admitted.workflow.resourceId &&
                  item.viewId === admitted.workflow.viewId,
              );
              if (!source || !admitNativeDataModel(source, storage.models)) {
                return reject(reply, req, "EXTENSION_INVALID_WORKFLOW", 503);
              }
              workflow = admitted.workflow;
            }
          }
        }
        return reply.status(200).send(ExtensionNativeAdminResponseV1Schema.parse({
          mode: "native", page: admission.page, routeId: admission.routeId,
          ...(workflow ? { workflow } : {}),
        }));
      } catch (error) {
        if (error instanceof PluginDomainError &&
            (error.code === "PLUGIN_PUBLICATION_INACTIVE" ||
             error.code === "PLUGIN_INACTIVE")) {
          return reject(reply, req, "EXTENSION_UI_NOT_FOUND", 404);
        }
        return reject(reply, req, "EXTENSION_UNAVAILABLE", 503);
      }
    },
  });
  // Never return a same-origin HTML response: browser consumers must treat
  // this as inert data and cannot use it as an Admin-origin executable page.
  fastify.get("/extensions/:pluginId/views/:viewId/ui", {
    preHandler: [requireStaffSession, validateOrigin],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Referrer-Policy", "no-referrer");
      const params = ExtensionAdminNavigationParamsSchema.safeParse(req.params);
      if (!params.success) return reject(reply, req, "VALIDATION_ERROR", 400);
      const publicationId = req.publicationContext?.publicationId;
      if (!publicationId || !req.permissions || !req.roles) {
        return reject(reply, req, "PUBLICATION_ACCESS_DENIED", 403);
      }
      const { pluginId, viewId } = params.data;

      try {
        // Domain binds module to the active Host publication, global status,
        // external plugin admission and publication enablement.
        const module = await pluginsService.resolveExtensionApiModule(
          pluginId, publicationId, "extension.routes.admin",
        );
        if (!module) return reject(reply, req, "EXTENSION_UI_NOT_FOUND", 404);
        const views = admitAdminViews(module);
        if (!views) return reject(reply, req, "EXTENSION_INVALID_ADMIN_VIEWS", 503);
        const view = views.find((item) => item.viewId === viewId);
        if (!view) return reject(reply, req, "EXTENSION_UI_NOT_FOUND", 404);
        if (!canAccessExtensionAdminRoute(
          req.permissions, req.roles, req.publicationContext?.role, view.permission,
        )) return reject(reply, req, "PERMISSION_DENIED", 403);

        // Repeats lifecycle and publication checks before/after verified file
        // read. The asset can only be present in the operator-owned lockfile.
        const html = await pluginsService.readExtensionAdminUiAsset(
          pluginId, publicationId, viewId,
        );
        if (html === null) return reject(reply, req, "EXTENSION_UI_NOT_FOUND", 404);
        const response = ExtensionAdminUiResponseSchema.safeParse({
          html, sha256: createHash("sha256").update(html, "utf8").digest("hex"),
        });
        if (!response.success) return reject(reply, req, "EXTENSION_INVALID_UI", 503);
        return reply.status(200).send(response.data);
      } catch (error) {
        if (error instanceof PluginDomainError &&
            (error.code === "PLUGIN_PUBLICATION_INACTIVE" ||
             error.code === "PLUGIN_INACTIVE")) {
          return reject(reply, req, "EXTENSION_UI_NOT_FOUND", 404);
        }
        // Never leak filesystem paths, operator lock contents or plugin errors.
        return reject(reply, req, "EXTENSION_UNAVAILABLE", 503);
      }
    },
  });
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
          nativeProbeSupported: true;
          group?: AdmittedAdminView["group"];
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
              const admitted = module ? admitAdminViews(module) : null;
              if (!admitted) {
                appLogger.warn("Extension Admin navigation contribution unavailable", {
                  pluginId: plugin.manifestId, requestId: req.id,
                });
              }
              return admitted;
            } catch {
              // Loader error messages can contain secrets; log bounded metadata
              // only, once per negatively cached artifact and expiry window.
              appLogger.warn("Extension Admin navigation contribution unavailable", {
                pluginId: plugin.manifestId, requestId: req.id,
              });
              return null;
            }
          });
          if (!views) continue;
          for (const view of views) {
            if (canAccessExtensionAdminRoute(
              req.permissions, req.roles, req.publicationContext?.role, view.permission,
            )) items.push({ pluginId: plugin.manifestId, ...view, nativeProbeSupported: true });
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
