import { FastifyInstance } from 'fastify';
import { membersService } from '../services';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';
import { MemberNotFoundError, MemberStateError } from '@vibress/members';

export async function adminMemberRoutes(fastify: FastifyInstance) {
  // List members (staff only)
  fastify.get('/members', {
    preHandler: [requireStaffSession, requirePermission('members.read')],
    handler: async (req, reply) => {
      const { search, status, limit, offset } = req.query as Record<string, string | undefined>;
      const result = await membersService.listMembers({
        search,
        status: status as 'active' | 'disabled' | undefined,
        limit: limit ? parseInt(limit, 10) : 20,
        offset: offset ? parseInt(offset, 10) : 0,
      });

      const members = result.members.map((m) => ({
        id: m.id,
        email: m.email,
        name: m.name || null,
        status: m.status,
        emailVerified: !!m.emailVerifiedAt,
        createdAt: m.createdAt.toISOString(),
        lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null,
      }));

      return reply.status(200).send({
        members,
        total: result.total,
        limit: parseInt(limit || '20', 10),
        offset: parseInt(offset || '0', 10),
      });
    },
  });

  // Member detail (staff only)
  fastify.get('/members/:id', {
    preHandler: [requireStaffSession, requirePermission('members.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const member = await membersService.findById(id);
      if (!member) {
        return reply.status(404).send({
          errors: [{ code: 'MEMBER_NOT_FOUND', message: 'Member not found', requestId: req.id }],
        });
      }

      const activeSessionCount = await membersService.countActiveSessions(id);

      return reply.status(200).send({
        member: {
          id: member.id,
          email: member.email,
          emailNormalized: member.emailNormalized,
          name: member.name || null,
          status: member.status,
          emailVerified: !!member.emailVerifiedAt,
          createdAt: member.createdAt.toISOString(),
          lastSeenAt: member.lastSeenAt ? member.lastSeenAt.toISOString() : null,
          disabledAt: member.disabledAt ? member.disabledAt.toISOString() : null,
          updatedAt: member.updatedAt.toISOString(),
          activeSessionCount,
        },
      });
    },
  });

  // Disable member (staff only) — revokes sessions atomically
  fastify.post('/members/:id/disable', {
    preHandler: [requireStaffSession, requirePermission('members.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const updated = await membersService.disableMember(id, req.user!.id);
        return reply.status(200).send({
          member: {
            id: updated.id,
            status: updated.status,
            disabledAt: updated.disabledAt ? updated.disabledAt.toISOString() : null,
          },
        });
      } catch (err: unknown) {
        if (err instanceof MemberNotFoundError) {
          return reply.status(404).send({
            errors: [{ code: 'MEMBER_NOT_FOUND', message: 'Member not found', requestId: req.id }],
          });
        }
        if (err instanceof MemberStateError && err.code === 'MEMBER_ALREADY_DISABLED') {
          return reply.status(409).send({
            errors: [{ code: 'MEMBER_ALREADY_DISABLED', message: err.message, requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Enable member (staff only)
  fastify.post('/members/:id/enable', {
    preHandler: [requireStaffSession, requirePermission('members.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const updated = await membersService.enableMember(id, req.user!.id);
        return reply.status(200).send({
          member: {
            id: updated.id,
            status: updated.status,
            disabledAt: null,
          },
        });
      } catch (err: unknown) {
        if (err instanceof MemberNotFoundError) {
          return reply.status(404).send({
            errors: [{ code: 'MEMBER_NOT_FOUND', message: 'Member not found', requestId: req.id }],
          });
        }
        if (err instanceof MemberStateError && err.code === 'MEMBER_ALREADY_ACTIVE') {
          return reply.status(409).send({
            errors: [{ code: 'MEMBER_ALREADY_ACTIVE', message: err.message, requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Revoke all member sessions (staff only)
  fastify.post('/members/:id/revoke-sessions', {
    preHandler: [requireStaffSession, requirePermission('members.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const member = await membersService.findById(id);
      if (!member) {
        return reply.status(404).send({
          errors: [{ code: 'MEMBER_NOT_FOUND', message: 'Member not found', requestId: req.id }],
        });
      }

      const revoked = await membersService.revokeAllSessionsForMember(id);
      return reply.status(200).send({ revokedCount: revoked });
    },
  });
}
