import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  requireStaffSession,
  requirePermission,
} from "../middleware/auth";
import { contentModelerService, workspaceService } from "../services";
import {
  CreateEntryInput,
  CreateModelInput,
  UpdateEntryInput,
  UpdateModelInput,
  ValidationError,
  analyzeSchemaEvolution,
} from "@vibress/content-modeler";
import { getConfig } from "@vibress/config";

const sendError = (
  reply: FastifyReply,
  code: string,
  message: string,
  requestId: string,
  status = 400,
  details?: Record<string, unknown>,
) =>
  reply
    .status(status)
    .send({ errors: [{ code, message, requestId, ...(details || {}) }] });

export async function contentModelerRoutes(fastify: FastifyInstance) {
  // ---------------- ADMIN: Content Models ----------------

  fastify.get("/content-models", {
    preHandler: [requireStaffSession, requirePermission("posts.read")],
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      const models = await contentModelerService.listModels(pubId);
      return reply.send({ data: models });
    },
  });

  fastify.post<{ Body: CreateModelInput }>("/content-models", {
    preHandler: [requireStaffSession, requirePermission("settings.edit")],
    handler: async (req, reply) => {
      const { name, slug, description, fields, settings } = req.body || {};
      if (!name || !name.trim()) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Model name is required",
          req.id,
        );
      }

      const pubId = req.publicationContext?.publicationId || "pub_default";

      try {
        const model = await contentModelerService.createModel(
          {
            name: name.trim(),
            slug,
            description,
            fields: fields || [],
            settings,
          },
          pubId,
        );

        return reply.status(201).send({ data: model });
      } catch (err) {
        if (err instanceof ValidationError) {
          return sendError(
            reply,
            "VALIDATION_ERROR",
            err.message,
            req.id,
            400,
            { fieldErrors: err.fieldErrors },
          );
        }
        return sendError(
          reply,
          "ERROR",
          err instanceof Error ? err.message : "Failed to create content model",
          req.id,
        );
      }
    },
  });

  fastify.get<{ Params: { idOrSlug: string } }>(
    "/content-models/:idOrSlug",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const pubId = req.publicationContext?.publicationId || "pub_default";
        const model = await contentModelerService.getModelByIdOrSlug(
          req.params.idOrSlug,
          pubId,
        );
        if (!model) {
          return sendError(reply, "NOT_FOUND", "Content model not found", req.id, 404);
        }
        return reply.send({ data: model });
      },
    },
  );

  const handleUpdateModel = async (
    req: FastifyRequest<{ Params: { id: string }; Body: UpdateModelInput }>,
    reply: FastifyReply,
  ) => {
    const pubId = req.publicationContext?.publicationId || "pub_default";
    try {
      const model = await contentModelerService.updateModel(
        req.params.id,
        req.body || {},
        pubId,
      );
      return reply.send({ data: model });
    } catch (err) {
      return sendError(
        reply,
        "NOT_FOUND",
        err instanceof Error ? err.message : "Content model not found",
        req.id,
        404,
      );
    }
  };

  // Support both PUT and PATCH for model updates
  fastify.put<{ Params: { id: string }; Body: UpdateModelInput }>(
    "/content-models/:id",
    {
      preHandler: [requireStaffSession, requirePermission("settings.edit")],
      handler: handleUpdateModel,
    },
  );

  fastify.patch<{ Params: { id: string }; Body: UpdateModelInput }>(
    "/content-models/:id",
    {
      preHandler: [requireStaffSession, requirePermission("settings.edit")],
      handler: handleUpdateModel,
    },
  );

  fastify.delete<{ Params: { id: string } }>("/content-models/:id", {
    preHandler: [requireStaffSession, requirePermission("settings.edit")],
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      try {
        await contentModelerService.deleteModel(req.params.id, pubId);
        return reply.send({ data: { deleted: true } });
      } catch (err) {
        return sendError(
          reply,
          "NOT_FOUND",
          err instanceof Error ? err.message : "Content model not found",
          req.id,
          404,
        );
      }
    },
  });

  // Schema Evolution Preview
  fastify.post<{
    Params: { id: string };
    Body: { fields: any[] };
  }>("/content-models/:id/schema-evolution-preview", {
    preHandler: [requireStaffSession, requirePermission("settings.edit")],
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      const model = await contentModelerService.getModelByIdOrSlug(
        req.params.id,
        pubId,
      );
      if (!model) {
        return sendError(reply, "NOT_FOUND", "Content model not found", req.id, 404);
      }
      const newFields = req.body?.fields || [];
      const evolution = analyzeSchemaEvolution(model.fields, newFields);
      return reply.send({ data: evolution });
    },
  });

  // ---------------- ADMIN: Content Entries ----------------

  fastify.get<{
    Params: { modelSlug: string };
    Querystring: {
      status?: "draft" | "published" | "archived";
      limit?: string;
      offset?: string;
      search?: string;
      includeRelations?: string;
    };
  }>("/content-models/:modelSlug/entries", {
    preHandler: [requireStaffSession, requirePermission("posts.read")],
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      try {
        const entries = await contentModelerService.listEntries(
          req.params.modelSlug,
          pubId,
          {
            status: req.query.status,
            limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
            search: req.query.search,
            includeRelations: req.query.includeRelations === "true",
          },
        );
        return reply.send({ data: entries });
      } catch (err) {
        return sendError(
          reply,
          "NOT_FOUND",
          err instanceof Error ? err.message : "Content model not found",
          req.id,
          404,
        );
      }
    },
  });

  fastify.post<{
    Params: { modelSlug: string };
    Body: CreateEntryInput;
  }>("/content-models/:modelSlug/entries", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      const { title, slug, data, status } = req.body || {};
      if (!title || !title.trim()) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Entry title is required",
          req.id,
        );
      }

      const pubId = req.publicationContext?.publicationId || "pub_default";

      try {
        const entry = await contentModelerService.createEntry(
          req.params.modelSlug,
          {
            title: title.trim(),
            slug,
            data: data || {},
            status,
          },
          req.user!.id,
          pubId,
        );

        return reply.status(201).send({ data: entry });
      } catch (err) {
        if (err instanceof ValidationError) {
          return sendError(
            reply,
            "VALIDATION_ERROR",
            err.message,
            req.id,
            400,
            { fieldErrors: err.fieldErrors },
          );
        }
        return sendError(
          reply,
          "ERROR",
          err instanceof Error ? err.message : "Failed to create entry",
          req.id,
        );
      }
    },
  });

  fastify.get<{
    Params: { modelSlug: string; entryId: string };
    Querystring: { includeRelations?: string };
  }>(
    "/content-models/:modelSlug/entries/:entryId",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const pubId = req.publicationContext?.publicationId || "pub_default";
        const entry = await contentModelerService.getEntryById(
          req.params.modelSlug,
          req.params.entryId,
          pubId,
          req.query.includeRelations === "true",
        );
        if (!entry) {
          return sendError(
            reply,
            "NOT_FOUND",
            "Content entry not found",
            req.id,
            404,
          );
        }
        return reply.send({ data: entry });
      },
    },
  );

  const handleUpdateEntry = async (
    req: FastifyRequest<{
      Params: { modelSlug: string; entryId: string };
      Body: UpdateEntryInput;
    }>,
    reply: FastifyReply,
  ) => {
    const pubId = req.publicationContext?.publicationId || "pub_default";
    try {
      const entry = await contentModelerService.updateEntry(
        req.params.modelSlug,
        req.params.entryId,
        req.body || {},
        req.user!.id,
        pubId,
      );
      return reply.send({ data: entry });
    } catch (err) {
      if (err instanceof ValidationError) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          err.message,
          req.id,
          400,
          { fieldErrors: err.fieldErrors },
        );
      }
      return sendError(
        reply,
        "ERROR",
        err instanceof Error ? err.message : "Failed to update entry",
        req.id,
      );
    }
  };

  // Support both PUT and PATCH for entry updates
  fastify.put<{
    Params: { modelSlug: string; entryId: string };
    Body: UpdateEntryInput;
  }>("/content-models/:modelSlug/entries/:entryId", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: handleUpdateEntry,
  });

  fastify.patch<{
    Params: { modelSlug: string; entryId: string };
    Body: UpdateEntryInput;
  }>("/content-models/:modelSlug/entries/:entryId", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: handleUpdateEntry,
  });

  // Entry Lifecycle Actions
  fastify.post<{
    Params: { modelSlug: string; entryId: string };
  }>("/content-models/:modelSlug/entries/:entryId/publish", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      try {
        const entry = await contentModelerService.publishEntry(
          req.params.modelSlug,
          req.params.entryId,
          req.user!.id,
          pubId,
        );
        return reply.send({ data: entry });
      } catch (err) {
        return sendError(
          reply,
          "ERROR",
          err instanceof Error ? err.message : "Failed to publish entry",
          req.id,
        );
      }
    },
  });

  fastify.post<{
    Params: { modelSlug: string; entryId: string };
  }>("/content-models/:modelSlug/entries/:entryId/unpublish", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      try {
        const entry = await contentModelerService.unpublishEntry(
          req.params.modelSlug,
          req.params.entryId,
          req.user!.id,
          pubId,
        );
        return reply.send({ data: entry });
      } catch (err) {
        return sendError(
          reply,
          "ERROR",
          err instanceof Error ? err.message : "Failed to unpublish entry",
          req.id,
        );
      }
    },
  });

  fastify.post<{
    Params: { modelSlug: string; entryId: string };
  }>("/content-models/:modelSlug/entries/:entryId/archive", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      try {
        const entry = await contentModelerService.archiveEntry(
          req.params.modelSlug,
          req.params.entryId,
          req.user!.id,
          pubId,
        );
        return reply.send({ data: entry });
      } catch (err) {
        return sendError(
          reply,
          "ERROR",
          err instanceof Error ? err.message : "Failed to archive entry",
          req.id,
        );
      }
    },
  });

  fastify.delete<{ Params: { modelSlug: string; entryId: string } }>(
    "/content-models/:modelSlug/entries/:entryId",
    {
      preHandler: [requireStaffSession, requirePermission("posts.edit")],
      handler: async (req, reply) => {
        const pubId = req.publicationContext?.publicationId || "pub_default";
        try {
          await contentModelerService.deleteEntry(
            req.params.modelSlug,
            req.params.entryId,
            pubId,
          );
          return reply.send({ data: { deleted: true } });
        } catch (err) {
          return sendError(
            reply,
            "ERROR",
            err instanceof Error ? err.message : "Failed to delete entry",
            req.id,
          );
        }
      },
    },
  );
}

