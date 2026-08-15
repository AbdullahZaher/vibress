import { getDb, roles, userRoles } from "@vibress/database";
import { eq, and } from "drizzle-orm";
import { RoleRepository } from "../domain/repository";
import { Role, CreateRoleData } from "../domain/role";
import crypto from "node:crypto";

export class DrizzleRoleRepository implements RoleRepository {
  async findById(id: string): Promise<Role | null> {
    const db = getDb();
    const rows = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByKey(key: string): Promise<Role | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(roles)
      .where(eq(roles.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async create(data: CreateRoleData): Promise<Role> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const [row] = await db
      .insert(roles)
      .values({
        id,
        key: data.key,
        name: data.name,
        description: data.description || null,
        isSystem: data.isSystem ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: roles.key,
        set: {
          name: data.name,
          description: data.description || null,
          updatedAt: now,
        },
      })
      .returning();

    if (!row) throw new Error("Failed to create/upsert role");
    return this.mapToDomain(row);
  }

  async listAll(): Promise<Role[]> {
    const db = getDb();
    const rows = await db.select().from(roles);
    return rows.map((r) => this.mapToDomain(r));
  }

  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    const db = getDb();
    await db
      .insert(userRoles)
      .values({
        userId,
        roleId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    const db = getDb();
    await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  }

  async getUserRoles(userId: string): Promise<Role[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
        createdAt: roles.createdAt,
        updatedAt: roles.updatedAt,
      })
      .from(roles)
      .innerJoin(userRoles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId));

    return rows.map((r) => this.mapToDomain(r));
  }

  async getUserRoleKeys(userId: string): Promise<string[]> {
    const userRoleList = await this.getUserRoles(userId);
    return userRoleList.map((r) => r.key);
  }

  private mapToDomain(row: typeof roles.$inferSelect): Role {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
