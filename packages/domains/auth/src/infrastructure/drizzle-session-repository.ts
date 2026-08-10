import { getDb, sessions } from '@vibress/database';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { SessionRepository } from '../domain/repository';
import { Session, CreateSessionData } from '../domain/session';
import crypto from 'node:crypto';

export class DrizzleSessionRepository implements SessionRepository {
  async createSession(data: CreateSessionData): Promise<Session> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const [row] = await db.insert(sessions).values({
      id,
      userId: data.userId,
      tokenHash: data.tokenHash,
      createdAt: now,
      expiresAt: data.expiresAt,
      lastSeenAt: now,
      revokedAt: null,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      metadata: data.metadata || null,
    }).returning();

    if (!row) throw new Error('Failed to create session');
    return this.mapToDomain(row);
  }

  async findActiveSessionByTokenHash(tokenHash: string): Promise<Session | null> {
    const db = getDb();
    const now = new Date();
    const rows = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async revokeSession(sessionId: string): Promise<void> {
    const db = getDb();
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    const db = getDb();
    await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async updateLastSeen(sessionId: string): Promise<void> {
    const db = getDb();
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  private mapToDomain(row: typeof sessions.$inferSelect): Session {
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastSeenAt: row.lastSeenAt,
      revokedAt: row.revokedAt,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      metadata: row.metadata as Record<string, any> | null,
    };
  }
}
