import { FastifyInstance } from "fastify";
import {
  ListMediaFilterSchema,
  UpdateMediaInputSchema,
} from "@vibress/api-contracts";
import { defaultStorageRegistry } from "@vibress/storage-core";
import { mediaService } from "../services";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import {
  MediaInUseError,
  MediaInvalidFileError,
  MediaMimeMismatchError,
  MediaNotFoundError,
  MediaTooLargeError,
  MediaTypeNotAllowedError,
} from "@vibress/media";
import { errorMessage } from "../helpers/errors";

export async function mediaRoutes(fastify: FastifyInstance) {
  // Upload media asset
  fastify.post("/media", {
    preHandler: [
      requireStaffSession,
      requirePermission("media.upload"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      let fileData;
      try {
        fileData = await req.file();
      } catch (err) {
        return reply.status(400).send({
          errors: [
            {
              code: "MEDIA_UPLOAD_FAILED",
              message: errorMessage(err) || "Failed to parse multipart upload",
              requestId: req.id,
            },
          ],
        });
      }

      if (!fileData) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "No file uploaded in multipart request",
              requestId: req.id,
            },
          ],
        });
      }

      let buffer: Buffer;
      try {
        buffer = await fileData.toBuffer();
      } catch (err) {
        return reply.status(400).send({
          errors: [
            {
              code: "MEDIA_UPLOAD_FAILED",
              message: `Failed to read file buffer: ${errorMessage(err)}`,
              requestId: req.id,
            },
          ],
        });
      }

      const filename = fileData.filename || "unnamed-file";
      const mimeType = fileData.mimetype || "application/octet-stream";

      try {
        const asset = await mediaService.uploadMedia(
          {
            filename,
            mimeType,
            buffer,
          },
          req.user!.id,
        );

        const storageProvider = defaultStorageRegistry.getActiveProvider();
        const url = await storageProvider.getUrl(asset.storageKey);

        return reply.status(201).send({
          media: {
            ...asset,
            url,
          },
        });
      } catch (err) {
        if (err instanceof MediaTooLargeError) {
          return reply.status(413).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        if (
          err instanceof MediaTypeNotAllowedError ||
          err instanceof MediaMimeMismatchError ||
          err instanceof MediaInvalidFileError
        ) {
          return reply.status(422).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        throw err;
      }
    },
  });

  // List media assets
  fastify.get("/media", {
    preHandler: [requireStaffSession, requirePermission("media.read")],
    handler: async (req, reply) => {
      const parseResult = ListMediaFilterSchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                parseResult.error.errors[0]?.message || "Invalid query filters",
              requestId: req.id,
            },
          ],
        });
      }

      const result = await mediaService.listMedia(parseResult.data);
      const storageProvider = defaultStorageRegistry.getActiveProvider();

      const itemsWithUrls = await Promise.all(
        result.items.map(async (item) => {
          const url = await storageProvider.getUrl(item.storageKey);
          return { ...item, url };
        }),
      );

      return reply.status(200).send({
        items: itemsWithUrls,
        total: result.total,
      });
    },
  });

  // Get media asset by ID
  fastify.get("/media/:id", {
    preHandler: [requireStaffSession, requirePermission("media.read")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const asset = await mediaService.getMediaById(id);
        const storageProvider = defaultStorageRegistry.getActiveProvider();
        const url = await storageProvider.getUrl(asset.storageKey);

        return reply.status(200).send({
          media: { ...asset, url },
        });
      } catch (err) {
        if (err instanceof MediaNotFoundError) {
          return reply.status(404).send({
            errors: [
              {
                code: "MEDIA_NOT_FOUND",
                message: err.message,
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Update media asset metadata
  fastify.patch("/media/:id", {
    preHandler: [
      requireStaffSession,
      requirePermission("media.edit"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = UpdateMediaInputSchema.safeParse(req.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: parseResult.error.errors[0]?.message || "Invalid input",
              requestId: req.id,
            },
          ],
        });
      }

      try {
        const updated = await mediaService.updateMediaMetadata(
          id,
          parseResult.data,
          req.user!.id,
        );
        const storageProvider = defaultStorageRegistry.getActiveProvider();
        const url = await storageProvider.getUrl(updated.storageKey);

        return reply.status(200).send({
          media: { ...updated, url },
        });
      } catch (err) {
        if (err instanceof MediaNotFoundError) {
          return reply.status(404).send({
            errors: [
              {
                code: "MEDIA_NOT_FOUND",
                message: err.message,
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Delete media asset
  fastify.delete("/media/:id", {
    preHandler: [
      requireStaffSession,
      requirePermission("media.delete"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        await mediaService.deleteMedia(id, req.user!.id);
        return reply.status(200).send({ success: true });
      } catch (err) {
        if (err instanceof MediaInUseError) {
          const inUse = err as MediaInUseError & { referenceCount?: number };
          return reply.status(409).send({
            errors: [
              {
                code: "MEDIA_IN_USE",
                message: err.message,
                referenceCount: inUse.referenceCount,
                requestId: req.id,
              },
            ],
          });
        }
        if (err instanceof MediaNotFoundError) {
          return reply.status(404).send({
            errors: [
              {
                code: "MEDIA_NOT_FOUND",
                message: err.message,
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Get media references
  fastify.get("/media/:id/references", {
    preHandler: [requireStaffSession, requirePermission("media.read")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const summary = await mediaService.getMediaReferences(id);
        return reply.status(200).send({ summary });
      } catch (err) {
        if (err instanceof MediaNotFoundError) {
          return reply.status(404).send({
            errors: [
              {
                code: "MEDIA_NOT_FOUND",
                message: err.message,
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });
}
