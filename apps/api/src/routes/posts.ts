import { FastifyInstance } from "fastify";
import {
  CreatePostInputSchema,
  UpdatePostInputSchema,
  SchedulePostInputSchema,
  PatchPostFeatureImageInputSchema,
} from "@vibress/api-contracts";
import { postsService, authorsService, revisionsService, mediaService } from "../services";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import { PostDomainError, ListPostsFilter } from "@vibress/posts";
import { crdtPersistence } from "../collaboration/crdt-persistence";

async function resolvePostFeatureImage(
  featureImageId: string | null,
  publicationId?: string,
) {
  if (!featureImageId) return null;
  try {
    const asset = await mediaService.getMediaById(featureImageId, publicationId);
    const unsplashHotlinkUrl = (asset.metadata as any)?.unsplash?.urls?.regular;
    const url = unsplashHotlinkUrl || (await mediaService.getMediaUrl(asset));
    return {
      id: asset.id,
      url,
      storageProvider: asset.storageProvider,
      storageKey: asset.storageKey,
      originalFilename: asset.originalFilename,
      displayName: asset.displayName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      metadata: asset.metadata,
    };
  } catch {
    return null;
  }
}

export async function postRoutes(fastify: FastifyInstance) {
  // List posts
  fastify.get("/posts", {
    preHandler: [requireStaffSession, requirePermission("posts.read")],
    handler: async (req, reply) => {
      const { status, authorId, search, limit, offset, sortBy, sortOrder } =
        (req.query ?? {}) as {
          status?: string;
          authorId?: string;
          search?: string;
          limit?: string;
          offset?: string;
          sortBy?: string;
          sortOrder?: string;
        };
      const params: ListPostsFilter = {
        publicationId: req.publicationContext?.publicationId,
      };
      if (status) params.status = status as ListPostsFilter["status"];
      if (authorId) params.authorId = authorId;
      if (search) params.search = search;
      if (limit) params.limit = parseInt(limit, 10);
      if (offset) params.offset = parseInt(offset, 10);
      if (sortBy) params.sortBy = sortBy as ListPostsFilter["sortBy"];
      if (sortOrder)
        params.sortOrder = sortOrder as ListPostsFilter["sortOrder"];
      const result = await postsService.listPosts(params);

      const postsWithDetails = await Promise.all(
        result.posts.map(async (p) => {
          const authors = await authorsService.getPostAuthors(p.id);
          const tagIds = await postsService.getPostTagIds(p.id);
          return { ...p, authors, tagIds };
        }),
      );

      return reply.status(200).send({
        posts: postsWithDetails,
        total: result.total,
      });
    },
  });

  // Get post by ID
  fastify.get("/posts/:id", {
    preHandler: [requireStaffSession, requirePermission("posts.read")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const post = await postsService.findById(
        id,
        req.publicationContext?.publicationId,
      );
      if (!post) {
        return reply.status(404).send({
          errors: [
            {
              code: "POST_NOT_FOUND",
              message: "Post not found",
              requestId: req.id,
            },
          ],
        });
      }

      const authors = await authorsService.getPostAuthors(id);
      const tagIds = await postsService.getPostTagIds(id);
      const featureImage = await resolvePostFeatureImage(
        post.featureImageId,
        req.publicationContext?.publicationId,
      );

      return reply.status(200).send({
        post: { ...post, authors, tagIds, featureImage },
      });
    },
  });

  // Create post
  fastify.post("/posts", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.create"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const parseResult = CreatePostInputSchema.safeParse(req.body);
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

      const post = await postsService.createPost(
        {
          ...parseResult.data,
          publicationId: req.publicationContext?.publicationId,
          scheduledAt: parseResult.data.scheduledAt
            ? new Date(parseResult.data.scheduledAt)
            : null,
        },
        req.user!.id,
      );

      const authors = await authorsService.getPostAuthors(post.id);
      const tagIds = await postsService.getPostTagIds(post.id);

      return reply.status(201).send({
        post: { ...post, authors, tagIds },
      });
    },
  });

  // Update post
  fastify.put("/posts/:id", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.edit"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = UpdatePostInputSchema.safeParse(req.body);
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

      const incomingChildren = (parseResult.data.content as any)?.root?.children?.length ?? -1;
      console.log(`[FORENSIC] API_RECEIVED postId=${id} expectedVersion=${parseResult.data.expectedVersion} incomingChildren=${incomingChildren}`);

      try {
        const post = await postsService.updatePost(
          id,
          parseResult.data,
          {
            userId: req.user!.id,
            roles: req.roles,
            permissions: req.permissions,
            publicationId: req.publicationContext?.publicationId,
          },
        );
        const persistedChildren = (post.content as any)?.root?.children?.length ?? -1;
        console.log(`[FORENSIC] DB_PERSISTED postId=${id} newVersion=${post.version} persistedChildren=${persistedChildren}`);

        // Authoritative REST update resets any stale/partial CRDT buffer in Redis
        try {
          await crdtPersistence.clear(
            req.publicationContext?.publicationId || "pub_default",
            id,
          );
        } catch {
          // Non-blocking cache clear
        }

        const authors = await authorsService.getPostAuthors(post.id);
        const tagIds = await postsService.getPostTagIds(post.id);
        const featureImage = await resolvePostFeatureImage(
          post.featureImageId,
          req.publicationContext?.publicationId,
        );

        return reply.status(200).send({
          post: { ...post, authors, tagIds, featureImage },
        });
      } catch (err: unknown) {

        if (err instanceof PostDomainError) {
          if (err.code === "FORBIDDEN") {
            return reply.status(403).send({
              errors: [
                {
                  code: "FORBIDDEN",
                  message: err.message,
                  requestId: req.id,
                },
              ],
            });
          }
          if (err.code === "CONTENT_CONFLICT") {
            return reply.status(409).send({
              errors: [
                {
                  code: "CONTENT_CONFLICT",
                  message: err.message,
                  requestId: req.id,
                },
              ],
            });
          }
          if (err.code === "POST_NOT_FOUND") {
            return reply.status(404).send({
              errors: [
                {
                  code: "POST_NOT_FOUND",
                  message: "Post not found",
                  requestId: req.id,
                },
              ],
            });
          }
        }
        throw err;
      }
    },
  });

  // Patch feature image (metadata only — does NOT touch content, Yjs, CRDT, or increment content version)
  fastify.patch("/posts/:id/feature-image", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.edit"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = PatchPostFeatureImageInputSchema.safeParse(req.body);
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
        const post = await postsService.patchFeatureImage(
          id,
          {
            featureImageId: parseResult.data.featureImageId ?? null,
            ...(parseResult.data.featureImageAlt !== undefined
              ? { featureImageAlt: parseResult.data.featureImageAlt }
              : {}),
            ...(parseResult.data.featureImageCaption !== undefined
              ? { featureImageCaption: parseResult.data.featureImageCaption }
              : {}),
          },
          {
            userId: req.user!.id,
            roles: req.roles,
            permissions: req.permissions,
            publicationId: req.publicationContext?.publicationId,
          },
        );

        const authors = await authorsService.getPostAuthors(post.id);
        const tagIds = await postsService.getPostTagIds(post.id);
        const featureImage = await resolvePostFeatureImage(
          post.featureImageId,
          req.publicationContext?.publicationId,
        );

        return reply.status(200).send({
          post: { ...post, authors, tagIds, featureImage },
        });
      } catch (err: unknown) {
        if (err instanceof PostDomainError) {
          if (err.code === "FORBIDDEN") {
            return reply.status(403).send({
              errors: [
                {
                  code: "FORBIDDEN",
                  message: err.message,
                  requestId: req.id,
                },
              ],
            });
          }
          if (err.code === "INVALID_FEATURE_IMAGE") {
            return reply.status(400).send({
              errors: [
                {
                  code: "INVALID_FEATURE_IMAGE",
                  message: err.message,
                  requestId: req.id,
                },
              ],
            });
          }
          if (err.code === "POST_NOT_FOUND") {
            return reply.status(404).send({
              errors: [
                {
                  code: "POST_NOT_FOUND",
                  message: "Post not found",
                  requestId: req.id,
                },
              ],
            });
          }
        }
        throw err;
      }
    },
  });

  // Delete post
  fastify.delete("/posts/:id", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.delete"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        await postsService.deletePost(id, {
          userId: req.user!.id,
          roles: req.roles,
          permissions: req.permissions,
          publicationId: req.publicationContext?.publicationId,
        });
        return reply.status(200).send({ success: true });
      } catch (err: unknown) {
        if (err instanceof PostDomainError) {
          if (err.code === "FORBIDDEN") {
            return reply.status(403).send({
              errors: [
                {
                  code: "FORBIDDEN",
                  message: err.message,
                  requestId: req.id,
                },
              ],
            });
          }
          if (err.code === "POST_NOT_FOUND") {
            return reply.status(404).send({
              errors: [
                {
                  code: "POST_NOT_FOUND",
                  message: "Post not found",
                  requestId: req.id,
                },
              ],
            });
          }
        }
        throw err;
      }
    },
  });

  // Publish post
  fastify.post("/posts/:id/publish", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.publish"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const post = await postsService.publishPost(
          id,
          req.user!.id,
          req.publicationContext?.publicationId,
        );
        return reply.status(200).send({ post });
      } catch (err: unknown) {
        if (err instanceof PostDomainError) {
          if (err.code === "POST_NOT_FOUND") {
            return reply.status(404).send({
              errors: [
                {
                  code: "POST_NOT_FOUND",
                  message: "Post not found",
                  requestId: req.id,
                },
              ],
            });
          }
          if (err.code === "VALIDATION_ERROR") {
            return reply.status(400).send({
              errors: [
                {
                  code: "VALIDATION_ERROR",
                  message: err.message,
                  requestId: req.id,
                },
              ],
            });
          }
        }
        throw err;
      }
    },
  });

  // Unpublish post
  fastify.post("/posts/:id/unpublish", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.publish"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const post = await postsService.unpublishPost(
          id,
          req.user!.id,
          req.publicationContext?.publicationId,
        );
        return reply.status(200).send({ post });
      } catch (err: unknown) {
        if (err instanceof PostDomainError && err.code === "POST_NOT_FOUND") {
          return reply.status(404).send({
            errors: [
              {
                code: "POST_NOT_FOUND",
                message: "Post not found",
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Schedule post
  fastify.post("/posts/:id/schedule", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.publish"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = SchedulePostInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                parseResult.error.errors[0]?.message ||
                "Invalid schedule timestamp",
              requestId: req.id,
            },
          ],
        });
      }

      try {
        const scheduledAt = new Date(parseResult.data.scheduledAt);
        const post = await postsService.schedulePost(
          id,
          scheduledAt,
          req.user!.id,
          req.publicationContext?.publicationId,
        );
        return reply.status(200).send({ post });
      } catch (err: unknown) {
        if (err instanceof PostDomainError) {
          if (err.code === "INVALID_SCHEDULE_TIME") {
            return reply.status(400).send({
              errors: [
                {
                  code: "INVALID_SCHEDULE_TIME",
                  message: err.message,
                  requestId: req.id,
                },
              ],
            });
          }
          if (err.code === "POST_NOT_FOUND") {
            return reply.status(404).send({
              errors: [
                {
                  code: "POST_NOT_FOUND",
                  message: "Post not found",
                  requestId: req.id,
                },
              ],
            });
          }
        }
        throw err;
      }
    },
  });

  // Cancel post schedule
  fastify.post("/posts/:id/cancel-schedule", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.publish"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const post = await postsService.cancelSchedule(
          id,
          req.user!.id,
          req.publicationContext?.publicationId,
        );
        return reply.status(200).send({ post });
      } catch (err: unknown) {
        if (err instanceof PostDomainError && err.code === "POST_NOT_FOUND") {
          return reply.status(404).send({
            errors: [
              {
                code: "POST_NOT_FOUND",
                message: "Post not found",
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Get post revisions
  fastify.get("/posts/:id/revisions", {
    preHandler: [requireStaffSession, requirePermission("posts.read")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const post = await postsService.findById(
        id,
        req.publicationContext?.publicationId,
      );
      if (!post) {
        return reply.status(404).send({
          errors: [
            {
              code: "POST_NOT_FOUND",
              message: "Post not found",
              requestId: req.id,
            },
          ],
        });
      }

      const revisions = await revisionsService.getRevisions("post", id);
      return reply.status(200).send({ revisions });
    },
  });

  // Restore post revision
  fastify.post("/posts/:id/revisions/:revisionId/restore", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.edit"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id, revisionId } = req.params as {
        id: string;
        revisionId: string;
      };
      try {
        const post = await postsService.restoreRevision(
          id,
          revisionId,
          {
            userId: req.user!.id,
            roles: req.roles,
            permissions: req.permissions,
            publicationId: req.publicationContext?.publicationId,
          },
        );
        return reply.status(200).send({ post });
      } catch (err: unknown) {
        if (err instanceof PostDomainError) {
          if (err.code === "FORBIDDEN") {
            return reply.status(403).send({
              errors: [
                {
                  code: "FORBIDDEN",
                  message: err.message,
                  requestId: req.id,
                },
              ],
            });
          }
          if (err.code === "POST_NOT_FOUND") {
            return reply.status(404).send({
              errors: [
                {
                  code: "POST_NOT_FOUND",
                  message: "Post not found",
                  requestId: req.id,
                },
              ],
            });
          }
          if (err.code === "REVISION_NOT_FOUND") {
            return reply.status(404).send({
              errors: [
                {
                  code: "REVISION_NOT_FOUND",
                  message: "Revision not found",
                  requestId: req.id,
                },
              ],
            });
          }
        }
        throw err;
      }
    },
  });
}
