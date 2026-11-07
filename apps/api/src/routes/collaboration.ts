import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import {
  editorialCollaborationService,
  postsService,
  authorsService,
} from "../services";
import { hasResourcePermission } from "@vibress/security";
import { PostStatus, PostDomainError } from "@vibress/posts";
import {
  crdtPersistence,
  CrdtPersistenceError,
  validateYjsUpdateBinary,
} from "../collaboration/crdt-persistence";
import { roomManager } from "../collaboration/room-manager";

const sendError = (
  reply: FastifyReply,
  code: string,
  message: string,
  requestId: string,
  status = 400,
) => reply.status(status).send({ errors: [{ code, message, requestId }] });

async function resolveScopedPost(
  req: FastifyRequest<{ Params: { postId: string } }>,
  reply: FastifyReply,
  options?: { requireResourceEdit?: boolean },
) {
  const publicationId = req.publicationContext?.publicationId || "pub_default";
  const post = await postsService.findById(req.params.postId, publicationId);
  if (!post) {
    sendError(
      reply,
      "POST_NOT_FOUND",
      "Post not found in active publication",
      req.id,
      404,
    );
    return null;
  }

  if (options?.requireResourceEdit) {
    const postAuthors = await authorsService.getPostAuthors(post.id);
    const postAuthorIds = (postAuthors || [])
      .map((a: { id?: string; authorId?: string }) => a?.id || a?.authorId)
      .filter((v): v is string => Boolean(v));
    const allowed = hasResourcePermission("posts.edit", {
      actorId: req.user!.id,
      resourceOwnerId: post.primaryAuthorId,
      resourceAuthorIds: postAuthorIds,
      userRoles: req.roles,
      userPermissions: req.permissions,
      publicationId,
      resourcePublicationId: post.publicationId,
    });
    if (!allowed) {
      sendError(
        reply,
        "FORBIDDEN",
        "Forbidden: You do not have permission to modify another author's post",
        req.id,
        403,
      );
      return null;
    }
  }

  return { post, publicationId };
}

