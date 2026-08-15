import { FastifyInstance } from "fastify";
import { usersService, rolesService } from "../services";
import { requireStaffSession, requirePermission } from "../middleware/auth";

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

  // Invite/Create staff user
  fastify.post("/users/invite", {
    preHandler: [requireStaffSession, requirePermission("users.manage")],
    handler: async (req, reply) => {
      const body = req.body as
        { email?: string; name?: string; roleKey?: string } | undefined;
      if (!body || !body.email) {
        return reply
          .status(400)
          .send({
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

      const existing = await usersService.findByEmail(email);
      if (existing) {
        return reply
          .status(409)
          .send({
            errors: [
              {
                code: "EMAIL_ALREADY_EXISTS",
                message: "User with this email already exists",
                requestId: req.id,
              },
            ],
          });
      }

      const role = await rolesService.findByKey(roleKey);
      if (!role) {
        return reply
          .status(400)
          .send({
            errors: [
              {
                code: "INVALID_ROLE",
                message: `Unknown role: ${roleKey}`,
                requestId: req.id,
              },
            ],
          });
      }

      // Generate secure temporary random token as password hash placeholder
      const tempPasswordHash = `$argon2id$v=19$m=65536,t=3,p=4$invited_${Date.now()}`;
      const newUser = await usersService.createUser({
        email,
        name,
        passwordHash: tempPasswordHash,
        status: "active",
      });

      await rolesService.assignRoleToUser(newUser.id, role.id);

      return reply.status(201).send({
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          status: newUser.status,
          roles: [role.key],
          createdAt: newUser.createdAt,
        },
      });
    },
  });
}
