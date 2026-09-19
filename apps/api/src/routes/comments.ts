import { FastifyInstance } from "fastify";
import {
  commentsService,
  subscriptionsService,
  settingsService,
} from "../services";
import {
  CreateCommentSchema,
  UpdateCommentSchema,
  ReportCommentSchema,
  AdminCommentFilterSchema,
  ModerateCommentSchema,
} from "@vibress/api-contracts";
import {
  CommentDomainError,
  Comment,
  ModerationEvent,
  CommentReport,
} from "@vibress/comments";
import {
  requireMemberSession,
  validateMemberOrigin,
} from "../middleware/member-auth";
import {
  requireStaffSession,
  requirePermission,
} from "../middleware/auth";
import { getConfig } from "@vibress/config";
import { getDb } from "@vibress/database";
import { posts, publications } from "@vibress/database";
import { and, eq } from "drizzle-orm";

function publicCommentDto(comment: Comment) {
  return {
    id: comment.id,
    publicationId: comment.publicationId,
    postId: comment.postId,
    memberId: comment.memberId,
    parentId: comment.parentId,
    body: comment.body,
    status: comment.status,
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    depth: comment.depth,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    member: comment.member
      ? {
          id: comment.member.id,
          name: comment.member.name,
          avatarUrl: comment.member.avatarUrl,
        }
      : undefined,
  };
}

function adminCommentDto(comment: Comment) {
  return {
    ...publicCommentDto(comment),
    clientCommentId: comment.clientCommentId,
  };
}

