import { FastifyInstance, FastifyReply } from "fastify";
import {
  requireStaffSession,
  requirePermission,
} from "../middleware/auth";
import { contentModelerService } from "../services";
import {
  CreateEntryInput,
  CreateModelInput,
  UpdateEntryInput,
  UpdateModelInput,
  ValidationError,
} from "@vibress/content-modeler";

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
    handler: async (_req, reply) => {
      const models = await contentModelerService.listModels();
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

      const model = await contentModelerService.createModel({
        name: name.trim(),
        slug,
        description,
        fields: fields || [],
        settings,
      });

      return reply.status(201).send({ data: model });
    },
  });

  fastify.get<{ Params: { idOrSlug: string } }>(
    "/content-models/:idOrSlug",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const model = await contentModelerService.getModelByIdOrSlug(
          req.params.idOrSlug,
        );
        if (!model) {
          return sendError(reply, "NOT_FOUND", "Content model not found", req.id, 404);
        }
        return reply.send({ data: model });
      },
    },
  );

  fastify.put<{ Params: { id: string }; Body: UpdateModelInput }>(
    "/content-models/:id",
    {
      preHandler: [requireStaffSession, requirePermission("settings.edit")],
      handler: async (req, reply) => {
        try {
          const model = await contentModelerService.updateModel(
            req.params.id,
            req.body || {},
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
      },
    },
  );

  fastify.delete<{ Params: { id: string } }>("/content-models/:id", {
    preHandler: [requireStaffSession, requirePermission("settings.edit")],
    handler: async (req, reply) => {
      await contentModelerService.deleteModel(req.params.id);
      return reply.send({ data: { deleted: true } });
    },
  });

  // ---------------- ADMIN: Content Entries ----------------

  fastify.get<{
    Params: { modelSlug: string };
    Querystring: { status?: "draft" | "published" | "archived"; limit?: string; offset?: string };
  }>("/content-models/:modelSlug/entries", {
    preHandler: [requireStaffSession, requirePermission("posts.read")],
    handler: async (req, reply) => {
      try {
        const entries = await contentModelerService.listEntries(
          req.params.modelSlug,
          {
            status: req.query.status,
            limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
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

  fastify.get<{ Params: { modelSlug: string; entryId: string } }>(
    "/content-models/:modelSlug/entries/:entryId",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const entry = await contentModelerService.getEntryById(
          req.params.modelSlug,
          req.params.entryId,
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

  fastify.put<{
    Params: { modelSlug: string; entryId: string };
    Body: UpdateEntryInput;
  }>("/content-models/:modelSlug/entries/:entryId", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      try {
        const entry = await contentModelerService.updateEntry(
          req.params.modelSlug,
          req.params.entryId,
          req.body || {},
          req.user!.id,
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
    },
  });

  fastify.delete<{ Params: { modelSlug: string; entryId: string } }>(
    "/content-models/:modelSlug/entries/:entryId",
    {
      preHandler: [requireStaffSession, requirePermission("posts.edit")],
      handler: async (req, reply) => {
        try {
          await contentModelerService.deleteEntry(
            req.params.modelSlug,
            req.params.entryId,
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
  // Public Collections endpoint
  fastify.get<{
    Params: { modelSlug: string };
    Querystring: { limit?: string; offset?: string };
  }>("/collections/:modelSlug", {
    handler: async (req, reply) => {
      try {
        const entries = await contentModelerService.listEntries(
          req.params.modelSlug,
          {
            status: "published",
            limit: req.query.limit ? parseInt(req.query.limit, 10) : 20,
            offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
          },
        );
        return reply.send({ data: entries });
      } catch (err) {
        return sendError(
          reply,
          "NOT_FOUND",
          err instanceof Error ? err.message : "Collection not found",
          req.id,
          404,
        );
      }
    },
  });

  fastify.get<{ Params: { modelSlug: string; entrySlug: string } }>(
    "/collections/:modelSlug/:entrySlug",
    {
      handler: async (req, reply) => {
        const entry = await contentModelerService.getEntryById(
          req.params.modelSlug,
          req.params.entrySlug,
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
        return reply.send({ data: entry });
      },
    },
  );
}
