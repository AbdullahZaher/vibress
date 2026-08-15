import { FastifyInstance } from "fastify";
import {
  MemberAuthRequestSchema,
  MemberProfileUpdateSchema,
} from "@vibress/api-contracts";
import { memberAuthService, membersService } from "../services";
import {
  requireMemberSession,
  validateMemberOrigin,
  MEMBER_COOKIE_NAME,
  extractMemberSessionToken,
} from "../middleware/member-auth";
import { MemberAuthError } from "@vibress/members";
import { getConfig } from "@vibress/config";
import { appLogger } from "../observability";

export async function memberRoutes(fastify: FastifyInstance) {
  // Request sign-in link (enumeration-safe; unified signup/login)
  fastify.post("/auth/request", {
    config: {
      rateLimit: {
        max: getConfig().isProduction ? 10 : 200,
        timeWindow: "1 minute",
      },
    },
    preHandler: [validateMemberOrigin],
    handler: async (req, reply) => {
      const parseResult = MemberAuthRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        // Same generic shape for invalid email as for unknown member
        return reply.status(200).send({
          message:
            "If this email can receive a sign-in link, we have sent one.",
        });
      }

      const { email } = parseResult.data;

      try {
        await memberAuthService.requestAuthLink(email, {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] || null,
          requestId: req.id,
        });
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "MAIL_DELIVERY_FAILED") {
          appLogger.warn("Member auth mail delivery failed", {
            requestId: req.id,
            code,
          });
          // Do not leak token state; keep generic response but log failure.
          return reply.status(200).send({
            message:
              "If this email can receive a sign-in link, we have sent one.",
          });
        }
        appLogger.error("Member auth request failed", {
          requestId: req.id,
          code,
        });
        return reply.status(200).send({
          message:
            "If this email can receive a sign-in link, we have sent one.",
        });
      }

      return reply.status(200).send({
        message: "If this email can receive a sign-in link, we have sent one.",
      });
    },
  });

  // Verify magic link token → create member session
  fastify.post("/auth/verify", {
    config: {
      rateLimit: {
        max: getConfig().isTest ? 200 : 20,
        timeWindow: "1 minute",
      },
    },
    preHandler: [validateMemberOrigin],
    handler: async (req, reply) => {
      const { token } = (req.body || {}) as { token?: string };
      if (!token || typeof token !== "string") {
        return reply.status(400).send({
          errors: [
            {
              code: "AUTH_TOKEN_INVALID",
              message: "Invalid or missing token",
              requestId: req.id,
            },
          ],
        });
      }

      try {
        const result = await memberAuthService.verifyAndCreateSession(token, {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] || null,
          requestId: req.id,
        });

        const isProduction = getConfig().isProduction;
        reply.setCookie(MEMBER_COOKIE_NAME, result.sessionToken, {
          path: "/",
          httpOnly: true,
          secure: isProduction,
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });

        return reply.status(200).send({
          member: {
            id: result.member.id,
            email: result.member.email,
            name: result.member.name || null,
            emailVerified: !!result.member.emailVerifiedAt,
            createdAt: result.member.createdAt.toISOString(),
          },
        });
      } catch (err: unknown) {
        if (err instanceof MemberAuthError) {
          const status = err.code === "MEMBER_DISABLED" ? 401 : 400;
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

  // GET verify (browser navigation convenience) — verifies and sets cookie, returns member
  fastify.get("/auth/verify", {
    config: {
      rateLimit: {
        max: getConfig().isTest ? 200 : 20,
        timeWindow: "1 minute",
      },
    },
    handler: async (req, reply) => {
      const { token } = req.query as { token?: string };
      if (!token || typeof token !== "string") {
        return reply.status(400).send({
          errors: [
            {
              code: "AUTH_TOKEN_INVALID",
              message: "Invalid or missing token",
              requestId: req.id,
            },
          ],
        });
      }

      try {
        const result = await memberAuthService.verifyAndCreateSession(token, {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] || null,
          requestId: req.id,
        });

        const isProduction = getConfig().isProduction;
        reply.setCookie(MEMBER_COOKIE_NAME, result.sessionToken, {
          path: "/",
          httpOnly: true,
          secure: isProduction,
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60,
        });

        return reply.status(200).send({
          member: {
            id: result.member.id,
            email: result.member.email,
            name: result.member.name || null,
            emailVerified: !!result.member.emailVerifiedAt,
            createdAt: result.member.createdAt.toISOString(),
          },
        });
      } catch (err: unknown) {
        if (err instanceof MemberAuthError) {
          const status = err.code === "MEMBER_DISABLED" ? 401 : 400;
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

  // Current member
  fastify.get("/me", {
    preHandler: [requireMemberSession],
    handler: async (req, reply) => {
      const member = req.member!;
      return reply.status(200).send({
        member: {
          id: member.id,
          email: member.email,
          name: member.name || null,
          emailVerified: !!member.emailVerifiedAt,
          createdAt: member.createdAt.toISOString(),
        },
      });
    },
  });

  // Update profile (name only)
  fastify.patch("/me", {
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const parseResult = MemberProfileUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid profile payload",
              requestId: req.id,
            },
          ],
        });
      }

      try {
        const updated = await membersService.updateProfile(
          req.member!.id,
          parseResult.data,
        );
        return reply.status(200).send({
          member: {
            id: updated.id,
            email: updated.email,
            name: updated.name || null,
            emailVerified: !!updated.emailVerifiedAt,
            createdAt: updated.createdAt.toISOString(),
          },
        });
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as { code: string }).code === "VALIDATION_ERROR"
        ) {
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
        throw err;
      }
    },
  });

  // Logout (revoke current session)
  fastify.post("/auth/logout", {
    preHandler: [validateMemberOrigin],
    handler: async (req, reply) => {
      const token = extractMemberSessionToken(req);
      if (token) {
        await memberAuthService.logout(token);
      }
      reply.clearCookie(MEMBER_COOKIE_NAME, { path: "/" });
      return reply.status(200).send({ success: true });
    },
  });
}