export async function publicContentModelRoutes(fastify: FastifyInstance) {
  // Enforce publication context resolution on all public content model routes
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

  // Public Collections List Endpoint
  fastify.get<{
    Params: { modelSlug: string };
    Querystring: {
      limit?: string;
      offset?: string;
      search?: string;
      locale?: string;
      sortBy?: "createdAt" | "updatedAt" | "publishedAt" | "title" | "slug";
      sortOrder?: "asc" | "desc";
    };
  }>("/collections/:modelSlug", {
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      const model = await contentModelerService.getModelByIdOrSlug(
        req.params.modelSlug,
        pubId,
      );
      if (!model) {
        return sendError(
          reply,
          "NOT_FOUND",
          "Collection not found",
          req.id,
          404,
        );
      }

      const limit = Math.min(
        Math.max(req.query.limit ? parseInt(req.query.limit, 10) : 20, 1),
        100,
      );
      const offset = Math.max(
        req.query.offset ? parseInt(req.query.offset, 10) : 0,
        0,
      );

      try {
        const entries = await contentModelerService.listEntries(
          model.id,
          pubId,
          {
            status: "published",
            limit,
            offset,
            search: req.query.search,
            sortBy: req.query.sortBy,
            sortOrder: req.query.sortOrder,
            includeRelations: true,
          },
        );

        // Map entries through public visibility filter & localization
        const publicEntries = entries.map((entry) =>
          contentModelerService.toPublicEntryDto(
            entry,
            model,
            "public",
            req.query.locale,
          ),
        );

        return reply.send({
          data: publicEntries,
          meta: {
            model: {
              id: model.id,
              name: model.name,
              slug: model.slug,
              description: model.description,
            },
            pagination: {
              limit,
              offset,
              count: publicEntries.length,
            },
          },
        });
      } catch (err) {
        return sendError(
          reply,
          "ERROR",
          err instanceof Error ? err.message : "Failed to fetch collection",
          req.id,
        );
      }
    },
  });

  // Public Single Entry Endpoint
  fastify.get<{
    Params: { modelSlug: string; entrySlug: string };
    Querystring: { locale?: string };
  }>("/collections/:modelSlug/:entrySlug", {
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      const model = await contentModelerService.getModelByIdOrSlug(
        req.params.modelSlug,
        pubId,
      );
      if (!model) {
        return sendError(
          reply,
          "NOT_FOUND",
          "Collection not found",
          req.id,
          404,
        );
      }

      const entry = await contentModelerService.getEntryById(
        model.id,
        req.params.entrySlug,
        pubId,
        true,
      );
      if (!entry || entry.status !== "published") {
        return sendError(
          reply,
          "NOT_FOUND",
          "Collection entry not found",
          req.id,
          404,
        );
      }

      const publicEntry = contentModelerService.toPublicEntryDto(
        entry,
        model,
        "public",
        req.query.locale,
      );

      return reply.send({ data: publicEntry });
    },
  });
}
