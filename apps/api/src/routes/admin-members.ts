import { FastifyInstance } from "fastify";
import { membersService } from "../services";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import { MemberNotFoundError, MemberStateError } from "@vibress/members";

export async function adminMemberRoutes(fastify: FastifyInstance) {
  // List members (staff only)
  fastify.get("/members", {
    preHandler: [requireStaffSession, requirePermission("members.read")],
    handler: async (req, reply) => {
      const { search, status, limit, offset } = req.query as Record<
        string,
        string | undefined
      >;
      const result = await membersService.listMembers({
        search,
        status: status as "active" | "disabled" | undefined,
        limit: limit ? parseInt(limit, 10) : 20,
        offset: offset ? parseInt(offset, 10) : 0,
        publicationId: req.publicationContext?.publicationId,
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
        limit: parseInt(limit || "20", 10),
        offset: parseInt(offset || "0", 10),
      });
    },
  });

  // Member detail (staff only)
  fastify.get("/members/:id", {
    preHandler: [requireStaffSession, requirePermission("members.read")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const member = await membersService.findById(
        id,
        req.publicationContext?.publicationId,
      );
      if (!member) {
        return reply.status(404).send({
          errors: [
            {
              code: "MEMBER_NOT_FOUND",
              message: "Member not found",
              requestId: req.id,
            },
          ],
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
          lastSeenAt: member.lastSeenAt
            ? member.lastSeenAt.toISOString()
            : null,
          disabledAt: member.disabledAt
            ? member.disabledAt.toISOString()
            : null,
          updatedAt: member.updatedAt.toISOString(),
          activeSessionCount,
        },
      });
    },
  });

  // Disable member (staff only) — revokes sessions atomically
  fastify.post("/members/:id/disable", {
    preHandler: [
      requireStaffSession,
      requirePermission("members.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const updated = await membersService.disableMember(
          id,
          req.user!.id,
          req.publicationContext?.publicationId,
        );
        return reply.status(200).send({
          member: {
            id: updated.id,
            status: updated.status,
            disabledAt: updated.disabledAt
              ? updated.disabledAt.toISOString()
              : null,
          },
        });
      } catch (err: unknown) {
        if (err instanceof MemberNotFoundError) {
          return reply.status(404).send({
            errors: [
              {
                code: "MEMBER_NOT_FOUND",
                message: "Member not found",
                requestId: req.id,
              },
            ],
          });
        }
        if (
          err instanceof MemberStateError &&
          err.code === "MEMBER_ALREADY_DISABLED"
        ) {
          return reply.status(409).send({
            errors: [
              {
                code: "MEMBER_ALREADY_DISABLED",
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

  // Enable member (staff only)
  fastify.post("/members/:id/enable", {
    preHandler: [
      requireStaffSession,
      requirePermission("members.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const updated = await membersService.enableMember(
          id,
          req.user!.id,
          req.publicationContext?.publicationId,
        );
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
            errors: [
              {
                code: "MEMBER_NOT_FOUND",
                message: "Member not found",
                requestId: req.id,
              },
            ],
          });
        }
        if (
          err instanceof MemberStateError &&
          err.code === "MEMBER_ALREADY_ACTIVE"
        ) {
          return reply.status(409).send({
            errors: [
              {
                code: "MEMBER_ALREADY_ACTIVE",
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

  // Revoke all member sessions (staff only)
  fastify.post("/members/:id/revoke-sessions", {
    preHandler: [
      requireStaffSession,
      requirePermission("members.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const member = await membersService.findById(
        id,
        req.publicationContext?.publicationId,
      );
      if (!member) {
        return reply.status(404).send({
          errors: [
            {
              code: "MEMBER_NOT_FOUND",
              message: "Member not found",
              requestId: req.id,
            },
          ],
        });
      }

      const revoked = await membersService.revokeAllSessionsForMember(id);
      return reply.status(200).send({ revokedCount: revoked });
    },
  });

  // Delete member (staff only)
  fastify.delete("/members/:id", {
    preHandler: [
      requireStaffSession,
      requirePermission("members.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const pubId = req.publicationContext?.publicationId;

      try {
        await membersService.deleteMember(id, pubId, req.user!.id);
        return reply.status(200).send({ success: true, deleted: true, message: "Member deleted successfully" });
      } catch (err: unknown) {
        if (err instanceof MemberNotFoundError) {
          return reply.status(404).send({
            errors: [
              {
                code: "MEMBER_NOT_FOUND",
                message: "Member not found",
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Export members as CSV (staff only)
  fastify.get("/members/export", {
    preHandler: [requireStaffSession, requirePermission("members.read")],
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId || "pub_default";
      const result = await membersService.listMembers({
        publicationId: pubId,
        limit: 10000,
        offset: 0,
      });

      const header = ["id", "email", "name", "status", "email_verified", "created_at", "last_seen_at"].join(",");
      const lines = [header];

      for (const m of result.members) {
        const row = [
          escapeCsvCell(m.id),
          escapeCsvCell(m.email),
          escapeCsvCell(m.name || ""),
          escapeCsvCell(m.status),
          escapeCsvCell(m.emailVerifiedAt ? "true" : "false"),
          escapeCsvCell(m.createdAt.toISOString()),
          escapeCsvCell(m.lastSeenAt ? m.lastSeenAt.toISOString() : ""),
        ].join(",");
        lines.push(row);
      }

      const csvContent = lines.join("\r\n");
      const filename = `members-${pubId}-${new Date().toISOString().slice(0, 10)}.csv`;

      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .status(200)
        .send(csvContent);
    },
  });

  // Import members from CSV (staff only)
  fastify.post("/members/import", {
    preHandler: [
      requireStaffSession,
      requirePermission("members.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const body = (req.body || {}) as any;
      const csvData = typeof body.csvData === "string" ? body.csvData : typeof body.csv === "string" ? body.csv : undefined;
      const dryRun = !!body.dryRun;
      if (!csvData || typeof csvData !== "string") {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "csvData string is required",
              requestId: req.id,
            },
          ],
        });
      }

      const pubId = req.publicationContext?.publicationId || "pub_default";
      const lines = csvData
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        return reply.status(200).send({
          total: 0,
          valid: 0,
          created: 0,
          skipped: 0,
          duplicates: 0,
          errors: [],
          dryRun: !!dryRun,
        });
      }

      let startIndex = 0;
      const headerLine = lines[0]!.toLowerCase();
      if (headerLine.includes("email")) {
        startIndex = 1;
      }

      const errors: Array<{ row: number; message: string }> = [];
      const validRows: Array<{ email: string; name?: string | null }> = [];
      const seenInBatch = new Set<string>();
      let duplicates = 0;

      for (let i = startIndex; i < lines.length; i++) {
        const rowNum = i - startIndex + 1;
        const line = lines[i]!;
        const cols = line
          .split(",")
          .map((c) => c.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
        const rawEmail = cols[0];
        const rawName = cols.length > 1 ? cols[1] : null;

        if (!rawEmail || !rawEmail.includes("@")) {
          errors.push({ row: rowNum, message: "Invalid email format" });
          continue;
        }

        const normEmail = rawEmail.toLowerCase();
        if (seenInBatch.has(normEmail)) {
          duplicates++;
          continue;
        }
        seenInBatch.add(normEmail);
        validRows.push({ email: rawEmail, name: rawName || null });
      }

      let created = 0;
      let skipped = 0;

      if (!dryRun) {
        for (const row of validRows) {
          try {
            const existing = await membersService.findByEmail(row.email, pubId);
            if (existing) {
              skipped++;
              continue;
            }
            await membersService.createMember({
              email: row.email,
              name: row.name,
              publicationId: pubId,
            });
            created++;
          } catch (err) {
            errors.push({
              row: 0,
              message:
                err instanceof Error
                  ? err.message
                  : "Failed to create member",
            });
          }
        }
      } else {
        for (const row of validRows) {
          const existing = await membersService.findByEmail(row.email, pubId);
          if (existing) {
            skipped++;
          } else {
            created++;
          }
        }
      }

      return reply.status(200).send({
        total: lines.length - startIndex,
        valid: validRows.length,
        invalid: errors.length,
        created,
        skipped,
        duplicates,
        errors,
        dryRun: !!dryRun,
      });
    },
  });
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Formula injection defense: neutralize leading =, +, -, @, \t, \r
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}
