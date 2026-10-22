import type { FastifyInstance, FastifyReply } from "fastify";
import {
  PluginEventEnqueueSchema, PluginPublicationParamsSchema,
  PluginEventRecoveryParamsSchema, PluginEventFailureListQuerySchema,
  PluginEventReplayRequestSchema, PluginEventFailedDtoSchema,
  PluginEventFailedListResponseSchema,
} from "@vibress/api-contracts";
import { PluginDomainError } from "@vibress/plugins";
import {
  requireStaffSession, requirePermission,
  requirePlatformPluginOperator, validateOrigin,
} from "../middleware/auth";
import { pluginsService } from "../services";
import {
  getPluginEventRecoveryService, PluginEventRecoveryError,
} from "../plugins/plugin-event-recovery";

import {
  enqueueTrustedPluginEvent, PluginEventConflictError,
} from "../plugins/plugin-event-queue";

/**
 * A deliberately operator-only admission surface. The request never selects a
 * publication; Staff middleware resolves it. Plugins cannot invoke this route
 * with an arbitrary tenant id, and worker authorization is independent.
 */
export async function adminPluginEventRoutes(fastify: FastifyInstance) {
  fastify.post("/plugins/:id/events", {
    preHandler: [
      requireStaffSession, requirePermission("plugins.manage"),
      requirePlatformPluginOperator, validateOrigin,
    ],
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const params = PluginPublicationParamsSchema.safeParse(req.params);
      const body = PluginEventEnqueueSchema.safeParse(req.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({
          errors: [{ code: "VALIDATION_ERROR", message: "Invalid plugin event", requestId: req.id }],
        });
      }
      const publicationId = req.publicationContext?.publicationId;
      const localRole = req.publicationContext?.role;
      if (!publicationId || (localRole !== "owner" && localRole !== "admin")) {
        return reply.code(403).send({
          errors: [{ code: "PUBLICATION_ACCESS_DENIED", message: "Publication operator access required", requestId: req.id }],
        });
      }
      try {
        const plugin = await pluginsService.getPlugin(params.data.id);
        if (!plugin || plugin.status !== "active" ||
            !plugin.capabilities.includes("events.subscribe") ||
            (!plugin.hooks.includes(body.data.eventName) && !plugin.hooks.includes("onEvent"))) {
          return reply.code(404).send({
            errors: [{ code: "PLUGIN_EVENT_NOT_FOUND", message: "Plugin event not available", requestId: req.id }],
          });
        }
        if (!(await pluginsService.isPublicationEnabled(plugin.id, publicationId))) {
          return reply.code(404).send({
            errors: [{ code: "PLUGIN_EVENT_NOT_FOUND", message: "Plugin event not available", requestId: req.id }],
          });
        }
        const fingerprints = await pluginsService.listOperatorAdminFingerprints();
        const artifactSha256 = fingerprints.get(plugin.manifestId);
        if (!artifactSha256) {
          return reply.code(404).send({
            errors: [{ code: "PLUGIN_EVENT_NOT_FOUND", message: "Plugin event not available", requestId: req.id }],
          });
        }
        const jobId = await enqueueTrustedPluginEvent({
          schemaVersion: 1,
          scope: "publication",
          publicationId,
          pluginId: plugin.id,
          manifestId: plugin.manifestId,
          pluginVersion: plugin.version,
          artifactSha256,
          ...body.data,
        });
        return reply.code(202).send({ eventId: body.data.eventId, jobId, status: "queued", dispatchStatus: "pending" });
      } catch (error) {
        if (error instanceof PluginEventConflictError) {
          return reply.code(409).send({
            errors: [{ code: "PLUGIN_EVENT_ID_CONFLICT", message: "Event ID already used", requestId: req.id }],
          });
        }
        if (error instanceof PluginDomainError && (
          error.code === "PLUGIN_RECOVERY_MAINTENANCE" ||
          error.code === "PLUGIN_STATE_UNAVAILABLE"
        )) {
          return reply.code(503).send({
            errors: [{ code: "PLUGIN_EVENTS_UNAVAILABLE", message: "Plugin event admission unavailable", requestId: req.id }],
          });
        }
        // Never expose Redis, filesystem, or operator-lockfile details.
        return reply.code(503).send({
          errors: [{ code: "PLUGIN_EVENTS_UNAVAILABLE", message: "Plugin event admission unavailable", requestId: req.id }],
        });
      }
    },
  });
  const operatorAccess = [
    requireStaffSession, requirePermission("plugins.manage"),
    requirePlatformPluginOperator,
  ];
  function scopedPublication(req: {
    publicationContext?: { publicationId?: string; role?: string } | undefined;
  }): string | null {
    const context = req.publicationContext;
    return context?.publicationId &&
      (context.role === "owner" || context.role === "admin")
      ? context.publicationId : null;
  }
  function recoveryError(error: unknown, reply: FastifyReply, requestId: string) {
    const code = error instanceof PluginEventRecoveryError ? error.code : "UNAVAILABLE";
    const status = code === "NOT_FOUND" ? 404 : code === "CONFLICT" ? 409 : 503;
    return reply.code(status).send({
      errors: [{
        code: "PLUGIN_EVENT_" + code,
        message: "Plugin event recovery unavailable",
        requestId,
      }],
    });
  }

  // No errors, stacktraces or original event payloads are returned to Staff.
  // Offset refers to a bounded slice of the cross-tenant Redis failed set;
  // every visible entry must also match an authoritative scoped PG receipt.
  fastify.get("/plugins/:id/events/failed", {
    preHandler: operatorAccess,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const params = PluginPublicationParamsSchema.safeParse(req.params);
      const query = PluginEventFailureListQuerySchema.safeParse(req.query);
      if (!params.success || !query.success) {
        return reply.code(400).send({
          errors: [{ code: "VALIDATION_ERROR", message: "Invalid failed event query", requestId: req.id }],
        });
      }
      const publicationId = scopedPublication(req);
      if (!publicationId) return reply.code(403).send({
        errors: [{ code: "PUBLICATION_ACCESS_DENIED", message: "Publication operator access required", requestId: req.id }],
      });
      try {
        const result = await getPluginEventRecoveryService().listFailed(
          publicationId, params.data.id, query.data.offset, query.data.limit,
        );
        return reply.code(200).send(PluginEventFailedListResponseSchema.parse(result));
      } catch (error: unknown) {
        return recoveryError(error, reply, req.id);
      }
    },
  });

  fastify.get("/plugins/:id/events/:eventId", {
    preHandler: operatorAccess,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const params = PluginEventRecoveryParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(400).send({
        errors: [{ code: "VALIDATION_ERROR", message: "Invalid event identifier", requestId: req.id }],
      });
      const publicationId = scopedPublication(req);
      if (!publicationId) return reply.code(403).send({
        errors: [{ code: "PUBLICATION_ACCESS_DENIED", message: "Publication operator access required", requestId: req.id }],
      });
      try {
        const result = await getPluginEventRecoveryService().getFailed(
          publicationId, params.data.id, params.data.eventId,
        );
        return reply.code(200).send(PluginEventFailedDtoSchema.parse(result));
      } catch (error: unknown) {
        return recoveryError(error, reply, req.id);
      }
    },
  });

  fastify.post("/plugins/:id/events/:eventId/replay", {
    preHandler: [...operatorAccess, validateOrigin],
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const params = PluginEventRecoveryParamsSchema.safeParse(req.params);
      const body = PluginEventReplayRequestSchema.safeParse(req.body);
      if (!params.success || !body.success) return reply.code(400).send({
        errors: [{ code: "VALIDATION_ERROR", message: "Replay requires explicit confirmation", requestId: req.id }],
      });
      const publicationId = scopedPublication(req);
      if (!publicationId || !req.user) return reply.code(403).send({
        errors: [{ code: "PUBLICATION_ACCESS_DENIED", message: "Publication operator access required", requestId: req.id }],
      });
      try {
        const result = await getPluginEventRecoveryService().replay(
          publicationId, params.data.id, params.data.eventId,
          { actorUserId: req.user.id, requestId: req.id },
        );
        return reply.code(202).send({
          ...PluginEventFailedDtoSchema.parse(result), status: "requeued",
        });
      } catch (error: unknown) {
        return recoveryError(error, reply, req.id);
      }
    },
  });
}
