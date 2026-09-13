import { FastifyInstance } from "fastify";
import { whatsNewService } from "../services";
import { requireStaffSession } from "../middleware/auth";
import { appLogger } from "../observability";

export async function whatsNewRoutes(fastify: FastifyInstance) {
  // GET /api/admin/v1/whats-new
  fastify.get("/whats-new", {
    preHandler: [requireStaffSession],
    handler: async (req, reply) => {
      try {
        const userId = req.user!.id;
        const result = await whatsNewService.getEligibleItemForUser(userId);
        return reply.status(200).send(result);
      } catch (err) {
        appLogger.error(
          "whats_new.get_failed",
          { requestId: req.id, userId: req.user?.id },
          err as Error,
        );
        // Fail silently without breaking Admin: return empty state
        return reply.status(200).send({
          item: null,
          items: [],
          dismissedIds: [],
          version: "1.0.0",
        });
      }
    },
  });

  // POST /api/admin/v1/whats-new/:id/dismiss
  fastify.post("/whats-new/:id/dismiss", {
    preHandler: [requireStaffSession],
    handler: async (req, reply) => {
      const params = req.params as { id?: string } | undefined;
      const notificationId = params?.id?.trim();

      if (!notificationId) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Notification ID is required",
              requestId: req.id,
            },
          ],
        });
      }

      try {
        const userId = req.user!.id;
        const updatedDismissedIds = await whatsNewService.dismissForUser(
          userId,
          notificationId,
        );

        return reply.status(200).send({
          success: true,
          dismissedIds: updatedDismissedIds,
        });
      } catch (err) {
        appLogger.error(
          "whats_new.dismiss_route_failed",
          { requestId: req.id, userId: req.user?.id, notificationId },
          err as Error,
        );
        return reply.status(500).send({
          errors: [
            {
              code: "INTERNAL_ERROR",
              message: "Failed to persist notification dismissal",
              requestId: req.id,
            },
          ],
        });
      }
    },
  });
}
