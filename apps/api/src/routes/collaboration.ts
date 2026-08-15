import { FastifyInstance, FastifyReply } from "fastify";
import {
  requireStaffSession,
  requirePermission,
} from "../middleware/auth";
import { editorialCollaborationService } from "../services";
import { PostStatus } from "@vibress/posts";

const sendError = (
  reply: FastifyReply,
  code: string,
  message: string,
  requestId: string,
  status = 400,
) => reply.status(status).send({ errors: [{ code, message, requestId }] });

export async function collaborationRoutes(fastify: FastifyInstance) {
  // 1. Comments
  fastify.get<{ Params: { postId: string } }>(
    "/posts/:postId/collaboration/comments",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const comments = await editorialCollaborationService.listComments(
          req.params.postId,
        );
        return reply.send({ data: comments });
      },
    },
  );

  fastify.post<{
    Params: { postId: string };
    Body: { body: string; blockId?: string };
  }>("/posts/:postId/collaboration/comments", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
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
        postId: req.params.postId,
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
      preHandler: [requireStaffSession, requirePermission("posts.edit")],
      handler: async (req, reply) => {
        await editorialCollaborationService.resolveComment(
          req.params.commentId,
          req.user!.id,
        );
        return reply.send({ data: { resolved: true } });
      },
    },
  );

  fastify.post<{ Params: { postId: string; commentId: string } }>(
    "/posts/:postId/collaboration/comments/:commentId/reopen",
    {
      preHandler: [requireStaffSession, requirePermission("posts.edit")],
      handler: async (req, reply) => {
        await editorialCollaborationService.reopenComment(
          req.params.commentId,
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
        const suggestions =
          await editorialCollaborationService.listSuggestions(
            req.params.postId,
          );
        return reply.send({ data: suggestions });
      },
    },
  );

  fastify.post<{
    Params: { postId: string };
    Body: { originalText: string; suggestedText: string; blockId?: string };
  }>("/posts/:postId/collaboration/suggestions", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
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
          postId: req.params.postId,
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
      preHandler: [requireStaffSession, requirePermission("posts.edit")],
      handler: async (req, reply) => {
        await editorialCollaborationService.reviewSuggestion(
          req.params.suggestionId,
          req.user!.id,
          "accepted",
        );
        return reply.send({ data: { accepted: true } });
      },
    },
  );

  fastify.post<{ Params: { postId: string; suggestionId: string } }>(
    "/posts/:postId/collaboration/suggestions/:suggestionId/reject",
    {
      preHandler: [requireStaffSession, requirePermission("posts.edit")],
      handler: async (req, reply) => {
        await editorialCollaborationService.reviewSuggestion(
          req.params.suggestionId,
          req.user!.id,
          "rejected",
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
        const assignment = await editorialCollaborationService.getAssignment(
          req.params.postId,
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
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      const {
        assigneeId,
        reviewerIds,
        dueDate,
        editorialNotes,
        reviewStatus,
      } = req.body || {};

      const assignment = await editorialCollaborationService.updateAssignment({
        postId: req.params.postId,
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
        const activeUsers = editorialCollaborationService.getActivePresence(
          req.params.postId,
        );
        return reply.send({ data: activeUsers });
      },
    },
  );

  fastify.post<{
    Params: { postId: string };
    Body: { cursor?: { x: number; y: number; blockId?: string } };
  }>("/posts/:postId/collaboration/presence", {
    preHandler: [requireStaffSession, requirePermission("posts.read")],
    handler: async (req, reply) => {
      const activeUsers =
        editorialCollaborationService.recordPresenceHeartbeat(
          req.params.postId,
          {
            userId: req.user!.id,
            name: req.user!.name || "Staff Member",
            cursor: req.body?.cursor,
          },
        );
      return reply.send({ data: activeUsers });
    },
  });

  // 5. Editorial Workflow Transitions
  fastify.post<{
    Params: { postId: string };
    Body: { targetStatus: PostStatus };
  }>("/posts/:postId/workflow/transition", {
    preHandler: [requireStaffSession],
    handler: async (req, reply) => {
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
        const res = await editorialCollaborationService.transitionWorkflow({
          postId: req.params.postId,
          targetStatus,
          actorId: req.user!.id,
          actorPermissions: req.permissions || [],
        });
        return reply.send({ data: res });
      } catch (err) {
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
  fastify.get<{ Params: { postId: string } }>(
    "/posts/:postId/collaboration/crdt",
    {
      preHandler: [requireStaffSession, requirePermission("posts.read")],
      handler: async (req, reply) => {
        const updates = editorialCollaborationService.getYjsDocUpdates(
          req.params.postId,
        );
        const encodedUpdates = updates.map((u) => Buffer.from(u).toString("base64"));
        return reply.send({ data: { updates: encodedUpdates } });
      },
    },
  );

  fastify.post<{
    Params: { postId: string };
    Body: { update: string };
  }>("/posts/:postId/collaboration/crdt", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      const { update } = req.body || {};
      if (!update) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "update payload is required",
          req.id,
        );
      }

      const updateBuffer = Buffer.from(update, "base64");
      editorialCollaborationService.applyYjsDocUpdate(
        req.params.postId,
        new Uint8Array(updateBuffer),
      );

      return reply.send({ data: { applied: true } });
    },
  });
}