export async function collaborationRoutes(fastify: FastifyInstance) {
  // 1. Comments
  fastify.get<{ Params: { postId: string } }>(
    "/posts/:postId/collaboration/comments",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const scoped = await resolveScopedPost(req, reply);
        if (!scoped) return;
        const comments = await editorialCollaborationService.listComments(
          scoped.post.id,
        );
        return reply.send({ data: comments });
      },
    },
  );

  fastify.post<{
    Params: { postId: string };
    Body: { body: string; blockId?: string };
  }>("/posts/:postId/collaboration/comments", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.edit"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const scoped = await resolveScopedPost(req, reply);
      if (!scoped) return;
      const { body, blockId } = req.body || {};
      if (!body || !body.trim()) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Comment body cannot be empty",
          req.id,
        );
      }

      const comment = await editorialCollaborationService.addComment({
        postId: scoped.post.id,
        authorId: req.user!.id,
        body,
        blockId,
      });

      return reply.status(201).send({ data: comment });
    },
  });

  fastify.post<{ Params: { postId: string; commentId: string } }>(
    "/posts/:postId/collaboration/comments/:commentId/resolve",
    {
      preHandler: [
        requireStaffSession,
        requirePermission("posts.edit"),
        validateOrigin,
      ],
      handler: async (req, reply) => {
        const scoped = await resolveScopedPost(req, reply, {
          requireResourceEdit: true,
        });
        if (!scoped) return;
        await editorialCollaborationService.resolveComment(
          req.params.commentId,
          req.user!.id,
          scoped.post.id,
        );
        return reply.send({ data: { resolved: true } });
      },
    },
  );

  fastify.post<{ Params: { postId: string; commentId: string } }>(
    "/posts/:postId/collaboration/comments/:commentId/reopen",
    {
      preHandler: [
        requireStaffSession,
        requirePermission("posts.edit"),
        validateOrigin,
      ],
      handler: async (req, reply) => {
        const scoped = await resolveScopedPost(req, reply, {
          requireResourceEdit: true,
        });
        if (!scoped) return;
        await editorialCollaborationService.reopenComment(
          req.params.commentId,
          scoped.post.id,
        );
        return reply.send({ data: { reopened: true } });
      },
    },
  );

  // 2. Suggestions / Track Changes
  fastify.get<{ Params: { postId: string } }>(
    "/posts/:postId/collaboration/suggestions",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const scoped = await resolveScopedPost(req, reply);
        if (!scoped) return;
        const suggestions =
          await editorialCollaborationService.listSuggestions(scoped.post.id);
        return reply.send({ data: suggestions });
      },
    },
  );

  fastify.post<{
    Params: { postId: string };
    Body: { originalText: string; suggestedText: string; blockId?: string };
  }>("/posts/:postId/collaboration/suggestions", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.edit"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const scoped = await resolveScopedPost(req, reply);
      if (!scoped) return;
      const { originalText, suggestedText, blockId } = req.body || {};
      if (!originalText || !suggestedText) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Original and suggested text are required",
          req.id,
        );
      }

      const suggestion =
        await editorialCollaborationService.createSuggestion({
          postId: scoped.post.id,
          authorId: req.user!.id,
          originalText,
          suggestedText,
          blockId,
        });

      return reply.status(201).send({ data: suggestion });
    },
  });

  fastify.post<{ Params: { postId: string; suggestionId: string } }>(
    "/posts/:postId/collaboration/suggestions/:suggestionId/accept",
    {
      preHandler: [
        requireStaffSession,
        requirePermission("posts.edit"),
        validateOrigin,
      ],
      handler: async (req, reply) => {
        const scoped = await resolveScopedPost(req, reply, {
          requireResourceEdit: true,
        });
        if (!scoped) return;
        await editorialCollaborationService.reviewSuggestion(
          req.params.suggestionId,
          req.user!.id,
          "accepted",
          scoped.post.id,
        );
        return reply.send({ data: { accepted: true } });
      },
    },
  );

  fastify.post<{ Params: { postId: string; suggestionId: string } }>(
    "/posts/:postId/collaboration/suggestions/:suggestionId/reject",
    {
      preHandler: [
        requireStaffSession,
        requirePermission("posts.edit"),
        validateOrigin,
      ],
      handler: async (req, reply) => {
        const scoped = await resolveScopedPost(req, reply, {
          requireResourceEdit: true,
        });
        if (!scoped) return;
        await editorialCollaborationService.reviewSuggestion(
          req.params.suggestionId,
          req.user!.id,
          "rejected",
          scoped.post.id,
        );
        return reply.send({ data: { rejected: true } });
      },
    },
  );

  // 3. Editorial Assignments
  fastify.get<{ Params: { postId: string } }>(
    "/posts/:postId/collaboration/assignment",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const scoped = await resolveScopedPost(req, reply);
        if (!scoped) return;
        const assignment = await editorialCollaborationService.getAssignment(
          scoped.post.id,
        );
        return reply.send({ data: assignment });
      },
    },
  );

  fastify.put<{
    Params: { postId: string };
    Body: {
      assigneeId?: string | null;
      reviewerIds?: string[];
      dueDate?: string | null;
      editorialNotes?: string | null;
      reviewStatus?: "pending" | "in_review" | "changes_requested" | "approved";
    };
  }>("/posts/:postId/collaboration/assignment", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.edit"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const scoped = await resolveScopedPost(req, reply, {
        requireResourceEdit: true,
      });
      if (!scoped) return;
      const {
        assigneeId,
        reviewerIds,
        dueDate,
        editorialNotes,
        reviewStatus,
      } = req.body || {};

      const assignment = await editorialCollaborationService.updateAssignment({
        postId: scoped.post.id,
        assigneeId: assigneeId ?? null,
        reviewerIds: reviewerIds || [],
        dueDate: dueDate ? new Date(dueDate) : null,
        editorialNotes: editorialNotes ?? null,
        reviewStatus: reviewStatus || "pending",
      });

      return reply.send({ data: assignment });
    },
  });

  // 4. Ephemeral Presence
  fastify.get<{ Params: { postId: string } }>(
    "/posts/:postId/collaboration/presence",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const scoped = await resolveScopedPost(req, reply);
        if (!scoped) return;
        const activeUsers = editorialCollaborationService.getActivePresence(
          scoped.post.id,
          scoped.publicationId,
        );
        return reply.send({ data: activeUsers });
      },
    },
  );

  fastify.post<{
    Params: { postId: string };
    Body: { cursor?: { x: number; y: number; blockId?: string } };
  }>("/posts/:postId/collaboration/presence", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.read"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const scoped = await resolveScopedPost(req, reply);
      if (!scoped) return;
      const activeUsers =
        editorialCollaborationService.recordPresenceHeartbeat(
          scoped.post.id,
          {
            userId: req.user!.id,
            name: req.user!.name || "Staff Member",
            cursor: req.body?.cursor,
          },
          scoped.publicationId,
        );
      return reply.send({ data: activeUsers });
    },
  });

  // 5. Editorial Workflow Transitions
  fastify.post<{
    Params: { postId: string };
    Body: { targetStatus: PostStatus };
  }>("/posts/:postId/workflow/transition", {
    preHandler: [requireStaffSession, validateOrigin],
    handler: async (req, reply) => {
      const scoped = await resolveScopedPost(req, reply);
      if (!scoped) return;
      const { targetStatus } = req.body || {};
      if (!targetStatus) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "targetStatus is required",
          req.id,
        );
      }

      try {
        const postAuthors = await authorsService.getPostAuthors(scoped.post.id);
        const postAuthorIds = (postAuthors || [])
          .map((a: { id?: string; authorId?: string }) => a?.id || a?.authorId)
          .filter((v): v is string => Boolean(v));
        const res = await editorialCollaborationService.transitionWorkflow({
          postId: scoped.post.id,
          publicationId: scoped.publicationId,
          targetStatus,
          actorId: req.user!.id,
          actorRoles: req.roles,
          actorPermissions: req.permissions || [],
          resourceAuthorIds: postAuthorIds,
        });
        return reply.send({ data: res });
      } catch (err) {
        if (err instanceof PostDomainError && err.code === "VALIDATION_ERROR") {
          return sendError(reply, "VALIDATION_ERROR", err.message, req.id, 400);
        }
        return sendError(
          reply,
          "WORKFLOW_ERROR",
          err instanceof Error ? err.message : "Workflow transition failed",
          req.id,
          403,
        );
      }
    },
  });

  // 6. Durable CRDT Document State Exchange
  const MAX_CRDT_UPDATE_BYTES = 64 * 1024; // 64 KB cap
  const MAX_BASE64_LENGTH = Math.ceil((MAX_CRDT_UPDATE_BYTES * 4) / 3) + 4; // ~87,384 characters
  const crdtRateLimitMap = new Map<string, number[]>();
  const CRDT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const CRDT_MAX_UPDATES_PER_WINDOW = 60;
  let crdtRateLimitOps = 0;

  function checkCrdtRateLimit(key: string): boolean {
    const now = Date.now();
    const windowStart = now - CRDT_RATE_LIMIT_WINDOW_MS;
    if (++crdtRateLimitOps >= 200) {
      crdtRateLimitOps = 0;
      for (const [k, ts] of crdtRateLimitMap.entries()) {
        const active = ts.filter((t) => t > windowStart);
        if (active.length === 0) {
          crdtRateLimitMap.delete(k);
        } else if (active.length !== ts.length) {
          crdtRateLimitMap.set(k, active);
        }
      }
    }

    const timestamps = (crdtRateLimitMap.get(key) || []).filter(
      (t) => t > windowStart,
    );

    if (timestamps.length >= CRDT_MAX_UPDATES_PER_WINDOW) {
      if (timestamps.length === 0) {
        crdtRateLimitMap.delete(key);
      } else {
        crdtRateLimitMap.set(key, timestamps);
      }
      return false;
    }

    timestamps.push(now);
    crdtRateLimitMap.set(key, timestamps);
    return true;
  }

  fastify.get<{ Params: { postId: string } }>(
    "/posts/:postId/collaboration/crdt",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const scoped = await resolveScopedPost(req, reply);
        if (!scoped) return;
        const { post, publicationId } = scoped;

        let reconciled;
        try {
          reconciled = await crdtPersistence.reconcileWithDatabase(
            publicationId,
            post.id,
            { version: post.version, content: post.content },
            {
              skipIfRestoreLocked: roomManager.isRestoreLocked(
                publicationId,
                post.id,
              ),
            },
          );
        } catch (err) {
          if (err instanceof CrdtPersistenceError) {
            return sendError(reply, err.code, err.message, req.id, 503);
          }
          throw err;
        }

        const persisted: Uint8Array[] = [];
        if (reconciled.snapshot) {
          persisted.push(reconciled.snapshot);
        }
        persisted.push(...reconciled.updates);

        let updates: Uint8Array[];
        if (persisted.length > 0 || reconciled.epoch >= 2) {
          updates = persisted;
        } else {
          updates = editorialCollaborationService.getYjsDocUpdates(
            post.id,
            publicationId,
          );
        }
        const encodedUpdates = updates.map((u) =>
          Buffer.from(u).toString("base64"),
        );
        return reply.send({
          data: {
            updates: encodedUpdates,
            epoch: reconciled.epoch,
            generationId: reconciled.generationId,
          },
        });
      },
    },
  );

  fastify.post<{
    Params: { postId: string };
    Body: { update: string; epoch?: number; generationId?: string };
  }>("/posts/:postId/collaboration/crdt", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.edit"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { update, epoch: clientEpoch, generationId: clientGenerationId } =
        req.body || {};
      if (!update || typeof update !== "string") {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "update payload is required and must be a valid base64 string",
          req.id,
        );
      }

      const trimmed = update.trim();
      if (trimmed.length > MAX_BASE64_LENGTH) {
        return sendError(
          reply,
          "PAYLOAD_TOO_LARGE",
          "CRDT update payload exceeds maximum permitted size (64 KB)",
          req.id,
          413,
        );
      }

      if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "update payload must be valid base64",
          req.id,
        );
      }

      const publicationId = req.publicationContext!.publicationId;
      const rateLimitKey = `${req.user!.id}:${publicationId}:${req.params.postId}`;
      if (!checkCrdtRateLimit(rateLimitKey)) {
        return sendError(
          reply,
          "RATE_LIMIT_EXCEEDED",
          "Rate limit exceeded: maximum 60 CRDT updates per minute per document.",
          req.id,
          429,
        );
      }

      let updateBuffer: Buffer;
      try {
        updateBuffer = Buffer.from(trimmed, "base64");
      } catch {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Failed to decode base64 CRDT update payload",
          req.id,
        );
      }

      if (updateBuffer.length > MAX_CRDT_UPDATE_BYTES) {
        return sendError(
          reply,
          "PAYLOAD_TOO_LARGE",
          "CRDT update buffer exceeds maximum permitted size (64 KB)",
          req.id,
          413,
        );
      }

      const scoped = await resolveScopedPost(req, reply, {
        requireResourceEdit: true,
      });
      if (!scoped) return;
      const { post } = scoped;

      const room = roomManager.getRoom(publicationId, post.id);
      if (
        roomManager.isRestoreLocked(publicationId, post.id) ||
        crdtPersistence.hasPendingRecovery(publicationId, post.id) ||
        room?.restorationBarrierActive ||
        room?.requiresRecovery
      ) {
        return sendError(
          reply,
          "EPOCH_CONFLICT",
          "Document revision restoration is in progress or requires recovery.",
          req.id,
          409,
        );
      }

      let reconciled;
      try {
        reconciled = await crdtPersistence.reconcileWithDatabase(
          publicationId,
          post.id,
          { version: post.version, content: post.content },
          {
            skipIfRestoreLocked: roomManager.isRestoreLocked(
              publicationId,
              post.id,
            ),
          },
        );
      } catch (err) {
        if (err instanceof CrdtPersistenceError) {
          return sendError(reply, err.code, err.message, req.id, 503);
        }
        throw err;
      }

      if (
        reconciled.restoreState?.status === "IN_PROGRESS" ||
        reconciled.restoreState?.status === "REQUIRES_RECOVERY"
      ) {
        return sendError(
          reply,
          "EPOCH_CONFLICT",
          "Document revision restoration is in progress or requires recovery.",
          req.id,
          409,
        );
      }

      const currentEpoch = room ? Math.max(room.epoch, reconciled.epoch) : reconciled.epoch;
      const currentGenerationId =
        room && room.epoch >= reconciled.epoch
          ? room.generationId
          : reconciled.generationId;

      if (
        currentEpoch >= 2 ||
        clientEpoch !== undefined ||
        clientGenerationId !== undefined
      ) {
        if (
          clientEpoch !== currentEpoch ||
          clientGenerationId !== currentGenerationId
        ) {
          return sendError(
            reply,
            "EPOCH_CONFLICT",
            "CRDT update rejected: epoch or generationId does not match authoritative server generation.",
            req.id,
            409,
          );
        }
      }

      const updateBytes = new Uint8Array(updateBuffer);
      const revokedSet = new Set<number>(reconciled.revokedClientIds);
      if (room) {
        for (const cid of room.revokedClientIds) {
          revokedSet.add(cid);
        }
      }
      const binaryCheck = validateYjsUpdateBinary(updateBytes, revokedSet);
      if (!binaryCheck.valid) {
        if (binaryCheck.code === "MALFORMED") {
          return sendError(
            reply,
            "VALIDATION_ERROR",
            binaryCheck.reason,
            req.id,
            400,
          );
        }
        return sendError(
          reply,
          "EPOCH_CONFLICT",
          binaryCheck.reason,
          req.id,
          409,
        );
      }

      // Do not expose an accepted update through the in-memory service
      // until the authoritative Redis write has completed successfully.
      try {
        if (room) {
          room.hydrateFromDurableState({
          epoch: reconciled.epoch,
          generationId: reconciled.generationId,
          revokedClientIds: reconciled.revokedClientIds,
          snapshot: reconciled.snapshot,
          updates: reconciled.updates,
          restoredContent: reconciled.restoreState?.restoredContent,
            restoreStatus: reconciled.restoreState?.status,
          });
          await room.recordUpdate(updateBytes, {
            epoch: currentEpoch,
            generationId: currentGenerationId,
          });
        } else {
          await crdtPersistence.saveUpdate(publicationId, post.id, updateBytes);
        }
      } catch (err: unknown) {
        if (err instanceof CrdtPersistenceError) {
          return sendError(
            reply,
            err.code,
            err.code === "CRDT_EPOCH_CONFLICT"
              ? "Document generation changed; retry after reconnect."
              : "Collaborative update was not persisted; retry when storage recovers.",
            req.id,
            err.code === "CRDT_EPOCH_CONFLICT" ? 409 : 503,
          );
        }
        throw err;
      }

      editorialCollaborationService.applyYjsDocUpdate(
        post.id,
        updateBytes,
        publicationId,
      );
      if (room) room.broadcastBinary(updateBytes);

      return reply.send({
        data: {
          applied: true,
          epoch: currentEpoch,
          generationId: currentGenerationId,
        },
      });
    },
  });
}
