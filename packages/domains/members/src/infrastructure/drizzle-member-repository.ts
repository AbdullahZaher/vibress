import { getDb, members, MemberRow } from "@vibress/database";
import { eq, and, isNull, ilike, count, desc, or } from "drizzle-orm";
import { MemberRepository } from "../domain/repository";
import {
  Member,
  CreateMemberData,
  UpdateMemberData,
  ListMembersFilter,
  MemberStatus,
} from "../domain/member";
import crypto from "node:crypto";

export class DrizzleMemberRepository implements MemberRepository {
  async create(data: CreateMemberData & { publicationId?: string }): Promise<Member> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const [row] = await db
      .insert(members)
      .values({
        id,
        publicationId: data.publicationId || "pub_default",
        email: data.email,
        emailNormalized: data.emailNormalized,
        name: data.name || null,
        status: data.status || "active",
        emailVerifiedAt: data.emailVerifiedAt || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) throw new Error("Failed to insert member");
    return this.mapToDomain(row);
  }

  async findById(id: string, publicationId?: string): Promise<Member | null> {
    const db = getDb();
    const conditions = [eq(members.id, id)];
    if (publicationId) conditions.push(eq(members.publicationId, publicationId));
    const rows = await db
      .select()
      .from(members)
      .where(and(...conditions))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByEmailNormalized(emailNormalized: string, publicationId?: string): Promise<Member | null> {
    const db = getDb();
    const conditions = [eq(members.emailNormalized, emailNormalized)];
    if (publicationId) conditions.push(eq(members.publicationId, publicationId));
    const rows = await db
      .select()
      .from(members)
      .where(and(...conditions))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdateMemberData, publicationId?: string): Promise<Member> {
    const db = getDb();
    const updatePayload: Record<string, unknown> = { updatedAt: new Date() };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.emailVerifiedAt !== undefined)
      updatePayload.emailVerifiedAt = data.emailVerifiedAt;
    if (data.lastSeenAt !== undefined)
      updatePayload.lastSeenAt = data.lastSeenAt;
    if (data.disabledAt !== undefined)
      updatePayload.disabledAt = data.disabledAt;

    const conditions = [eq(members.id, id)];
    if (publicationId) conditions.push(eq(members.publicationId, publicationId));

    const [row] = await db
      .update(members)
      .set(updatePayload)
      .where(and(...conditions))
      .returning();
    if (!row) throw new Error(`Member not found for update: ${id}`);
    return this.mapToDomain(row);
  }

  async list(
    filter: ListMembersFilter = {},
  ): Promise<{ members: Member[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;

    const conditions = [];
    if (filter.publicationId) {
      conditions.push(eq(members.publicationId, filter.publicationId));
    }
    if (filter.status) {
      conditions.push(eq(members.status, filter.status));
    }
    if (filter.search && filter.search.trim()) {
      const search = `%${filter.search.trim()}%`;
      conditions.push(
        or(
          ilike(members.email, search),
          ilike(members.emailNormalized, search),
          ilike(members.name, search),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countRes = await db
      .select({ totalCount: count() })
      .from(members)
      .where(whereClause);

    const rows = await db
      .select()
      .from(members)
      .where(whereClause)
      .orderBy(desc(members.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      members: rows.map((r) => this.mapToDomain(r)),
      total: Number(countRes[0]?.totalCount || 0),
    };
  }

  async countActiveSessions(memberId: string): Promise<number> {
    const db = getDb();
    const { memberSessions } = await import("@vibress/database");
    const res = await db
      .select({ totalCount: count() })
      .from(memberSessions)
      .where(
        and(
          eq(memberSessions.memberId, memberId),
          isNull(memberSessions.revokedAt),
        ),
      );
    return Number(res[0]?.totalCount || 0);
  }

  private mapToDomain(row: MemberRow): Member {
    return {
      id: row.id,
      publicationId: row.publicationId,
      email: row.email,
      emailNormalized: row.emailNormalized,
      name: row.name || null,
      status: row.status as MemberStatus,
      emailVerifiedAt: row.emailVerifiedAt,
      lastSeenAt: row.lastSeenAt,
      disabledAt: row.disabledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
