import { FastifyInstance, FastifyReply } from "fastify";
import { recommendationsService, commentsService } from "../services";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import {
  CreateRecommendationSchema,
  UpdateRecommendationSchema,
} from "@vibress/api-contracts";
import { RecommendationDomainError } from "@vibress/recommendations";
import { CommentDomainError } from "@vibress/comments";

const sendError = (
  reply: FastifyReply,
  code: string,
  message: string,
  requestId: string,
  status = 400,
) => reply.status(status).send({ errors: [{ code, message, requestId }] });

export async function publicRecommendationRoutes(fastify: FastifyInstance) {
  // Public: list active recommendations
  fastify.get("/recommendations", async (_req, reply) => {
    const recommendations =
      await recommendationsService.listActiveRecommendations();
    return reply.status(200).send({
      recommendations: recommendations.map((r) => ({
        id: r.id,
        url: r.url,
        title: r.title,
        description: r.description,
        imageUrl: r.imageUrl,
        faviconUrl: r.faviconUrl,
      })),
    });
  });

  // Public: record a click
  fastify.post("/recommendations/:id/click", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { sessionId?: string } | undefined;
    const sessionId = body?.sessionId || null;
    try {
      await recommendationsService.recordClick(id, null, sessionId);
      return reply.status(200).send({ success: true });
    } catch (err) {
      if (err instanceof RecommendationDomainError) {
        return reply
          .status(404)
          .send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
      }
      throw err;
    }
  });
}

export async function adminRecommendationRoutes(fastify: FastifyInstance) {
  fastify.get("/recommendations", {
    preHandler: [
      requireStaffSession,
      requirePermission("recommendations.read"),
    ],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as { includeArchived?: string };
      const includeArchived = String(query.includeArchived) === "true";
      const recommendations = await recommendationsService.listRecommendations({
        includeArchived,
      });
      return reply.status(200).send({ recommendations });
    },
  });

  fastify.post("/recommendations", {
    preHandler: [
      requireStaffSession,
      requirePermission("recommendations.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const parsed = CreateRecommendationSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Invalid recommendation",
          req.id,
        );
      try {
        const recommendation =
          await recommendationsService.createRecommendation(
            parsed.data,
            req.user!.id,
          );
        return reply.status(201).send({ recommendation });
      } catch (err) {
        if (err instanceof RecommendationDomainError)
          return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.patch("/recommendations/:id", {
    preHandler: [
      requireStaffSession,
      requirePermission("recommendations.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = UpdateRecommendationSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Invalid recommendation",
          req.id,
        );
      try {
        const recommendation =
          await recommendationsService.updateRecommendation(
            id,
            parsed.data,
            req.user!.id,
          );
        return reply.status(200).send({ recommendation });
      } catch (err) {
        if (err instanceof RecommendationDomainError) {
          return sendError(
            reply,
            err.code,
            err.message,
            req.id,
            err.code === "RECOMMENDATION_NOT_FOUND" ? 404 : 400,
          );
        }
        throw err;
      }
    },
  });

  fastify.post("/recommendations/:id/archive", {
    preHandler: [
      requireStaffSession,
      requirePermission("recommendations.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const recommendation =
          await recommendationsService.archiveRecommendation(id, req.user!.id);
        return reply.status(200).send({ recommendation });
      } catch (err) {
        if (err instanceof RecommendationDomainError)
          return sendError(reply, err.code, err.message, req.id, 404);
        throw err;
      }
    },
  });

  fastify.get("/recommendations/:id/stats", {
    preHandler: [
      requireStaffSession,
      requirePermission("recommendations.read"),
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const stats = await recommendationsService.getClickCount(id);
      return reply.status(200).send({ stats });
    },
  });
}

type AdminCommentListQuery = {
  status?: string;
  postId?: string;
  limit?: string;
  offset?: string;
};

