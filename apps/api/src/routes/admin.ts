import { FastifyInstance } from 'fastify';
import { usersService, rolesService } from '../services';
import { requireStaffSession, requirePermission } from '../middleware/auth';

export async function adminRoutes(fastify: FastifyInstance) {
  // Users list
  fastify.get('/users', {
    preHandler: [requireStaffSession, requirePermission('users.read')],
    handler: async (_req, reply) => {
      const allUsers = await usersService.listAll();
      const safeUsers = await Promise.all(allUsers.map(async (u) => {
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
      }));

      return reply.status(200).send({ users: safeUsers });
    },
  });

  // Roles list
  fastify.get('/roles', {
    preHandler: [requireStaffSession, requirePermission('roles.read')],
    handler: async (_req, reply) => {
      const allRoles = await rolesService.listAll();
      return reply.status(200).send({ roles: allRoles });
    },
  });
}
