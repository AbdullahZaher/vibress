import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PluginStorageItem } from "@vibress/plugin-sdk";
import {
  ExtensionNativeDataParamsV1Schema, ExtensionNativeActionParamsV1Schema,
  ExtensionNativeDataQueryV1Schema, ExtensionNativeActionBodyV1Schema,
  ExtensionNativeDataPageV1Schema, ExtensionNativeActionResultV1Schema,
  ExtensionNativeDataDiscoveryV1Schema,
} from "@vibress/api-contracts";
import { getConfig } from "@vibress/config";
import {
  createHostPluginStorageSession, PluginDomainError,
} from "@vibress/plugins";
import type { ApprovedPluginPhysicalModel } from "@vibress/plugins";
import { requireStaffSession, validateOrigin } from "../middleware/auth";
import { pluginsService } from "../services";
import { canAccessExtensionAdminRoute } from "../plugins/admin-view-permissions";
import { admitNativeDataRegistry, admitNativeDataModel } from "../plugins/native-data-registry";
import {
  nativeFilterHash, issueNativeCursor, readNativeCursor,
  type NativeCursorContext,
} from "../plugins/native-data-cursor";

function reject(reply: FastifyReply, req: FastifyRequest, code: string, status: number) {
  return reply.status(status).send({
    errors: [{ code, message: code.replaceAll("_", " ").toLowerCase(), requestId: req.id }],
  });
}

type Binding = { pluginId: string; publicationId: string;
  models: readonly ApprovedPluginPhysicalModel[] };
type Registry = Extract<ReturnType<typeof admitNativeDataRegistry>, { kind: "admitted" }>;
type Allowed = { ok: true; binding: Binding; registry: Registry; digest: string;
  publicationId: string; actorId: string };
type Denied = { ok: false; code: string; status: number };

/**
 * Host authorization on EVERY request, never by reading a rendered control.
 * Only the operator-approved release and enabled publication can use these
 * first-party storage-backed operations. Writes have a SEPARATE opt-in.
 */
async function authorize(req: FastifyRequest, pluginId: string, write: boolean):
  Promise<Allowed | Denied> {
  const publicationId = req.publicationContext?.publicationId;
  const actorId = req.user?.id;
  if (!publicationId || !actorId || !canAccessExtensionAdminRoute(
    req.permissions, req.roles, req.publicationContext?.role, "plugins.manage",
  )) return { ok: false, code: "PERMISSION_DENIED", status: 403 };
  const config = getConfig();
  try {
    const digests = await pluginsService.listOperatorAdminFingerprints();
    const digest = digests.get(pluginId);
    if (!digest || !/^[a-f0-9]{64}$/.test(digest) ||
        !config.nativeAdminUiReleases.includes(pluginId + "@" + digest) ||
        (write && !config.nativeAdminActionReleases.includes(pluginId + "@" + digest))) {
      return { ok: false, code: "EXTENSION_DATA_NOT_FOUND", status: 404 };
    }
    const module = await pluginsService.resolveExtensionApiModule(
      pluginId, publicationId, "extension.routes.admin",
    );
    if (!module) return { ok: false, code: "EXTENSION_DATA_NOT_FOUND", status: 404 };
    const registry = admitNativeDataRegistry(module);
    if (registry.kind === "absent") {
      return { ok: false, code: "EXTENSION_DATA_NOT_FOUND", status: 404 };
    }
    if (registry.kind !== "admitted") {
      return { ok: false, code: "EXTENSION_INVALID_DATA", status: 503 };
    }
    const binding = await pluginsService.resolveExtensionStorageBinding(
      pluginId, publicationId, write ? "extension.storage.write" : "extension.storage.read",
    );
    if (!binding || binding.publicationId !== publicationId) {
      return { ok: false, code: "EXTENSION_DATA_NOT_FOUND", status: 404 };
    }
    // Host uses the verified module AND live publication/activation before any
    // storage operation; the repository repeats binding checks under DB locks.
    const ready = await pluginsService.prepareExtensionApiExecution(
      pluginId, publicationId, "extension.routes.admin", module,
    );
    if (!ready) return { ok: false, code: "EXTENSION_DATA_NOT_FOUND", status: 404 };
    return { ok: true, binding, registry, digest, publicationId, actorId };
  } catch (error) {
    if (error instanceof PluginDomainError && (
      error.code === "PLUGIN_PUBLICATION_INACTIVE" || error.code === "PLUGIN_INACTIVE"
    )) return { ok: false, code: "EXTENSION_DATA_NOT_FOUND", status: 404 };
    return { ok: false, code: "EXTENSION_UNAVAILABLE", status: 503 };
  }
}

