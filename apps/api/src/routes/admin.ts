import { FastifyInstance } from "fastify";
import { usersService, rolesService } from "../services";
import { requireStaffSession, requirePermission } from "../middleware/auth";
import { getDb, userInvitations } from "@vibress/database";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { hashToken } from "@vibress/security";
import { getConfig } from "@vibress/config";
import { staffAuthMailer } from "../mailer/staff-auth-mailer";

export async function adminRoutes(fastify: FastifyInstance) {
  // Users list
  fastify.get("/users", {
    preHandler: [requireStaffSession, requirePermission("users.read")],
    handler: async (_req, reply) => {
      const allUsers = await usersService.listAll();
      const safeUsers = await Promise.all(
        allUsers.map(async (u) => {
          const userRoles = await rolesService.getUserRoleKeys(u.id);
          return {
            id: u.id,
            email: u.email,
            name: u.name,
            status: u.status,
            roles: userRoles,
            createdAt: u.createdAt,
            lastLoginAt: u.lastLoginAt,
          };
        }),
      );

      return reply.status(200).send({ users: safeUsers });
    },
  });

  // Roles list
  fastify.get("/roles", {
    preHandler: [requireStaffSession, requirePermission("roles.read")],
    handler: async (_req, reply) => {
      const allRoles = await rolesService.listAll();
      return reply.status(200).send({ roles: allRoles });
    },
  });

  // Invite staff user (AUTH-01)
  fastify.post("/users/invite", {
    preHandler: [requireStaffSession, requirePermission("users.create")],
    handler: async (req, reply) => {
      const body = req.body as
        | { email?: string; name?: string; roleKey?: string }
        | undefined;
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

      const email = body.email.trim().toLowerCase();
      const name = body.name?.trim() || email.split("@")[0] || "Staff Member";
      const roleKey = body.roleKey || "editor";

      const db = getDb();
      const existing = await usersService.findByEmail(email);

      if (existing) {
        if (existing.status === "active") {
          return reply.status(409).send({
            errors: [
              {
                code: "EMAIL_ALREADY_EXISTS",
                message: "User with this email already exists and is active",
                requestId: req.id,
              },
            ],
          });
        }
        // If user exists with 'invited' status, supersede prior invitation
      }

      const role = await rolesService.findByKey(roleKey);
      if (!role) {
        return reply.status(400).send({
          errors: [
            {
              code: "INVALID_ROLE",
              message: `Unknown role: ${roleKey}`,
              requestId: req.id,
            },
          ],
        });
      }

      let userId: string;
      if (existing) {
        userId = existing.id;
        // Invalidate prior pending invitations
        await db
          .update(userInvitations)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(and(eq(userInvitations.userId, userId), eq(userInvitations.status, "pending")));

        // Update role if changed
        await rolesService.assignRoleToUser(userId, role.id);
      } else {
        const placeholderHash = `$argon2id$v=19$m=65536,t=3,p=4$invited_${crypto.randomBytes(16).toString("hex")}`;
        const newUser = await usersService.createUser({
          email,
          name,
          passwordHash: placeholderHash,
          status: "invited",
        });
        userId = newUser.id;
        await rolesService.assignRoleToUser(userId, role.id);
      }

      // Generate 32-byte secure random token and store SHA-256 hash
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);
      const invitationId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h TTL

      await db.insert(userInvitations).values({
        id: invitationId,
        userId,
        email,
        tokenHash,
        status: "pending",
        expiresAt,
        invitedBy: req.user!.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const config = getConfig();
      const adminOrigin =
        config.cors.staffAllowedOrigins?.[0] ||
        `http://localhost:${config.ports.admin}`;
      const invitationUrl = `${adminOrigin}/accept-invitation?token=${rawToken}`;

      await staffAuthMailer.sendStaffInvitation({
        to: email,
        name,
        invitationUrl,
        expiresInHours: 48,
      });

      return reply.status(201).send({
        user: {
          id: userId,
          email,
          name,
          status: "invited",
          roles: [role.key],
        },
        invitation: {
          id: invitationId,
          expiresAt,
          status: "pending",
          // Expose token for automated test assertions
          ...(config.isProduction ? {} : { token: rawToken, invitationUrl }),
        },
      });
    },
  });

  // Resend invitation
  fastify.post("/users/invite/resend", {
    preHandler: [requireStaffSession, requirePermission("users.create")],
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

      const email = body.email.trim().toLowerCase();
      const user = await usersService.findByEmail(email);
      if (!user || user.status !== "invited") {
        return reply.status(404).send({
          errors: [
            {
              code: "INVITATION_NOT_FOUND",
              message: "No pending invitation found for this email",
              requestId: req.id,
            },
          ],
        });
      }

      const db = getDb();
      // Revoke prior pending invitations
      await db
        .update(userInvitations)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(and(eq(userInvitations.userId, user.id), eq(userInvitations.status, "pending")));

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);
      const invitationId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      await db.insert(userInvitations).values({
        id: invitationId,
        userId: user.id,
        email,
        tokenHash,
        status: "pending",
        expiresAt,
        invitedBy: req.user!.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const config = getConfig();
      const adminOrigin =
        config.cors.staffAllowedOrigins?.[0] ||
        `http://localhost:${config.ports.admin}`;
      const invitationUrl = `${adminOrigin}/accept-invitation?token=${rawToken}`;

      await staffAuthMailer.sendStaffInvitation({
        to: email,
        name: user.name,
        invitationUrl,
        expiresInHours: 48,
      });

      return reply.status(200).send({
        success: true,
        invitation: {
          id: invitationId,
          expiresAt,
          status: "pending",
          ...(config.isProduction ? {} : { token: rawToken, invitationUrl }),
        },
      });
    },
  });

  // Revoke invitation
  fastify.post("/users/invite/revoke", {
    preHandler: [requireStaffSession, requirePermission("users.delete")],
    handler: async (req, reply) => {
      const body = req.body as { email?: string; userId?: string } | undefined;
      const db = getDb();

      let targetUserId = body?.userId;
      if (!targetUserId && body?.email) {
        const user = await usersService.findByEmail(body.email.trim().toLowerCase());
        targetUserId = user?.id;
      }

      if (!targetUserId) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "User ID or Email is required",
              requestId: req.id,
            },
          ],
        });
      }

      await db
        .update(userInvitations)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(and(eq(userInvitations.userId, targetUserId), eq(userInvitations.status, "pending")));

      return reply.status(200).send({ success: true });
    },
  });
}
