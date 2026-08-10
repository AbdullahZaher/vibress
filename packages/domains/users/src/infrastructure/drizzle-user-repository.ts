import { getDb, users, userRoles, roles } from '@vibress/database';
import { eq, and, isNull, sql, count } from 'drizzle-orm';
import { UserRepository } from '../domain/repository';
import { User, CreateUserData, UserStatus, normalizeEmail } from '../domain/user';
import crypto from 'node:crypto';

export class DrizzleUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const db = getDb();
    const rows = await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const db = getDb();
    const normalized = normalizeEmail(email);
    const rows = await db.select().from(users).where(and(eq(users.email, normalized), isNull(users.deletedAt))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findBySlug(slug: string): Promise<User | null> {
    const db = getDb();
    const rows = await db.select().from(users).where(and(eq(users.slug, slug), isNull(users.deletedAt))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async create(data: CreateUserData): Promise<User> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const normalizedEmail = normalizeEmail(data.email);
    const now = new Date();

    const [row] = await db.insert(users).values({
      id,
      email: normalizedEmail,
      name: data.name,
      slug: data.slug || null,
      bio: data.bio || null,
      passwordHash: data.passwordHash,
      status: data.status || 'active',
      createdAt: now,
      updatedAt: now,
    }).returning();

    if (!row) throw new Error('Failed to insert user');
    return this.mapToDomain(row);
  }

  async update(id: string, data: Partial<Pick<User, 'name' | 'slug' | 'bio' | 'email' | 'passwordHash' | 'status' | 'lastLoginAt' | 'deletedAt'>>): Promise<User> {
    const db = getDb();
    const updatePayload: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.slug !== undefined) updatePayload.slug = data.slug;
    if (data.bio !== undefined) updatePayload.bio = data.bio;
    if (data.email !== undefined) updatePayload.email = normalizeEmail(data.email);
    if (data.passwordHash !== undefined) updatePayload.passwordHash = data.passwordHash;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.lastLoginAt !== undefined) updatePayload.lastLoginAt = data.lastLoginAt;
    if (data.deletedAt !== undefined) updatePayload.deletedAt = data.deletedAt;

    const [row] = await db.update(users).set(updatePayload).where(eq(users.id, id)).returning();
    if (!row) throw new Error(`User not found for update: ${id}`);
    return this.mapToDomain(row);
  }

  async listAll(): Promise<User[]> {
    const db = getDb();
    const rows = await db.select().from(users).where(isNull(users.deletedAt));
    return rows.map(r => this.mapToDomain(r));
  }

  async countActiveOwners(): Promise<number> {
    const db = getDb();
    const result = await db
      .select({ value: count() })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(roles.key, 'owner'), eq(users.status, 'active'), isNull(users.deletedAt)));

    return Number(result[0]?.value || 0);
  }

  private mapToDomain(row: typeof users.$inferSelect): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      slug: row.slug || null,
      bio: row.bio || null,
      passwordHash: row.passwordHash,
      status: row.status as UserStatus,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}