export async function publicCommentRoutes(fastify: FastifyInstance) {
  // Public: List comments for a post
  fastify.get("/posts/:id/comments", async (req, reply) => {
    const { id: postId } = req.params as { id: string };
    const query = req.query as {
      limit?: string;
      offset?: string;
    };

    const limit = Math.min(Math.max(parseInt(query.limit || "50", 10), 1), 100);
    const offset = Math.max(parseInt(query.offset || "0", 10), 0);

    const db = getDb();
    const postRows = await db
      .select({ id: posts.id, publicationId: posts.publicationId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

    if (!postRows[0]) {
      return reply.status(404).send({
        errors: [{ code: "POST_NOT_FOUND", message: "Post not found", requestId: req.id }],
      });
    }

    const publicationId = postRows[0].publicationId;

    const result = await commentsService.listPublicCommentsForPost(
      publicationId,
      postId,
      limit,
      offset,
    );

    return reply.status(200).send({
      comments: result.comments.map(publicCommentDto),
      total: result.total,
      limit,
      offset,
    });
  });

  // Public: Batch comment counts for posts (zero N+1 query)
  fastify.get("/posts/comments/counts", async (req, reply) => {
    const query = req.query as { postIds?: string; publicationId?: string };
    if (!query.postIds) {
      return reply.status(400).send({
        errors: [
          {
            code: "VALIDATION_ERROR",
            message: "postIds query parameter is required (comma-separated)",
            requestId: req.id,
          },
        ],
      });
    }

    const postIds = query.postIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (postIds.length === 0) {
      return reply.status(200).send({ counts: {} });
    }
    if (postIds.length > 100) {
      return reply.status(400).send({
        errors: [
          {
            code: "VALIDATION_ERROR",
            message: "Maximum 100 postIds per batch request",
            requestId: req.id,
          },
        ],
      });
    }

    let publicationId = query.publicationId;
    if (!publicationId) {
      const db = getDb();
      const postRows = await db
        .select({ publicationId: posts.publicationId })
        .from(posts)
        .where(eq(posts.id, postIds[0]!))
        .limit(1);
      publicationId = postRows[0]?.publicationId || "pub_default";
    }

    const countsMap = await commentsService.countCommentsForPosts(publicationId, postIds);
    const counts = Object.fromEntries(countsMap);
    return reply.status(200).send({ counts });
  });
}

export async function memberCommentRoutes(fastify: FastifyInstance) {
  // Member: create comment or reply
  fastify.post("/comments", {
    config: {
      rateLimit: { max: getConfig().isTest ? 100 : 20, timeWindow: "1 minute" },
    },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const parsed = CreateCommentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid comment",
              requestId: req.id,
            },
          ],
        });
      }

      const member = req.member!;
      const publicationId = member.publicationId;

      const publicSettings = await settingsService.getPublicSettings();
      const commentAccess =
        (publicSettings.comments?.commentAccess as string) || "all";
      if (commentAccess === "disabled") {
        return reply.status(403).send({
          errors: [
            {
              code: "COMMENTS_DISABLED",
              message: "Comments are disabled for this publication",
              requestId: req.id,
            },
          ],
        });
      }

      if (commentAccess === "paid") {
        const hasActivePaidSub =
          await subscriptionsService.memberHasActiveSubscription(member.id);
        if (!hasActivePaidSub) {
          return reply.status(403).send({
            errors: [
              {
                code: "PAID_MEMBERS_ONLY",
                message: "Only paid subscribers can participate in comments",
                requestId: req.id,
              },
            ],
          });
        }
      }

      const preModeration = Boolean(publicSettings.comments?.preModeration);

      const db = getDb();
      const postRows = await db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.id, parsed.data.postId),
            eq(posts.publicationId, publicationId),
          ),
        )
        .limit(1);

      if (!postRows[0]) {
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

      try {
        const clientCommentId =
          (req.body as any)?.clientCommentId ||
          (req.headers["x-idempotency-key"] as string) ||
          undefined;

        const comment = await commentsService.createComment({
          ...parsed.data,
          publicationId,
          memberId: member.id,
          clientCommentId,
          status: preModeration ? "pending_review" : "published",
        });
        return reply.status(201).send({ comment: publicCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status = err.code === "COMMENT_NOT_FOUND" ? 404 : 400;
          return reply.status(status).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        req.log.error({ err }, "Unhandled error during comment creation");
        return reply.status(400).send({
          errors: [
            {
              code: "COMMENT_CREATION_FAILED",
              message: "Failed to create comment",
              requestId: req.id,
            },
          ],
        });
      }
    },
  });

  // Member: edit own comment
  fastify.patch("/comments/:id", {
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = UpdateCommentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid comment",
              requestId: req.id,
            },
          ],
        });
      }

      const member = req.member!;
      try {
        const comment = await commentsService.updateComment(
          member.publicationId,
          id,
          member.id,
          parsed.data.body,
        );
        return reply.status(200).send({ comment: publicCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status =
            err.code === "COMMENT_NOT_FOUND"
              ? 404
              : err.code === "FORBIDDEN"
                ? 403
                : 400;
          return reply.status(status).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Member: delete (tombstone) own comment
  fastify.delete("/comments/:id", {
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const member = req.member!;
      try {
        const comment = await commentsService.deleteComment(
          member.publicationId,
          id,
          member.id,
        );
        return reply.status(200).send({ comment: publicCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status =
            err.code === "COMMENT_NOT_FOUND"
              ? 404
              : err.code === "FORBIDDEN"
                ? 403
                : 400;
          return reply.status(status).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Member: toggle like
  fastify.post("/comments/:id/like", {
    config: {
      rateLimit: { max: getConfig().isTest ? 200 : 50, timeWindow: "1 minute" },
    },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const member = req.member!;
      try {
        const result = await commentsService.toggleLike(
          member.publicationId,
          id,
          member.id,
        );
        return reply.status(200).send(result);
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          return reply.status(400).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        req.log.warn({ err }, "Handled concurrent error during toggle like");
        return reply.status(200).send({ liked: true });
      }
    },
  });

  // Member: report comment
  fastify.post("/comments/:id/report", {
    config: {
      rateLimit: { max: getConfig().isTest ? 50 : 10, timeWindow: "1 minute" },
    },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = ReportCommentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid report",
              requestId: req.id,
            },
          ],
        });
      }

      const member = req.member!;
      try {
        const report = await commentsService.reportComment(
          member.publicationId,
          id,
          member.id,
          parsed.data.reason,
        );
        return reply.status(201).send(report);
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          return reply.status(400).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        throw err;
      }
    },
  });
}

