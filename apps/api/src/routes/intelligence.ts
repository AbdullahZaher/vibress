import { FastifyInstance, FastifyReply } from "fastify";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import {
  searchService,
  analyticsService,
  workspaceService,
} from "../services";
import { enqueueSearchRebuild } from "../async-bridge";
import { SearchDomainError } from "@vibress/search";
import { AnalyticsDomainError } from "@vibress/analytics";
import { getConfig } from "@vibress/config";

type SearchQuery = { q?: string; limit?: string; offset?: string };
type AnalyticsQuery = { from?: string; to?: string; metricName?: string };

const sendError = (
  reply: FastifyReply,
  code: string,
  message: string,
  requestId: string,
  status = 400,
) => reply.status(status).send({ errors: [{ code, message, requestId }] });

// ---------------- Public Search ----------------
export async function publicSearchRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", async (req, reply) => {
    const host = req.hostname || (req.headers["host"] as string) || null;
    const isDevFallbackAllowed =
      !getConfig().isProduction && req.headers["x-dev-fallback"] !== "false";
    try {
      const pubCtx = await workspaceService.resolvePublicPublicationContext({
        host,
        isDevFallbackAllowed,
      });
      req.publicationContext = {
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
            requestId: req.id,
          },
        ],
      });
    }
  });

  fastify.get("/search", {
    config: {
      rateLimit: { max: getConfig().isTest ? 200 : 30, timeWindow: "1 minute" },
    },
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as SearchQuery;
      const q = typeof query.q === "string" ? query.q : "";
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      try {
        const result = await searchService.search(
          q,
          limit,
          offset,
          req.publicationContext?.publicationId,
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (err instanceof SearchDomainError) {
          return sendError(
            reply,
            err.code,
            err.message,
            req.id,
            err.code === "QUERY_TOO_LONG" ? 400 : 400,
          );
        }
        throw err;
      }
    },
  });
}

// ---------------- Admin Analytics ----------------
export async function adminAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get("/analytics/metrics", {
    preHandler: [requireStaffSession, requirePermission("analytics.read")],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as AnalyticsQuery;
      const from = typeof query.from === "string" ? query.from : undefined;
      const to = typeof query.to === "string" ? query.to : undefined;
      const metricName =
        typeof query.metricName === "string" ? query.metricName : undefined;
      try {
        const result = await analyticsService.getMetrics({
          from: from || "",
          to: to || "",
          metricName,
        });
        return reply.status(200).send(result);
      } catch (err) {
        if (err instanceof AnalyticsDomainError)
          return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });
}

// ---------------- Admin Search ----------------
export async function adminSearchRoutes(fastify: FastifyInstance) {
  fastify.post("/search/rebuild", {
    preHandler: [
      requireStaffSession,
      requirePermission("search.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      await enqueueSearchRebuild(req.publicationContext?.publicationId);
      return reply.status(202).send({ accepted: true });
    },
  });

  fastify.get("/search/index-count", {
    preHandler: [requireStaffSession, requirePermission("search.manage")],
    handler: async (req, reply) => {
      const count = await searchService.indexCount(
        req.publicationContext?.publicationId,
      );
      return reply.status(200).send({ count });
    },
  });
}
