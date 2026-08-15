import { FastifyInstance } from "fastify";
import { notificationsService } from "../services";
import {
  requireMemberSession,
  validateMemberOrigin,
} from "../middleware/member-auth";

export async function memberNotificationRoutes(fastify: FastifyInstance) {
  // List own notifications
  fastify.get("/notifications", {
    preHandler: [requireMemberSession],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as {
        unread?: string;
        limit?: string;
        offset?: string;
      };
      const result = await notificationsService.listNotifications({
        recipientId: req.member!.id,
        unreadOnly: query.unread === "true",
        limit: query.limit ? parseInt(query.limit, 10) : 20,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      });
      return reply.status(200).send({
        notifications: result.notifications.map((n) => ({
          id: n.id,
          type: n.type,
          actorMemberId: n.actorMemberId,
          entityType: n.entityType,
          entityId: n.entityId,
          data: n.data,
          readAt: n.readAt ? n.readAt.toISOString() : null,
          createdAt: n.createdAt.toISOString(),
        })),
        total: result.total,
      });
    },
  });

  // Unread count
  fastify.get("/notifications/unread-count", {
    preHandler: [requireMemberSession],
    handler: async (req, reply) => {
      const count = await notificationsService.countUnread(req.member!.id);
      return reply.status(200).send({ count });
    },
  });

  // Mark one notification read
  fastify.post("/notifications/:id/read", {
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      // Member isolation: markRead is scoped to recipientId
      await notificationsService.markRead(id, req.member!.id);
      return reply.status(200).send({ success: true });
    },
  });

  // Mark all notifications read
  fastify.post("/notifications/read-all", {
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      await notificationsService.markAllRead(req.member!.id);
      return reply.status(200).send({ success: true });
    },
  });
}
