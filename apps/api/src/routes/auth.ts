import { FastifyInstance } from "fastify";
import { LoginRequestSchema } from "@vibress/api-contracts";
import { authService, usersService } from "../services";
import {
  requireStaffSession,
  validateOrigin,
  COOKIE_NAME,
} from "../middleware/auth";
import { getConfig } from "@vibress/config";
import { AuthDomainError } from "@vibress/auth";
import { getDb, userInvitations, passwordResetTokens, users } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashToken, hashPassword, dummyVerifyPassword } from "@vibress/security";
import { normalizeEmail } from "@vibress/users";
import { staffAuthMailer } from "../mailer/staff-auth-mailer";

export async function authRoutes(fastify: FastifyInstance) {
  // Login
  fastify.post("/login", {
    config: {
      rateLimit: {
        max: getConfig().isProduction ? 5 : 1000,
        timeWindow: "1 minute",
      },
    },
    preHandler: [validateOrigin],
    handler: async (req, reply) => {
      const parseResult = LoginRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                parseResult.error.errors[0]?.message ||
                "Invalid login request payload",
              requestId: req.id,
            },
          ],
        });
      }

      const { email, password } = parseResult.data;
      const ipAddress = req.ip;
      const userAgent = req.headers["user-agent"] || null;

      try {
        const result = await authService.loginStaff(email, password, {
          ipAddress,
          userAgent,
          requestId: req.id,
        });

        const isProduction = getConfig().isProduction;
        reply.setCookie(COOKIE_NAME, result.sessionToken, {
          path: "/",
          httpOnly: true,
          secure: isProduction,
          sameSite: "lax",
          maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
        });

        return reply.status(200).send({
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            slug: result.user.slug ?? null,
            status: result.user.status,
            roles: result.roles,
            permissions: result.permissions,
          },
        });
      } catch (err: unknown) {
        if (
          err instanceof AuthDomainError &&
          err.code === "INVALID_CREDENTIALS"
        ) {
          return reply.status(401).send({
            errors: [
              {
                code: "INVALID_CREDENTIALS",
                message: "Invalid credentials",
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Logout
  fastify.post("/logout", {
    preHandler: [validateOrigin],
    handler: async (req, reply) => {
      const cookieToken = req.cookies[COOKIE_NAME];
      if (cookieToken) {
        await authService.logoutStaff(cookieToken, {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] || null,
          requestId: req.id,
        });
      }

      reply.clearCookie(COOKIE_NAME, { path: "/" });
      return reply.status(200).send({ success: true });
    },
  });

  // Get current user details
  fastify.get("/me", {
    preHandler: [requireStaffSession],
    handler: async (req, reply) => {
      return reply.status(200).send({
        user: {
          id: req.user!.id,
          email: req.user!.email,
          name: req.user!.name,
          slug: req.user!.slug ?? null,
          status: req.user!.status,
          roles: req.roles || [],
          permissions: req.permissions || [],
        },
      });
    },
  });

  // Accept Staff Invitation (AUTH-01)
  fastify.post("/invitation/accept", {
    preHandler: [validateOrigin],
    handler: async (req, reply) => {
      const body = req.body as
        | { token?: string; password?: string; name?: string }
        | undefined;
      if (!body || !body.token || !body.password) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Token and password are required",
              requestId: req.id,
            },
          ],
        });
      }

      if (body.password.length < 8) {
        return reply.status(400).send({
          errors: [
            {
              code: "WEAK_PASSWORD",
              message: "Password must be at least 8 characters long",
              requestId: req.id,
            },
          ],
        });
      }

      const tokenHash = hashToken(body.token);
      const db = getDb();

      const invitations = await db
        .select()
        .from(userInvitations)
        .where(eq(userInvitations.tokenHash, tokenHash))
        .limit(1);

      if (invitations.length === 0) {
        return reply.status(400).send({
          errors: [
            {
              code: "INVALID_OR_EXPIRED_TOKEN",
              message: "Invitation token is invalid or does not exist",
              requestId: req.id,
            },
          ],
        });
      }

      const invitation = invitations[0]!;

      if (invitation.status === "accepted" || invitation.acceptedAt !== null) {
        return reply.status(400).send({
          errors: [
            {
              code: "TOKEN_ALREADY_USED",
              message: "This invitation token has already been accepted",
              requestId: req.id,
            },
          ],
        });
      }

      if (invitation.status === "revoked") {
        return reply.status(400).send({
          errors: [
            {
              code: "INVITATION_REVOKED",
              message: "This invitation has been revoked by an administrator",
              requestId: req.id,
            },
          ],
        });
      }

      if (new Date(invitation.expiresAt).getTime() < Date.now()) {
        return reply.status(400).send({
          errors: [
            {
              code: "TOKEN_EXPIRED",
              message: "This invitation token has expired",
              requestId: req.id,
            },
          ],
        });
      }

      // Hash new password using Argon2id
      const newPasswordHash = await hashPassword(body.password);
      const now = new Date();

      // Update user password and activate status
      await db
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          status: "active",
          ...(body.name ? { name: body.name.trim() } : {}),
          updatedAt: now,
        })
        .where(eq(users.id, invitation.userId));

      // Mark invitation accepted
      await db
        .update(userInvitations)
        .set({
          status: "accepted",
          acceptedAt: now,
          updatedAt: now,
        })
        .where(eq(userInvitations.id, invitation.id));

      return reply.status(200).send({
        success: true,
        message: "Invitation accepted successfully. You can now log in.",
      });
    },
  });

  // Forgot Password Request (AUTH-02)
  fastify.post("/forgot-password", {
    config: {
      rateLimit: {
        max: getConfig().isProduction ? 5 : 1000,
        timeWindow: "1 minute",
      },
    },
    preHandler: [validateOrigin],
    handler: async (req, reply) => {
      const body = req.body as { email?: string } | undefined;
      if (!body || !body.email) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Email is required",
              requestId: req.id,
            },
          ],
        });
      }

      const email = normalizeEmail(body.email);
      const user = await usersService.findByEmail(email);

      // Enumeration resistance: if user doesn't exist or is disabled, execute dummy timing and return generic success
      if (!user || user.status === "disabled" || user.deletedAt) {
        await dummyVerifyPassword();
        return reply.status(200).send({
          success: true,
          message: "If that email address is registered, password reset instructions have been sent.",
        });
      }

      const db = getDb();
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);
      const tokenId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15m TTL

      await db.insert(passwordResetTokens).values({
        id: tokenId,
        userId: user.id,
        tokenHash,
        expiresAt,
        createdAt: new Date(),
      });

      const config = getConfig();
      const adminOrigin =
        config.cors.staffAllowedOrigins?.[0] ||
        `http://localhost:${config.ports.admin}`;
      const resetUrl = `${adminOrigin}/reset-password?token=${rawToken}`;

      await staffAuthMailer.sendPasswordReset({
        to: email,
        name: user.name,
        resetUrl,
        expiresInMinutes: 15,
      });

      return reply.status(200).send({
        success: true,
        message: "If that email address is registered, password reset instructions have been sent.",
        ...(config.isProduction ? {} : { token: rawToken, resetUrl }),
      });
    },
  });

  // Reset Password Execution (AUTH-02)
  fastify.post("/reset-password", {
    preHandler: [validateOrigin],
    handler: async (req, reply) => {
      const body = req.body as
        | { token?: string; password?: string }
        | undefined;
      if (!body || !body.token || !body.password) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Token and new password are required",
              requestId: req.id,
            },
          ],
        });
      }

      if (body.password.length < 8) {
        return reply.status(400).send({
          errors: [
            {
              code: "WEAK_PASSWORD",
              message: "Password must be at least 8 characters long",
              requestId: req.id,
            },
          ],
        });
      }

      const tokenHash = hashToken(body.token);
      const db = getDb();

      const tokens = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);

      if (tokens.length === 0) {
        return reply.status(400).send({
          errors: [
            {
              code: "INVALID_OR_EXPIRED_TOKEN",
              message: "Password reset token is invalid or does not exist",
              requestId: req.id,
            },
          ],
        });
      }

      const tokenRow = tokens[0]!;

      if (tokenRow.usedAt !== null) {
        return reply.status(400).send({
          errors: [
            {
              code: "TOKEN_ALREADY_USED",
              message: "This password reset token has already been used",
              requestId: req.id,
            },
          ],
        });
      }

      if (new Date(tokenRow.expiresAt).getTime() < Date.now()) {
        return reply.status(400).send({
          errors: [
            {
              code: "TOKEN_EXPIRED",
              message: "This password reset token has expired",
              requestId: req.id,
            },
          ],
        });
      }

      // Hash new password using Argon2id
      const newPasswordHash = await hashPassword(body.password);
      const now = new Date();

      // Update password
      await db
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          updatedAt: now,
        })
        .where(eq(users.id, tokenRow.userId));

      // Mark token used
      await db
        .update(passwordResetTokens)
        .set({
          usedAt: now,
        })
        .where(eq(passwordResetTokens.id, tokenRow.id));

      // Invalidate all active sessions for this user across DB
      await authService.revokeAllUserSessions(tokenRow.userId);

      return reply.status(200).send({
        success: true,
        message: "Password has been reset successfully. All active sessions have been invalidated.",
      });
    },
  });
}
