import { getDb, memberAuthTokens, memberSessions, MemberAuthTokenRow, MemberSessionRow } from '@vibress/database';
import { eq, and, isNull, lt } from 'drizzle-orm';
import { MemberAuthTokenRepository, MemberSessionRepository } from '../domain/repository';
import {
  MemberAuthToken,
  CreateMemberAuthTokenData,
  MemberSession,
  CreateMemberSessionData,
} from '../domain/auth';
import crypto from 'node:crypto';

export class DrizzleMemberAuthTokenRepository implements MemberAuthTokenRepository {
  async create(data: CreateMemberAuthTokenData): Promise<MemberAuthToken> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const [row] = await db
      .insert(memberAuthTokens)
      .values({
        id,
        memberId: data.memberId,
        tokenHash: data.tokenHash,
        purpose: data.purpose || 'authenticate',
        expiresAt: data.expiresAt,
        userAgent: data.userAgent || null,
        ipAddress: data.ipAddress || null,
      })
      .returning();
    if (!row) throw new Error('Failed to insert member auth token');
    return this.mapToDomain(row);
  }

  async findByTokenHash(tokenHash: string): Promise<MemberAuthToken | null> {
    const db = getDb();
    const rows = await db.select().from(memberAuthTokens).where(eq(memberAuthTokens.tokenHash, tokenHash)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async invalidateForMember(memberId: string, purpose: string): Promise<void> {
    const db = getDb();
    await db
      .update(memberAuthTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(memberAuthTokens.memberId, memberId), eq(memberAuthTokens.purpose, purpose), isNull(memberAuthTokens.usedAt)));
  }

  async markUsed(tokenId: string, usedAt: Date): Promise<boolean> {
    const db = getDb();
    const [row] = await db
      .update(memberAuthTokens)
      .set({ usedAt })
      .where(and(eq(memberAuthTokens.id, tokenId), isNull(memberAuthTokens.usedAt)))
      .returning({ id: memberAuthTokens.id });
    return !!row;
  }

  async deleteExpired(now = new Date()): Promise<number> {
    const db = getDb();
    const res = await db.delete(memberAuthTokens).where(lt(memberAuthTokens.expiresAt, now));
    return Number(res.rowCount || 0);
  }

  private mapToDomain(row: MemberAuthTokenRow): MemberAuthToken {
    return {
      id: row.id,
      memberId: row.memberId,
      tokenHash: row.tokenHash,
      purpose: row.purpose,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
    };
  }
}

export class DrizzleMemberSessionRepository implements MemberSessionRepository {
  async create(data: CreateMemberSessionData): Promise<MemberSession> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const [row] = await db
      .insert(memberSessions)
      .values({
        id,
        memberId: data.memberId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent || null,
        ipAddress: data.ipAddress || null,
      })
      .returning();
    if (!row) throw new Error('Failed to insert member session');
    return this.mapToDomain(row);
  }

  async findByTokenHash(tokenHash: string): Promise<MemberSession | null> {
    const db = getDb();
    const rows = await db.select().from(memberSessions).where(eq(memberSessions.tokenHash, tokenHash)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async revoke(sessionId: string): Promise<void> {
    const db = getDb();
    await db.update(memberSessions).set({ revokedAt: new Date() }).where(eq(memberSessions.id, sessionId));
  }

  async revokeAllForMember(memberId: string): Promise<number> {
    const db = getDb();
    const res = await db
      .update(memberSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(memberSessions.memberId, memberId), isNull(memberSessions.revokedAt)));
    return Number(res.rowCount || 0);
  }

  async deleteExpired(now = new Date()): Promise<number> {
    const db = getDb();
    const res = await db.delete(memberSessions).where(lt(memberSessions.expiresAt, now));
    return Number(res.rowCount || 0);
  }

  private mapToDomain(row: MemberSessionRow): MemberSession {
    return {
      id: row.id,
      memberId: row.memberId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
    };
  }
}