function project(
  record: PluginStorageItem,
  fields: readonly string[],
) {
  const permitted: Record<string, string | number | boolean | null> = {};
  for (const key of fields) {
    if (Object.hasOwn(record.fields, key)) {
      const value = record.fields[key];
      if (value !== undefined) permitted[key] = value;
    }
  }
  return { id: record.id, version: record.version, fields: permitted };
}

/** Never expose raw storage cursor or any undeclared model fields to browsers. */
export async function adminNativeDataRoutes(fastify: FastifyInstance) {
  fastify.get("/extensions/:pluginId/data", {
    preHandler: [requireStaffSession, validateOrigin],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      const params = ExtensionNativeDataParamsV1Schema.pick({ pluginId: true })
        .safeParse(req.params);
      if (!params.success) return reject(reply, req, "VALIDATION_ERROR", 400);
      const admitted = await authorize(req, params.data.pluginId, false);
      if (!admitted.ok) return reject(reply, req, admitted.code, admitted.status);
      if (!admitted.registry.resources.every((resource) =>
        admitNativeDataModel(resource, admitted.binding.models))) {
        return reject(reply, req, "EXTENSION_INVALID_DATA", 503);
      }
      const allowWrites = getConfig().nativeAdminActionReleases.includes(
        params.data.pluginId + "@" + admitted.digest);
      let actions: typeof admitted.registry.actions = [];
      if (allowWrites) {
        try {
          const binding = await pluginsService.resolveExtensionStorageBinding(
            params.data.pluginId, admitted.publicationId, "extension.storage.write",
          );
          if (binding?.publicationId === admitted.publicationId) {
            actions = admitted.registry.actions;
          }
        } catch {
          return reject(reply, req, "EXTENSION_UNAVAILABLE", 503);
        }
      }
      const response = ExtensionNativeDataDiscoveryV1Schema.safeParse({
        schemaVersion: 1,
        resources: admitted.registry.resources.map((r) => ({
          id: r.id, fields: r.fields,
          ...(r.textFilters ? { textFilters: r.textFilters } : {}),
        })),
        actions,
      });
      if (!response.success) return reject(reply, req, "EXTENSION_INVALID_DATA", 503);
      return reply.status(200).send(response.data);
    },
  });

  fastify.get("/extensions/:pluginId/resources/:resourceId", {
    preHandler: [requireStaffSession, validateOrigin],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      const params = ExtensionNativeDataParamsV1Schema.safeParse(req.params);
      const query = ExtensionNativeDataQueryV1Schema.safeParse(req.query);
      if (!params.success || !query.success) return reject(reply, req, "VALIDATION_ERROR", 400);
      const { pluginId, resourceId } = params.data;
      const admitted = await authorize(req, pluginId, false);
      if (!admitted.ok) return reject(reply, req, admitted.code, admitted.status);
      const resource = admitted.registry.resources.find((r) => r.id === resourceId);
      if (!resource) return reject(reply, req, "EXTENSION_DATA_NOT_FOUND", 404);
      if (!admitNativeDataModel(resource, admitted.binding.models)) {
        return reject(reply, req, "EXTENSION_INVALID_DATA", 503);
      }
      const { filterField, filterValue } = query.data;
      if (filterField && !(resource.textFilters ?? []).includes(filterField)) {
        return reject(reply, req, "VALIDATION_ERROR", 400);
      }
      const limit = query.data.limit ? Number(query.data.limit) : 20;
      const context: NativeCursorContext = {
        pluginId, publicationId: admitted.publicationId, actorId: admitted.actorId,
        resourceId, digest: admitted.digest, filterHash: nativeFilterHash(filterField, filterValue),
      };
      const key = getConfig().secrets.encryptionKey;
      const decodedCursor = query.data.cursor
        ? readNativeCursor(query.data.cursor, context, key) : undefined;
      if (query.data.cursor && !decodedCursor) return reject(reply, req, "INVALID_CURSOR", 400);
      const cursor = decodedCursor ?? undefined;
      let response: ReturnType<typeof ExtensionNativeDataPageV1Schema.safeParse> | null = null;
      let failedCode: string | null = null;
      let session: ReturnType<typeof createHostPluginStorageSession> | null = null;
      try {
        session = createHostPluginStorageSession({
          pluginId: admitted.binding.pluginId, publicationId: admitted.publicationId,
          actorUserId: admitted.actorId, requestId: req.id,
        }, admitted.binding.models);
        const page = filterField && filterValue && session.storage.listByText
          ? await session.storage.listByText(
            resource.modelKey, filterField, filterValue, limit, cursor)
          : filterField ? null : await session.storage.list(resource.modelKey, limit, cursor);
        if (!page) {
          failedCode = "EXTENSION_UNAVAILABLE";
        } else {
          const nextCursor = page.nextCursor
            ? issueNativeCursor(context, page.nextCursor, key) : undefined;
          if (page.nextCursor && !nextCursor) {
            failedCode = "EXTENSION_UNAVAILABLE";
          } else {
            response = ExtensionNativeDataPageV1Schema.safeParse({
              schemaVersion: 1,
              items: page.items.map((item) => project(item, resource.fields)),
              ...(nextCursor ? { nextCursor } : {}),
            });
            if (!response.success) failedCode = "EXTENSION_INVALID_RESPONSE";
          }
        }
      } catch {
        failedCode = "EXTENSION_UNAVAILABLE";
      } finally {
        // A storage failure during final drain MUST prevent any success reply.
        if (session) {
          try { await session.close(); } catch { failedCode = "EXTENSION_UNAVAILABLE"; }
        }
      }
      if (failedCode) return reject(reply, req, failedCode, 503);
      if (!response?.success) return reject(reply, req, "EXTENSION_INVALID_RESPONSE", 503);
      if (Buffer.byteLength(JSON.stringify(response.data), "utf8") > 256 * 1024) {
        return reject(reply, req, "EXTENSION_INVALID_RESPONSE", 503);
      }
      return reply.status(200).send(response.data);
    },
  });

  fastify.post("/extensions/:pluginId/actions/:actionId", {
    preHandler: [requireStaffSession, validateOrigin],
    bodyLimit: 16384,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      const params = ExtensionNativeActionParamsV1Schema.safeParse(req.params);
      const body = ExtensionNativeActionBodyV1Schema.safeParse(req.body);
      if (!params.success || !body.success) return reject(reply, req, "VALIDATION_ERROR", 400);
      const admitted = await authorize(req, params.data.pluginId, true);
      if (!admitted.ok) return reject(reply, req, admitted.code, admitted.status);
      const action = admitted.registry.actions.find((a) => a.id === params.data.actionId);
      if (!action) return reject(reply, req, "EXTENSION_DATA_NOT_FOUND", 404);
      const resource = admitted.registry.resources.find((r) => r.id === action.resourceId);
      if (!resource || !admitNativeDataModel(resource, admitted.binding.models,
        action.operation === "create")) {
        return reject(reply, req, "EXTENSION_INVALID_DATA", 503);
      }
      if (Object.keys(body.data.fields).some((key) => !resource.fields.includes(key)) ||
          (action.operation === "create" && body.data.expectedVersion !== undefined) ||
          (action.operation === "update" && body.data.expectedVersion === undefined)) {
        return reject(reply, req, "VALIDATION_ERROR", 400);
      }
      let session: ReturnType<typeof createHostPluginStorageSession>;
      try {
        session = createHostPluginStorageSession({
          pluginId: admitted.binding.pluginId, publicationId: admitted.publicationId,
          actorUserId: admitted.actorId, requestId: req.id, allowWrites: true,
        }, admitted.binding.models);
      } catch {
        return reject(reply, req, "EXTENSION_UNAVAILABLE", 503);
      }
      let result: PluginStorageItem | null = null;
      let errorCode: string | null = null;
      try {
        if (action.operation === "create") {
          result = await session.storage.create(resource.modelKey, body.data.id, body.data.fields);
        } else {
          result = await session.storage.update(
            resource.modelKey, body.data.id, body.data.expectedVersion!,
            body.data.fields,
          );
        }
      } catch (error) {
        const code = error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code : "";
        errorCode = code === "PLUGIN_STORAGE_CONFLICT" ? "CONFLICT"
          : code === "PLUGIN_STORAGE_NOT_FOUND" ? "NOT_FOUND"
            : code === "PLUGIN_STORAGE_INVALID" ? "VALIDATION_ERROR" : "EXTENSION_UNAVAILABLE";
      }
      try { await session.close(); } catch { errorCode = "EXTENSION_UNAVAILABLE"; }
      if (errorCode) {
        const status = errorCode === "CONFLICT" ? 409
          : errorCode === "NOT_FOUND" ? 404 : errorCode === "VALIDATION_ERROR" ? 400 : 503;
        return reject(reply, req, errorCode, status);
      }
      const response = ExtensionNativeActionResultV1Schema.safeParse({
        schemaVersion: 1,
        record: result ? project(result, resource.fields) : null,
      });
      if (!response.success || Buffer.byteLength(JSON.stringify(response.data), "utf8") > 128 * 1024) {
        return reject(reply, req, "EXTENSION_INVALID_RESPONSE", 503);
      }
      return reply.status(action.operation === "create" ? 201 : 200).send(response.data);
    },
  });
}
