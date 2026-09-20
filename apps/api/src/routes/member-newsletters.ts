import { FastifyInstance } from "fastify";
import {
  requireMemberSession,
  validateMemberOrigin,
} from "../middleware/member-auth";
import { newslettersService } from "../services";
import { MemberPreferencesUpdateSchema } from "@vibress/api-contracts";
import { NewsletterDomainError } from "@vibress/newsletters";

export async function memberNewsletterRoutes(fastify: FastifyInstance) {
  // List member's newsletter preferences
  fastify.get("/newsletter-preferences", {
    preHandler: [requireMemberSession],
    handler: async (req, reply) => {
      const preferences = await newslettersService.listPreferencesForMember(
        req.member!.id,
        req.member!.publicationId,
      );
      return reply.status(200).send({ preferences });
    },
  });

  // Update a single preference (subscribe/unsubscribe)
  fastify.put("/newsletter-preferences", {
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const parsed = MemberPreferencesUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "Invalid payload",
                requestId: req.id,
              },
            ],
          });
      }
      try {
        const preference = await newslettersService.setSubscription(
          req.member!.id,
          parsed.data.newsletterId,
          parsed.data.subscribed,
        );
        return reply.status(200).send({ preference });
      } catch (err) {
        if (err instanceof NewsletterDomainError) {
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
    },
  });
}

export async function publicUnsubscribeRoutes(fastify: FastifyInstance) {
  // Public, token-authenticated unsubscribe (no member login required)
  fastify.post("/unsubscribe", {
    handler: async (req, reply) => {
      const body = (req.body || {}) as { token?: string };
      if (!body.token || typeof body.token !== "string") {
        return reply
          .status(400)
          .send({
            errors: [
              {
                code: "INVALID_UNSUBSCRIBE_TOKEN",
                message: "Invalid unsubscribe token",
                requestId: req.id,
              },
            ],
          });
      }
      try {
        const result = await newslettersService.unsubscribeWithToken(
          body.token,
        );
        return reply
          .status(200)
          .send({ unsubscribed: true, newsletterId: result.newsletterId });
      } catch (err) {
        if (
          err instanceof NewsletterDomainError &&
          err.code === "INVALID_UNSUBSCRIBE_TOKEN"
        ) {
          return reply
            .status(400)
            .send({
              errors: [
                { code: err.code, message: err.message, requestId: req.id },
              ],
            });
        }
        throw err;
      }
    },
  });

  // Public, token-authenticated double opt-in confirmation (POST)
  fastify.post("/newsletters/confirm", {
    handler: async (req, reply) => {
      const body = (req.body || {}) as { token?: string };
      if (!body.token || typeof body.token !== "string") {
        return reply
          .status(400)
          .send({
            errors: [
              {
                code: "INVALID_OPTIN_TOKEN",
                message: "Invalid or missing confirmation token",
                requestId: req.id,
              },
            ],
          });
      }
      try {
        const result = await newslettersService.confirmSubscription(body.token);
        return reply.status(200).send({
          confirmed: true,
          memberId: result.memberId,
          newsletterId: result.newsletterId,
        });
      } catch (err) {
        if (err instanceof NewsletterDomainError) {
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

  // Public GET convenience endpoint for email links (safely confirms and renders/redirects)
  fastify.get("/newsletters/confirm", {
    handler: async (req, reply) => {
      const query = req.query as { token?: string };
      if (!query.token || typeof query.token !== "string") {
        return reply.status(400).send({
          errors: [
            {
              code: "INVALID_OPTIN_TOKEN",
              message: "Invalid or missing confirmation token",
              requestId: req.id,
            },
          ],
        });
      }
      try {
        const result = await newslettersService.confirmSubscription(query.token);
        return reply.status(200).send({
          confirmed: true,
          memberId: result.memberId,
          newsletterId: result.newsletterId,
          message: "Subscription confirmed successfully",
        });
      } catch (err) {
        if (err instanceof NewsletterDomainError) {
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