export async function adminCommentRoutes(fastify: FastifyInstance) {
  // Admin: list comments for moderation (requires comments.read)
  fastify.get("/comments", {
    preHandler: [requireStaffSession, requirePermission("comments.read")],
    handler: async (req, reply) => {
      const parsed = AdminCommentFilterSchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid filter parameters",
              requestId: req.id,
            },
          ],
        });
      }

      const publicationId =
        (req.query as any)?.publicationId ||
        (req as any).user?.publicationId ||
        "pub_default";

      const limit = parsed.data.limit || 50;
      const offset = parsed.data.offset || 0;

      const result = await commentsService.listCommentsForModeration({
        publicationId,
        postId: parsed.data.postId,
        status: parsed.data.status,
        limit,
        offset,
      });

      return reply.status(200).send({
        comments: result.comments.map(adminCommentDto),
        total: result.total,
        limit,
        offset,
      });
    },
  });

  // Admin: approve comment
  fastify.post("/comments/:id/approve", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const staffUser = (req as any).user!;
      const publicationId =
        (req.query as any)?.publicationId ||
        (req.headers["x-publication-id"] as string) ||
        staffUser.publicationId ||
        "pub_default";

      const parsed = ModerateCommentSchema.safeParse(req.body || {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      try {
        const comment = await commentsService.moderateComment({
          publicationId,
          commentId: id,
          actorId: staffUser.id,
          action: "approve",
          reason,
        });
        return reply.status(200).send({ comment: adminCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status = err.code === "COMMENT_NOT_FOUND" ? 404 : 400;
          return reply.status(status).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Admin: reject comment
  fastify.post("/comments/:id/reject", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const staffUser = (req as any).user!;
      const publicationId =
        (req.query as any)?.publicationId ||
        (req.headers["x-publication-id"] as string) ||
        staffUser.publicationId ||
        "pub_default";

      const parsed = ModerateCommentSchema.safeParse(req.body || {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      try {
        const comment = await commentsService.moderateComment({
          publicationId,
          commentId: id,
          actorId: staffUser.id,
          action: "reject",
          reason,
        });
        return reply.status(200).send({ comment: adminCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status = err.code === "COMMENT_NOT_FOUND" ? 404 : 400;
          return reply.status(status).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Admin: hide comment
  fastify.post("/comments/:id/hide", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const staffUser = (req as any).user!;
      const publicationId =
        (req.query as any)?.publicationId ||
        (req.headers["x-publication-id"] as string) ||
        staffUser.publicationId ||
        "pub_default";

      const parsed = ModerateCommentSchema.safeParse(req.body || {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      try {
        const comment = await commentsService.moderateComment({
          publicationId,
          commentId: id,
          actorId: staffUser.id,
          action: "hide",
          reason,
        });
        return reply.status(200).send({ comment: adminCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status = err.code === "COMMENT_NOT_FOUND" ? 404 : 400;
          return reply.status(status).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Admin: restore comment
  fastify.post("/comments/:id/restore", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const staffUser = (req as any).user!;
      const publicationId =
        (req.query as any)?.publicationId ||
        (req.headers["x-publication-id"] as string) ||
        staffUser.publicationId ||
        "pub_default";

      const parsed = ModerateCommentSchema.safeParse(req.body || {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      try {
        const comment = await commentsService.moderateComment({
          publicationId,
          commentId: id,
          actorId: staffUser.id,
          action: "restore",
          reason,
        });
        return reply.status(200).send({ comment: adminCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status = err.code === "COMMENT_NOT_FOUND" ? 404 : 400;
          return reply.status(status).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Admin: delete comment
  fastify.delete("/comments/:id", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const staffUser = (req as any).user!;
      const publicationId =
        (req.query as any)?.publicationId ||
        (req.headers["x-publication-id"] as string) ||
        staffUser.publicationId ||
        "pub_default";

      const parsed = ModerateCommentSchema.safeParse(req.body || {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      try {
        const comment = await commentsService.moderateComment({
          publicationId,
          commentId: id,
          actorId: staffUser.id,
          action: "soft_delete",
          reason,
        });
        return reply.status(200).send({ comment: adminCommentDto(comment) });
      } catch (err: unknown) {
        if (err instanceof CommentDomainError) {
          const status = err.code === "COMMENT_NOT_FOUND" ? 404 : 400;
          return reply.status(status).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Admin: moderation history
  fastify.get("/comments/:id/history", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const staffUser = (req as any).user!;
      const publicationId =
        (req.query as any)?.publicationId ||
        (req.headers["x-publication-id"] as string) ||
        staffUser.publicationId ||
        "pub_default";

      const history = await commentsService.listModerationEvents(
        publicationId,
        id,
      );
      return reply.status(200).send({ history });
    },
  });

  // Admin: list reports handler
  const listReportsHandler = async (req: any, reply: any) => {
    const staffUser = (req as any).user!;
    const publicationId =
      (req.query as any)?.publicationId ||
      staffUser.publicationId ||
      "pub_default";

    const query = req.query as {
      status?: string;
      limit?: string;
      offset?: string;
    };
    const limit = Math.min(
      Math.max(parseInt(query.limit || "50", 10), 1),
      100,
    );
    const offset = Math.max(parseInt(query.offset || "0", 10), 0);

    const result = await commentsService.listReports({
      publicationId,
      status: query.status,
      limit,
      offset,
    });

    return reply.status(200).send({
      reports: result.reports,
      total: result.total,
      limit,
      offset,
    });
  };

  // Support both /comment-reports and /comments/reports
  fastify.get("/comment-reports", {
    preHandler: [requireStaffSession, requirePermission("comments.read")],
    handler: listReportsHandler,
  });
  fastify.get("/comments/reports", {
    preHandler: [requireStaffSession, requirePermission("comments.read")],
    handler: listReportsHandler,
  });

  // Admin: resolve report handler
  const resolveReportHandler = async (req: any, reply: any) => {
    const { id } = req.params as { id: string };
    const staffUser = (req as any).user!;
    const publicationId =
      (req.query as any)?.publicationId ||
      staffUser.publicationId ||
      "pub_default";

    const bodyAction = (req.body as any)?.action || "resolved";

    try {
      await commentsService.resolveReport(
        publicationId,
        id,
        bodyAction,
        staffUser.id,
      );
      return reply.status(200).send({ success: true, id });
    } catch (err: unknown) {
      if (err instanceof CommentDomainError) {
        return reply.status(404).send({
          errors: [
            { code: err.code, message: err.message, requestId: req.id },
          ],
        });
      }
      throw err;
    }
  };

  fastify.post("/comment-reports/:id/resolve", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: resolveReportHandler,
  });
  fastify.post("/comments/reports/:id/resolve", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: resolveReportHandler,
  });

  // Admin: dismiss report handler
  const dismissReportHandler = async (req: any, reply: any) => {
    const { id } = req.params as { id: string };
    const staffUser = (req as any).user!;
    const publicationId =
      (req.query as any)?.publicationId ||
      staffUser.publicationId ||
      "pub_default";

    try {
      await commentsService.resolveReport(
        publicationId,
        id,
        "dismissed",
        staffUser.id,
      );
      return reply.status(200).send({ success: true, id });
    } catch (err: unknown) {
      if (err instanceof CommentDomainError) {
        return reply.status(404).send({
          errors: [
            { code: err.code, message: err.message, requestId: req.id },
          ],
        });
      }
      throw err;
    }
  };

  fastify.post("/comment-reports/:id/dismiss", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: dismissReportHandler,
  });
  fastify.post("/comments/reports/:id/dismiss", {
    preHandler: [requireStaffSession, requirePermission("comments.moderate")],
    handler: dismissReportHandler,
  });
}

export const adminCommentModerationRoutes = adminCommentRoutes;
